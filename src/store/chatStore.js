import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { 
  collection, 
  getDocs, 
  addDoc, 
  getDoc, 
  doc, 
  query, 
  orderBy, 
  onSnapshot,
  serverTimestamp 
} from 'firebase/firestore';
import { db, app } from '../config/firebase';
import { processImage } from '../utils/imageProcessor';
import { DEFAULT_MODEL, isImagenModel } from '../constants/models';

/**
 * Get or create session ID from localStorage
 */
const getSessionId = () => {
  const stored = localStorage.getItem('chat_session_id');
  if (stored) {
    return stored;
  }
  const newSessionId = uuidv4();
  localStorage.setItem('chat_session_id', newSessionId);
  console.log('[Store] New session ID created:', newSessionId);
  return newSessionId;
};

/**
 * Get messages collection reference
 */
const getMessagesRef = (sessionId) => {
  return collection(db, 'chats', sessionId, 'messages');
};

/**
 * Check if message already exists (duplicate prevention)
 */
const isDuplicate = (messages, newMessage) => {
  const now = Date.now();
  return messages.some(msg => {
    const timeDiff = Math.abs((msg.timestamp || 0) - (newMessage.timestamp || now));
    return msg.text === newMessage.text && timeDiff < 1000;
  });
};

/**
 * Minimal chat store with Firestore persistence
 */
