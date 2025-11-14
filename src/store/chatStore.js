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
        loadedMessages.push({
          id: doc.id,
          role: data.role,
          content: data.text || '',
          imageUrl: data.imageUrl || null,
          timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
          model: data.model || 'gemini-2.5-flash'
        });
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
              const newMessage = {
                id: change.doc.id,
                role: data.role,
                content: data.text || '',
                imageUrl: data.imageUrl || null,
                timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
                model: data.model || 'gemini-2.5-flash'
              };
              
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
   * Upload base64 image to ImgBB and get URL
   */
  uploadBase64ToUrl: async (base64) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api/uploadImage';
      
      console.log('[Store] Uploading image to ImgBB...');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base64: base64
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
        throw new Error(errorData.error || errorData.message || `Upload error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Store] Image uploaded to ImgBB, URL:', data.url);
      return data.url;
    } catch (error) {
      console.error('[Store] Error uploading image to ImgBB:', error);
      throw error;
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
   */
  saveMessageToFirestore: async (role, text, model = 'gemini-2.5-flash', imageUrl = null) => {
    const { sessionId } = get();
    
    try {
      const messagesRef = getMessagesRef(sessionId);
      const messageData = {
        role,
        text: text || null,
        model,
        imageUrl: imageUrl || null,
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
      
      // Process image: resize, compress, convert to base64
      console.log('[Store] Processing image (resize & compress)...');
      const processed = await processImage(file, 1500);
      
      console.log('[IMG] Compressed size:', `${(processed.compressedSize / 1024).toFixed(2)} KB`);
      
      // Create preview from compressed blob
      const localPreviewUrl = URL.createObjectURL(processed.blob);
      
      // Add user message with compressed preview immediately to UI
      const userMessage = {
        id: tempMessageId,
        role: 'user',
        content: '',
        localPreviewUrl,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // Upload compressed base64 to ImgBB
      console.log('[Store] Uploading compressed image to ImgBB...');
      const imageUrl = await get().uploadBase64ToUrl(processed.base64);

      // Update message with imageUrl and remove localPreviewUrl
      set(state => ({
        messages: state.messages.map(msg => 
          msg.id === tempMessageId
            ? { ...msg, imageUrl, localPreviewUrl: null }
            : msg
        )
      }));

      // Clean up local preview URL
      URL.revokeObjectURL(localPreviewUrl);

      // Save to Firestore with imageUrl
      try {
        await get().saveMessageToFirestore('user', null, 'gemini-2.5-flash', imageUrl);
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
  generateImage: async (prompt) => {
    const tempMessageId = `temp-${Date.now()}`;
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api/generateImage';
      
      console.log('[Store] Calling image generation API:', apiUrl);
      console.log('[Store] Request body:', { prompt });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
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
        role: 'assistant',
        content: '',
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
      
      // Upload compressed base64 to ImgBB
      console.log('[Store] Uploading compressed generated image to ImgBB...');
      const imageUrl = await get().uploadBase64ToUrl(processed.base64);

      // Update message with imageUrl and remove imageBase64
      set(state => ({
        messages: state.messages.map(msg => 
          msg.id === tempMessageId
            ? { ...msg, imageUrl, imageBase64: null }
            : msg
        )
      }));

      // Save to Firestore with imageUrl
      try {
        await get().saveMessageToFirestore('assistant', '', 'gemini-2.5-flash', imageUrl);
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
    const { sessionId } = get();
    
    try {
      // Check if message requests image generation
      const lowerMessage = message.toLowerCase();
      const isImageRequest = lowerMessage.includes('generate an image') || 
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
          timestamp: Date.now()
        };

        set(state => ({
          messages: [...state.messages, userMessage]
        }));

        // Save user message to Firestore
        try {
          await get().saveMessageToFirestore('user', message);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed, continuing with API call:', firestoreError);
        }

        // Generate image instead of text response
        await get().generateImage(prompt);
        return null;
      }

      // Add user message immediately to UI
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // Save user message to Firestore
      try {
        await get().saveMessageToFirestore('user', message);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed, continuing with API call:', firestoreError);
        // Continue even if Firestore fails
      }

      // Call API
      const apiUrl = import.meta.env.VITE_API_URL || '/api/chat';
      const model = "gemini-2.5-flash";
      
      console.log('[Store] Calling API:', apiUrl);
      console.log('[Store] Request body:', { message, model });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          model: model
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
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, assistantMessage]
      }));

      // Save assistant message to Firestore
      try {
        await get().saveMessageToFirestore('assistant', data.reply || 'No response generated', model);
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
