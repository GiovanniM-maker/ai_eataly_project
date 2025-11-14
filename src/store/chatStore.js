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
import { DEFAULT_MODEL, isImagenModel } from '../constants/models';
import { resolveModelConfig } from '../lib/modelRouter';

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
        
        // Handle different message types
        if (data.type === 'image') {
          loadedMessages.push({
            id: doc.id,
            type: 'image',
            base64: data.base64 || null, // Load base64 from Firestore
            role: data.sender === 'user' ? 'user' : 'assistant',
            sender: data.sender,
            messageType: 'image',
            timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
            model: data.model || DEFAULT_MODEL
          });
          console.log('[Store] Loaded image message from Firestore, base64 length:', data.base64 ? data.base64.length : 0);
        } else if (data.type === 'vision') {
          loadedMessages.push({
            id: doc.id,
            type: 'vision',
            role: data.sender === 'user' ? 'user' : 'assistant',
            sender: data.sender,
            content: data.analysis || '',
            messageType: 'vision',
            timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
            model: data.model || DEFAULT_MODEL
          });
        } else if (data.type === 'audio') {
          loadedMessages.push({
            id: doc.id,
            type: 'audio',
            role: data.sender === 'user' ? 'user' : 'assistant',
            sender: data.sender,
            content: data.transcript || '',
            audioUrl: data.audioUrl || null,
            messageType: 'audio',
            timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
            model: data.model || DEFAULT_MODEL
          });
        } else {
          // Handle text messages (legacy structure)
          loadedMessages.push({
            id: doc.id,
            role: data.role,
            content: data.text || '',
            imageUrl: data.imageUrl || null, // Legacy support
            messageType: 'text',
            timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
            model: data.model || DEFAULT_MODEL
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
              
              // Handle different message types
              let newMessage;
              if (data.type === 'image') {
                newMessage = {
                  id: change.doc.id,
                  type: 'image',
                  base64: data.base64 || null, // Load base64 from Firestore
                  role: data.sender === 'user' ? 'user' : 'assistant',
                  sender: data.sender,
                  messageType: 'image',
                  timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
                  model: data.model || DEFAULT_MODEL
                };
                console.log('[Store] Realtime update: image message, base64 length:', data.base64 ? data.base64.length : 0);
              } else if (data.type === 'vision') {
                newMessage = {
                  id: change.doc.id,
                  type: 'vision',
                  role: data.sender === 'user' ? 'user' : 'assistant',
                  sender: data.sender,
                  content: data.analysis || '',
                  messageType: 'vision',
                  timestamp: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
                  model: data.model || DEFAULT_MODEL
                };
              } else if (data.type === 'audio') {
                newMessage = {
                  id: change.doc.id,
                  type: 'audio',
                  role: data.sender === 'user' ? 'user' : 'assistant',
                  sender: data.sender,
                  content: data.transcript || '',
                  audioUrl: data.audioUrl || null,
                  messageType: 'audio',
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
                  messageType: 'text',
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
   * Supports multiple message types: text, image
   */
  saveMessageToFirestore: async (role, text, model = DEFAULT_MODEL, imageBase64 = null, messageType = null) => {
    const { sessionId } = get();
    
    try {
      const messagesRef = getMessagesRef(sessionId);
      
      // Determine message type
      let finalType = messageType;
      if (!finalType && imageBase64) {
        finalType = 'image';
      } else if (!finalType) {
        finalType = 'text';
      }
      
      // Build message data based on type
      let messageData = {
        sender: role === 'user' ? 'user' : 'assistant',
        model,
        createdAt: serverTimestamp()
      };
      
      if (finalType === 'image') {
        messageData.type = 'image';
        // Store base64 as data URL: "data:image/png;base64,..."
        messageData.base64 = imageBase64 || null;
        console.log('[Store] Saving image message to Firestore with base64, length:', imageBase64 ? imageBase64.length : 0);
      } else {
        // Text message
        messageData.role = role;
        messageData.text = text || null;
      }

      const docRef = await addDoc(messagesRef, messageData);
      console.log('[Store] Message saved to Firestore successfully');
      console.log('[Store] Document ID:', docRef.id);
      console.log('[Store] Message type:', finalType);
      if (finalType === 'image') {
        console.log('[Store] Base64 length saved:', messageData.base64 ? messageData.base64.length : 0);
      }
      return docRef.id;
    } catch (error) {
      console.error('[Store] Error saving message to Firestore:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Send image message (user uploads image)
   * Converts file to base64 and saves to Firestore
   */
  sendImageMessage: async (file) => {
    const { sessionId, selectedModel } = get();
    const tempMessageId = `temp-${Date.now()}`;
    
    try {
      console.log('[Store] Processing user image upload...');
      console.log('[Store] File size:', `${(file.size / 1024).toFixed(2)} KB`);
      
      // Convert file to base64 data URL
      const base64DataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      console.log('[Store] Image converted to base64, length:', base64DataUrl.length, 'characters');
      
      // Add user message with base64 immediately to UI
      const userMessage = {
        id: tempMessageId,
        type: 'image',
        role: 'user',
        sender: 'user',
        base64: base64DataUrl,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      console.log('[Store] Image message added to UI, rendering from base64');

      // Save to Firestore with base64 (data URL format)
      try {
        await get().saveMessageToFirestore('user', null, selectedModel, base64DataUrl, 'image');
        console.log('[Store] User image message saved to Firestore successfully with base64');
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for image message:', firestoreError);
        // Remove message from UI if Firestore save fails
        set(state => ({
          messages: state.messages.filter(msg => msg.id !== tempMessageId)
        }));
        throw new Error('Failed to save image message to Firestore');
      }

      console.log('[Store] Image message saved successfully (base64 only, no external upload)');
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
   * Generate image from prompt (Imagen 4 via Vertex AI)
   */
  generateImagenImage: async (prompt, model = null) => {
    const { selectedModel } = get();
    const modelToUse = model || selectedModel;
    const config = resolveModelConfig(modelToUse);
    const tempMessageId = `temp-${Date.now()}`;
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || config.endpoint;
      
      console.log('[Store] ========================================');
      console.log('[Store] IMAGEN 4 IMAGE GENERATION REQUEST');
      console.log('[Store] Model:', modelToUse);
      console.log('[Store] Provider:', config.provider);
      console.log('[Store] Endpoint:', apiUrl);
      console.log('[Store] Prompt:', prompt);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.googleModel,
          prompt: prompt
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
      
      // Extract imageBase64 from response
      const imageBase64 = data.image || data.imageBase64;
      
      if (!imageBase64) {
        console.error('[Store] No image data in response:', data);
        throw new Error('No image data in API response');
      }

      // Create data URL for immediate display: "data:image/png;base64,..."
      const imageDataUrl = `data:image/png;base64,${imageBase64}`;
      
      console.log('[Store] Image extracted from API response');
      console.log('[Store] Final base64 length:', imageBase64.length, 'characters');

      // Add assistant message with base64 image
      const assistantMessage = {
        id: tempMessageId,
        type: 'image',
        role: 'assistant',
        sender: 'assistant',
        model: modelToUse,
        base64: imageDataUrl, // Store as data URL for display
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, assistantMessage]
      }));

      console.log('[Store] Image message added to UI, rendering from base64');

      // Save to Firestore with base64 (data URL format)
      try {
        await get().saveMessageToFirestore('assistant', '', modelToUse, imageDataUrl, 'image');
        console.log('[Store] Image message saved to Firestore successfully with base64');
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for generated image:', firestoreError);
        // Remove message from UI if Firestore save fails
        set(state => ({
          messages: state.messages.filter(msg => msg.id !== tempMessageId)
        }));
        throw new Error('Failed to save generated image to Firestore');
      }

      console.log('[Store] Generated image saved successfully (base64 only, no external upload)');
      return imageDataUrl;
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
   * Generate image from prompt (Nanobanana via Vertex AI streaming)
   */
  generateNanobananaImage: async (prompt, model = null) => {
    const { selectedModel } = get();
    const modelToUse = model || selectedModel;
    const config = resolveModelConfig(modelToUse);
    const tempMessageId = `temp-${Date.now()}`;
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || config.endpoint;
      
      console.log('[Store] ========================================');
      console.log('[Store] NANOBANANA IMAGE GENERATION REQUEST');
      console.log('[Store] Model:', modelToUse);
      console.log('[Store] Provider:', config.provider);
      console.log('[Store] Endpoint:', apiUrl);
      console.log('[Store] Prompt:', prompt);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.googleModel,
          prompt: prompt
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
      
      // Extract imageBase64 from response
      const imageBase64 = data.image || data.imageBase64;
      
      if (!imageBase64) {
        console.error('[Store] No image data in response:', data);
        throw new Error('No image data in API response');
      }

      // Create data URL for immediate display: "data:image/png;base64,..."
      const imageDataUrl = `data:image/png;base64,${imageBase64}`;
      
      console.log('[Store] Image extracted from API response');
      console.log('[Store] Final base64 length:', imageBase64.length, 'characters');

      // Add assistant message with base64 image
      const assistantMessage = {
        id: tempMessageId,
        type: 'image',
        role: 'assistant',
        sender: 'assistant',
        model: modelToUse,
        base64: imageDataUrl, // Store as data URL for display
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, assistantMessage]
      }));

      console.log('[Store] Image message added to UI, rendering from base64');

      // Save to Firestore with base64 (data URL format)
      try {
        await get().saveMessageToFirestore('assistant', '', modelToUse, imageDataUrl, 'image');
        console.log('[Store] Image message saved to Firestore successfully with base64');
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for generated image:', firestoreError);
        // Remove message from UI if Firestore save fails
        set(state => ({
          messages: state.messages.filter(msg => msg.id !== tempMessageId)
        }));
        throw new Error('Failed to save generated image to Firestore');
      }

      console.log('[Store] Generated image saved successfully (base64 only, no external upload)');
      return imageDataUrl;
    } catch (error) {
      console.error('[Store] Error generating Nanobanana image:', error);
      // Remove message from UI on error
      set(state => ({
        messages: state.messages.filter(msg => msg.id !== tempMessageId)
      }));
      throw error;
    }
  },

  /**
   * Send a message using automatic model routing
   */
  sendMessage: async (message) => {
    const { sessionId, selectedModel } = get();
    
    try {
      // Resolve model configuration (endpoint, type, googleModel)
      const config = resolveModelConfig(selectedModel);
      console.log('[Store] Model config resolved:', config);

      // Add user message immediately to UI
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message,
        model: selectedModel,
        messageType: config.type,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // Save user message to Firestore
      try {
        await get().saveMessageToFirestore('user', message, selectedModel, null, config.type);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for user message, continuing with API call:', firestoreError);
      }

      // Route to appropriate handler based on model provider
      if (config.provider === 'nanobanana') {
        // Nanobanana via Vertex AI generateContent
        const prompt = message;
        await get().generateNanobananaImage(prompt, selectedModel);
        return null;
      } else if (config.provider === 'imagen') {
        // Imagen 4 via Vertex AI generateImage
        const prompt = message;
        await get().generateImagenImage(prompt, selectedModel);
        return null;
      } else if (config.provider === 'google-text') {
        // Text generation (default)
        const apiUrl = import.meta.env.VITE_API_URL || config.endpoint;
        
        console.log('[Store] Calling API:', apiUrl);
        console.log('[Store] Request body:', { message, model: config.googleModel });

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: message,
            model: config.googleModel
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
          messageType: 'text',
          timestamp: Date.now()
        };

        set(state => ({
          messages: [...state.messages, assistantMessage]
        }));

        // Save assistant message to Firestore
        try {
          await get().saveMessageToFirestore('assistant', data.reply || 'No response generated', selectedModel, null, 'text');
          console.log('[Store] Text message saved to Firestore successfully');
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant message:', firestoreError);
        }

        return data.reply;
      }
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