export const useChatStore = create((set, get) => ({
  messages: [],
  sessionId: getSessionId(),
  firestoreError: null,
  unsubscribe: null,
  loading: false,
  selectedModel: DEFAULT_MODEL,
  
  /**
   * Set selected model
   */
  setSelectedModel: (model) => {
    set({ selectedModel: model });
    console.log('[Store] Model changed to:', model);
  },

  /**
   * Load messages from Firestore
   */
  loadMessages: async () => {
    const { sessionId } = get();
    set({ loading: true, firestoreError: null });

    try {
      console.log('[Store] Loading messages for session:', sessionId);
      const messagesRef = getMessagesRef(sessionId);
      const q = query(messagesRef, orderBy('createdAt', 'asc'));
      
      const querySnapshot = await getDocs(q);
      const loadedMessages = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        
        // Handle image messages (new structure)
        if (data.type === 'image') {
          loadedMessages.push({
            id: doc.id,
            type: 'image',
            url: data.url,
            role: data.sender === 'user' ? 'user' : 'assistant',
            sender: data.sender,
            timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
            model: data.model || 'gemini-2.5-flash'
          });
        } else {
          // Handle text messages (legacy structure)
          loadedMessages.push({
            id: doc.id,
            role: data.role,
            content: data.text || '',
            imageUrl: data.imageUrl || null, // Legacy support
            timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
            model: data.model || 'gemini-2.5-flash'
          });
        }
      });

      console.log('[Store] Loaded', loadedMessages.length, 'messages from Firestore');
      set({ messages: loadedMessages, loading: false });
      
      // Setup realtime listener
      get().setupRealtimeListener();
      
      return loadedMessages;
    } catch (error) {
      console.error('[Store] Error loading messages:', error);
      set({ firestoreError: error.message, loading: false });
      return [];
    }
  },

  /**
   * Setup realtime listener for messages
   */
  setupRealtimeListener: () => {
    const { sessionId, unsubscribe } = get();
    
    // Clean up existing listener
    if (unsubscribe) {
      unsubscribe();
    }

    try {
      console.log('[Store] Setting up realtime listener for session:', sessionId);
      const messagesRef = getMessagesRef(sessionId);
      const q = query(messagesRef, orderBy('createdAt', 'asc'));
      
      const unsubscribeListener = onSnapshot(
        q,
        (snapshot) => {
          const { messages: currentMessages } = get();
          const newMessages = [];
          const seenIds = new Set(currentMessages.map(m => m.id));
          
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' && !seenIds.has(change.doc.id)) {
              const data = change.doc.data();
              
              // Handle image messages (new structure)
              let newMessage;
              if (data.type === 'image') {
                newMessage = {
                  id: change.doc.id,
                  type: 'image',
                  url: data.url,
                  role: data.sender === 'user' ? 'user' : 'assistant',
                  sender: data.sender,
                  timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
                  model: data.model || DEFAULT_MODEL
                };
              } else {
                // Handle text messages (legacy structure)
                newMessage = {
                  id: change.doc.id,
                  role: data.role,
                  content: data.text || '',
                  imageUrl: data.imageUrl || null, // Legacy support
                  timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
                  model: data.model || DEFAULT_MODEL
                };
              }
              
              // Duplicate check
              if (!isDuplicate(currentMessages, newMessage)) {
                newMessages.push(newMessage);
                seenIds.add(change.doc.id);
              }
            }
          });

          if (newMessages.length > 0) {
            console.log('[Store] Realtime update:', newMessages.length, 'new messages');
            set(state => ({
              messages: [...state.messages, ...newMessages].sort((a, b) => a.timestamp - b.timestamp)
            }));
          }
        },
        (error) => {
          console.error('[Store] Realtime listener error:', error);
          set({ firestoreError: error.message });
        }
      );

      set({ unsubscribe: unsubscribeListener });
    } catch (error) {
      console.error('[Store] Error setting up realtime listener:', error);
      set({ firestoreError: error.message });
    }
  },

  /**
   * Upload image file to PostImages.org via /api/uploadImage
   * Uses multipart/form-data (NO API KEY REQUIRED)
   */
  uploadImageToPostImages: async (file) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api/uploadImage';
      
      console.log('[Store] Uploading image to PostImages.org...', {
        name: file.name,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        type: file.type
      });

      // Create FormData for multipart/form-data
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header - browser will set it with boundary
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        const errorMessage = errorData.error || errorData.message || `Upload error: ${response.status}`;
        console.error('[Store] Upload failed:', errorMessage);
        throw new Error(errorMessage || 'Impossibile caricare l\'immagine');
      }

      const data = await response.json();
      console.log('[Store] Image uploaded to PostImages.org, URL:', data.url);
      return data.url;
    } catch (error) {
      console.error('[Store] Error uploading image to PostImages.org:', error);
      throw new Error(error.message || 'Impossibile caricare l\'immagine');
    }
  },

  /**
   * Convert File to base64 (legacy, use processImage instead)
   */
  fileToBase64: (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Save message to Firestore
   * For image messages: type: "image", url, sender, model, createdAt
   * For text messages: role, text, model, createdAt
   */
  saveMessageToFirestore: async (role, text, model = DEFAULT_MODEL, imageUrl = null) => {
    const { sessionId } = get();
    
    try {
      const messagesRef = getMessagesRef(sessionId);
      
      // If imageUrl is provided, save as image message
      if (imageUrl) {
        const messageData = {
          type: 'image',
          url: imageUrl,
          sender: role === 'user' ? 'user' : 'assistant',
          model,
          createdAt: serverTimestamp()
        };
        const docRef = await addDoc(messagesRef, messageData);
        console.log('[Store] Image message saved to Firestore:', docRef.id);
        return docRef.id;
      }
      
      // Otherwise, save as text message
      const messageData = {
        role,
        text: text || null,
        model,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(messagesRef, messageData);
      console.log('[Store] Message saved to Firestore:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('[Store] Error saving message to Firestore:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Send image message (user uploads image)
   */
  sendImageMessage: async (file) => {
    const { sessionId } = get();
    const tempMessageId = `temp-${Date.now()}`;
    
    try {
      // Log original size
      console.log('[IMG] Original size:', `${(file.size / 1024).toFixed(2)} KB`);
      
      // Process image: resize, compress
      console.log('[Store] Processing image (resize & compress)...');
      const processed = await processImage(file, 1500);
      
      console.log('[IMG] Compressed size:', `${(processed.compressedSize / 1024).toFixed(2)} KB`);
      
      // Create preview from compressed blob
      const localPreviewUrl = URL.createObjectURL(processed.blob);
      
      // Convert blob to File for upload
      const compressedFile = new File([processed.blob], file.name || 'image.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now()
      });
      
      // Add user message with compressed preview immediately to UI
      const userMessage = {
        id: tempMessageId,
        type: 'image',
        role: 'user',
        sender: 'user',
        localPreviewUrl,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // Upload compressed file to PostImages.org
      console.log('[Store] Uploading compressed image to PostImages.org...');
      const imageUrl = await get().uploadImageToPostImages(compressedFile);

      // Update message with imageUrl and remove localPreviewUrl
      set(state => ({
        messages: state.messages.map(msg => 
          msg.id === tempMessageId
            ? { ...msg, url: imageUrl, localPreviewUrl: null }
            : msg
        )
      }));

      // Clean up local preview URL
      URL.revokeObjectURL(localPreviewUrl);

      // Save to Firestore with new structure (type: "image", url, sender)
      try {
        const { selectedModel } = get();
        await get().saveMessageToFirestore('user', null, selectedModel, imageUrl);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for image message:', firestoreError);
        // Remove message from UI if Firestore save fails
        set(state => ({
          messages: state.messages.filter(msg => msg.id !== tempMessageId)
        }));
        throw new Error('Failed to save image message to Firestore');
      }

      console.log('[Store] Image message uploaded and saved successfully');
      return true;
    } catch (error) {
      console.error('[Store] Error sending image message:', error);
      // Remove message from UI on error
      set(state => ({
        messages: state.messages.filter(msg => msg.id !== tempMessageId)
      }));
      throw error;
    }
  },

  /**
   * Generate image from prompt
   */
  generateImage: async (prompt, model = null) => {
    const { selectedModel } = get();
    const modelToUse = model || selectedModel;
    const tempMessageId = `temp-${Date.now()}`;
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api/generateImage';
      
      console.log('[Store] Calling image generation API:', apiUrl);
      console.log('[Store] Request body:', { prompt, model: modelToUse });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          model: modelToUse,
          size: "512x512"
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        throw new Error(errorData.error || errorData.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Store] Image generation response received');

      // Add assistant message with base64 image (temporary)
      const assistantMessage = {
        id: tempMessageId,
        type: 'image',
        role: 'assistant',
        sender: 'assistant',
        content: '',
        model: modelToUse,
        imageBase64: data.imageBase64, // Temporary, will be replaced with URL
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, assistantMessage]
      }));

      // Process and compress generated image before upload
      console.log('[Store] Processing generated image (resize & compress)...');
      
      // Convert base64 to Blob for processing
      const base64Response = await fetch(`data:image/png;base64,${data.imageBase64}`);
      const blob = await base64Response.blob();
      const file = new File([blob], 'generated-image.png', { type: 'image/png' });
      
      const processed = await processImage(file, 1500);
      console.log('[IMG] Generated image - Original:', `${(blob.size / 1024).toFixed(2)} KB`, 'Compressed:', `${(processed.compressedSize / 1024).toFixed(2)} KB`);
      
      // Convert processed blob to File for upload
      const compressedFile = new File([processed.blob], 'generated-image.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now()
      });
      
      // Upload compressed file to PostImages.org
      console.log('[Store] Uploading compressed generated image to PostImages.org...');
      const imageUrl = await get().uploadImageToPostImages(compressedFile);

      // Update message with imageUrl and remove imageBase64
      set(state => ({
        messages: state.messages.map(msg => 
          msg.id === tempMessageId
            ? { ...msg, url: imageUrl, imageBase64: null }
            : msg
        )
      }));

      // Save to Firestore with new structure (type: "image", url, sender)
      try {
        await get().saveMessageToFirestore('assistant', '', modelToUse, imageUrl);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for generated image:', firestoreError);
        // Remove message from UI if Firestore save fails
        set(state => ({
          messages: state.messages.filter(msg => msg.id !== tempMessageId)
        }));
        throw new Error('Failed to save generated image to Firestore');
      }

      console.log('[Store] Generated image uploaded and saved successfully');
      return imageUrl;
    } catch (error) {
      console.error('[Store] Error generating image:', error);
      // Remove message from UI on error
      set(state => ({
        messages: state.messages.filter(msg => msg.id !== tempMessageId)
      }));
      throw error;
    }
  },

  /**
   * Send a message to /api/chat and get reply
   */
  sendMessage: async (message) => {
    const { sessionId, selectedModel } = get();
    
    try {
      // Check if selected model is Imagen (always generate image) OR message requests image generation
      const lowerMessage = message.toLowerCase();
      const isImageRequest = isImagenModel(selectedModel) ||
                            lowerMessage.includes('generate an image') || 
                            lowerMessage.includes('create an image') ||
                            lowerMessage.includes('generate image') ||
                            lowerMessage.startsWith('image:');

      if (isImageRequest) {
        // Extract prompt from message
        const prompt = message.replace(/^(generate an image|create an image|generate image|image:)\s*/i, '').trim() || message;
        
        // Add user message immediately to UI
        const userMessage = {
          id: `temp-${Date.now()}`,
          role: 'user',
          content: message,
          model: selectedModel,
          timestamp: Date.now()
        };

        set(state => ({
          messages: [...state.messages, userMessage]
        }));

        // Save user message to Firestore
        try {
          await get().saveMessageToFirestore('user', message, selectedModel);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed, continuing with API call:', firestoreError);
        }

        // Generate image instead of text response
        await get().generateImage(prompt, selectedModel);
        return null;
      }

      // Add user message immediately to UI
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message,
        model: selectedModel,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // Save user message to Firestore
      try {
        await get().saveMessageToFirestore('user', message, selectedModel);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed, continuing with API call:', firestoreError);
        // Continue even if Firestore fails
      }

      // Call API with selected model
      const apiUrl = import.meta.env.VITE_API_URL || '/api/chat';
      
      console.log('[Store] Calling API:', apiUrl);
      console.log('[Store] Request body:', { message, model: selectedModel });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          model: selectedModel
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        throw new Error(errorData.error || errorData.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Store] API response received:', data);

      // Add assistant message to UI
      const assistantMessage = {
        id: `temp-${Date.now() + 1}`,
        role: 'assistant',
        content: data.reply || 'No response generated',
        model: selectedModel,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, assistantMessage]
      }));

      // Save assistant message to Firestore
      try {
        await get().saveMessageToFirestore('assistant', data.reply || 'No response generated', selectedModel);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for assistant message:', firestoreError);
        // Continue even if Firestore fails
      }

      return data.reply;
    } catch (error) {
      console.error('[Store] Error sending message:', error);
      throw error;
    }
  },

  /**
   * Clear all messages and create new session
   */
  clearMessages: () => {
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe();
    }
    
    // Create new session
    const newSessionId = uuidv4();
    localStorage.setItem('chat_session_id', newSessionId);
    
    set({ 
      messages: [], 
      sessionId: newSessionId,
      unsubscribe: null,
      firestoreError: null
    });
    
    console.log('[Store] New session created:', newSessionId);
  }
}));

export async function testFirestoreRead() {
  console.group("[🔥 EXTREME FIRESTORE READ DEBUG]");

  try {
    console.log("➡️ Starting EXTREME read test...");
    console.log("📌 PROJECT ID:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

    const colRef = collection(db, "test");
    console.log("📁 Collection REF:", colRef);

    const querySnapshot = await getDocs(colRef);

    console.log("📄 RAW SNAPSHOT:", querySnapshot);

    const docs = [];
    querySnapshot.forEach((doc) => {
      docs.push({ id: doc.id, ...doc.data() });
    });

    console.log("📄 PARSED DOCUMENTS:", docs);
    console.groupEnd();
    return true;

  } catch (error) {
    console.error("❌ READ FAILED", error);

    if (error.stack) console.error("🧱 STACK:", error.stack);
    if (error.message) console.error("🗯 MESSAGE:", error.message);

    console.groupEnd();
    return false;
  }
}

export async function testFirestoreWrite() {
  console.group("[🔥 EXTREME FIRESTORE WRITE DEBUG]");

  try {
    console.log("➡️ Starting EXTREME write test...");
    console.log("📌 PROJECT ID:", import.meta.env.VITE_FIREBASE_PROJECT_ID);
    console.log("📌 API KEY:", import.meta.env.VITE_FIREBASE_API_KEY);
    console.log("📌 AUTH DOMAIN:", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);

    console.log("📦 Firebase APP object:", app);
    console.log("📦 Firestore DB object:", db);

    const payload = {
      message: "Hello from EXTREME DEBUG",
      ts: Date.now(),
      random: Math.random(),
    };

    console.log("🧪 Payload:", payload);

    const colRef = collection(db, "test");
    console.log("📁 Collection REF:", colRef);

    const docRef = await addDoc(colRef, payload);

    console.log("✅ WRITE SUCCESS!");
    console.log("🆔 NEW DOCUMENT ID:", docRef.id);

    console.groupEnd();
    return true;

  } catch (error) {
    console.error("❌ WRITE FAILED", error);

    if (error.stack) console.error("🧱 STACK:", error.stack);
    if (error.message) console.error("🗯 MESSAGE:", error.message);
    if (error.code) console.error("🔥 FIRESTORE ERROR CODE:", error.code);

    console.groupEnd();
    return false;
  }
}
