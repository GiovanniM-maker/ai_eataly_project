// [DEBUG] chats array is defined here: line 84
// [DEBUG] currentChatId is managed here: line 83 (synced with activeChatId)
// [DEBUG] messages are loaded based on chatId here: loadMessages() at line 484

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
  serverTimestamp,
  updateDoc,
  deleteDoc,
  writeBatch,
  setDoc,
  Timestamp
} from 'firebase/firestore';
import { db, app } from '../config/firebase';
import { DEFAULT_MODEL, isImagenModel } from '../constants/models';
import { resolveModelConfig } from '../lib/modelRouter';
import { loadPipelineConfig as loadChatPipelineConfig, savePipelineConfig as saveChatPipelineConfig } from '../lib/pipelineConfig';

/**
 * Get or create user ID from localStorage
 */
const getUserId = () => {
  const stored = localStorage.getItem('user_id');
  if (stored) {
    return stored;
  }
  const newUserId = uuidv4();
  localStorage.setItem('user_id', newUserId);
  console.log('[Store] New user ID created:', newUserId);
  return newUserId;
};

/**
 * Get or create session ID from localStorage (legacy, now uses activeChatId)
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
 * Get chats collection reference
 */
const getChatsRef = (userId) => {
  return collection(db, 'users', userId, 'chats');
};

/**
 * Get messages collection reference
 */
const getMessagesRef = (chatId) => {
  const userId = getUserId();
  return collection(db, 'users', userId, 'chats', chatId, 'messages');
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
 * Chat store with Firestore persistence and sidebar management
 */
export const useChatStore = create((set, get) => ({
  messages: [],
  sessionId: getSessionId(), // Legacy support
  activeChatId: null, // Current active chat ID
  currentChatId: null, // Alias for activeChatId (exposed for compatibility)
  chats: [], // List of all chats
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
   * Load all chats from Firestore
   */
  loadChatsFromFirestore: async () => {
    const userId = getUserId();
    set({ loading: true, firestoreError: null });

    try {
      console.log('[Store] Loading chats for user:', userId);
      const chatsRef = getChatsRef(userId);
      
      // Query: orderBy pinned desc, orderBy order asc, orderBy updatedAt desc
      const q = query(
        chatsRef,
        orderBy('pinned', 'desc'),
        orderBy('order', 'asc'),
        orderBy('updatedAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      const loadedChats = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        loadedChats.push({
          id: doc.id,
          title: data.title || 'Nuova chat',
          createdAt: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now(),
          updatedAt: data.updatedAt?.toMillis?.() || data.updatedAt?.seconds * 1000 || Date.now(),
          pinned: data.pinned || false,
          order: data.order || 0
        });
      });

      // Sort: pinned first (desc), then by order (asc), then by updatedAt (desc)
      loadedChats.sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return b.pinned - a.pinned; // pinned first
        }
        if (a.pinned) {
          return a.order - b.order; // pinned: order asc
        }
        return a.order - b.order; // unpinned: order asc
      });

      console.log('[Store] Loaded', loadedChats.length, 'chats from Firestore');
      set({ chats: loadedChats, loading: false });
      
      return loadedChats;
    } catch (error) {
      console.error('[Store] Error loading chats:', error);
      set({ firestoreError: error.message, loading: false });
      return [];
    }
  },

  /**
   * Create a new chat
   */
  createNewChat: async () => {
    const userId = getUserId();
    
    try {
      console.log('[Store] Creating new chat...');
      
      // Get current chats to determine next order
      const { chats } = get();
      const maxOrder = chats.length > 0 
        ? Math.max(...chats.map(c => c.order || 0))
        : -1;
      
      const now = Date.now();
      const chatData = {
        title: 'Nuova chat',
        createdAt: Timestamp.fromMillis(now),
        updatedAt: Timestamp.fromMillis(now),
        pinned: false,
        order: maxOrder + 1
      };

      const chatsRef = getChatsRef(userId);
      const docRef = await addDoc(chatsRef, chatData);
      
      const newChat = {
        id: docRef.id,
        ...chatData,
        createdAt: now,
        updatedAt: now
      };

      // Add to local state
      set(state => ({
        chats: [...state.chats, newChat],
        activeChatId: docRef.id,
        currentChatId: docRef.id, // Update alias
        sessionId: docRef.id // Update sessionId for backward compatibility
      }));

      // Update localStorage
      localStorage.setItem('chat_session_id', docRef.id);
      
      console.log('[Store] New chat created:', docRef.id);
      
      // Load messages for new chat (will be empty)
      await get().loadMessages();
      
      return docRef.id;
    } catch (error) {
      console.error('[Store] Error creating chat:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Rename a chat
   */
  renameChat: async (chatId, newTitle) => {
    const userId = getUserId();
    
    try {
      console.log('RENAME →', chatId, '→', newTitle);
      
      const chatRef = doc(db, 'users', userId, 'chats', chatId);
      await updateDoc(chatRef, {
        title: newTitle,
        updatedAt: serverTimestamp()
      });

      // Update local state
      set(state => ({
        chats: state.chats.map(chat => 
          chat.id === chatId 
            ? { ...chat, title: newTitle, updatedAt: Date.now() }
            : chat
        )
      }));

      console.log('[Store] Chat renamed successfully');
    } catch (error) {
      console.error('[Store] Error renaming chat:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Delete a chat and all its messages
   */
  deleteChat: async (chatId) => {
    const userId = getUserId();
    
    try {
      console.log('DELETE →', chatId);
      
      // Delete all messages first
      const messagesRef = getMessagesRef(chatId);
      const messagesSnapshot = await getDocs(messagesRef);
      
      const batch = writeBatch(db);
      messagesSnapshot.forEach((messageDoc) => {
        batch.delete(messageDoc.ref);
      });
      await batch.commit();
      
      // Delete chat document
      const chatRef = doc(db, 'users', userId, 'chats', chatId);
      await deleteDoc(chatRef);

      // Update local state
      const { activeChatId } = get();
      let newActiveChatId = activeChatId;
      
      // If deleted chat was active, select most recent available
      if (activeChatId === chatId) {
        const { chats } = get();
        const remainingChats = chats.filter(c => c.id !== chatId);
        if (remainingChats.length > 0) {
          // Sort by updatedAt desc and pick first
          remainingChats.sort((a, b) => b.updatedAt - a.updatedAt);
          newActiveChatId = remainingChats[0].id;
          localStorage.setItem('chat_session_id', newActiveChatId);
        } else {
          newActiveChatId = null;
        }
      }

      set(state => ({
        chats: state.chats.filter(chat => chat.id !== chatId),
        activeChatId: newActiveChatId,
        currentChatId: newActiveChatId, // Update alias
        sessionId: newActiveChatId || state.sessionId,
        messages: newActiveChatId === chatId ? [] : state.messages
      }));

      // Load messages for new active chat if changed
      if (newActiveChatId && newActiveChatId !== activeChatId) {
        await get().loadMessages();
      } else if (!newActiveChatId) {
        set({ messages: [] });
      }

      console.log('[Store] Chat deleted successfully');
    } catch (error) {
      console.error('[Store] Error deleting chat:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Toggle pin status (max 3 pinned)
   */
  togglePin: async (chatId) => {
    const userId = getUserId();
    
    try {
      const { chats } = get();
      const chat = chats.find(c => c.id === chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      const newPinned = !chat.pinned;
      
      // Check max 3 pinned limit
      if (newPinned) {
        const pinnedCount = chats.filter(c => c.pinned).length;
        if (pinnedCount >= 3) {
          throw new Error('Massimo 3 chat possono essere fissate');
        }
      }

      console.log('[Store] Toggling pin for chat:', chatId, 'to:', newPinned);
      
      const chatRef = doc(db, 'users', userId, 'chats', chatId);
      await updateDoc(chatRef, {
        pinned: newPinned,
        updatedAt: serverTimestamp()
      });

      // Update local state
      set(state => ({
        chats: state.chats.map(c => 
          c.id === chatId 
            ? { ...c, pinned: newPinned, updatedAt: Date.now() }
            : c
        )
      }));

      // Reload chats to maintain correct order
      await get().loadChatsFromFirestore();
      
      console.log('[Store] Pin toggled successfully');
    } catch (error) {
      console.error('[Store] Error toggling pin:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Reorder chats (only unpinned)
   */
  reorderChats: async (newOrder) => {
    const userId = getUserId();
    
    try {
      console.log('[Store] Reordering chats:', newOrder);
      
      const batch = writeBatch(db);
      
      newOrder.forEach((chatId, index) => {
        const chatRef = doc(db, 'users', userId, 'chats', chatId);
        batch.update(chatRef, {
          order: index,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();

      // Update local state
      set(state => ({
        chats: state.chats.map(chat => {
          const newIndex = newOrder.indexOf(chat.id);
          if (newIndex !== -1 && !chat.pinned) {
            return { ...chat, order: newIndex, updatedAt: Date.now() };
          }
          return chat;
        })
      }));

      console.log('[Store] Chats reordered successfully');
    } catch (error) {
      console.error('[Store] Error reordering chats:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Set active chat
   */
  setActiveChat: async (chatId) => {
    try {
      console.log('[Store] Setting active chat:', chatId);
      
      set({ 
        activeChatId: chatId,
        currentChatId: chatId, // Update alias
        sessionId: chatId, // Update sessionId for backward compatibility
        messages: [] // Clear messages, will be loaded
      });

      // Update localStorage
      localStorage.setItem('chat_session_id', chatId);
      
      // Load messages for the new active chat
      await get().loadMessages();
      
      console.log('[Store] Active chat set successfully');
    } catch (error) {
      console.error('[Store] Error setting active chat:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Select chat (alias for setActiveChat with debug log)
   */
  selectChat: async (chatId) => {
    console.log('[STORE] selectChat ->', chatId);
    await get().setActiveChat(chatId);
  },

  /**
   * Create chat (alias for createNewChat)
   */
  createChat: async () => {
    console.log('CREATE CHAT');
    return await get().createNewChat();
  },

  /**
   * Pin chat (alias for togglePin with debug log)
   */
  pinChat: async (chatId) => {
    console.log('PIN/UNPIN →', chatId);
    await get().togglePin(chatId);
  },

  /**
   * Move chat (move up or down) - alias for reorderChat
   */
  moveChat: async (chatId, direction) => {
    console.log('[STORE] moveChat', chatId, direction);
    await get().reorderChat(chatId, direction);
  },

  /**
   * Reorder chat (move up or down)
   */
  reorderChat: async (chatId, direction) => {
    const { chats } = get();
    const unpinnedChats = chats.filter(c => !c.pinned);
    const currentIndex = unpinnedChats.findIndex(c => c.id === chatId);
    
    if (currentIndex === -1) {
      console.warn('[Store] Chat not found or is pinned:', chatId);
      return;
    }

    let newIndex;
    if (direction === 'up' && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else if (direction === 'down' && currentIndex < unpinnedChats.length - 1) {
      newIndex = currentIndex + 1;
    } else {
      return; // Can't move further
    }

    const newOrder = [...unpinnedChats];
    [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
    const newOrderIds = newOrder.map(c => c.id);
    
    console.log('REORDER CHAT →', chatId, direction);
    await get().reorderChats(newOrderIds);
  },

  /**
   * Load messages from Firestore
   */
  loadMessages: async () => {
    const { activeChatId, sessionId } = get();
    const chatId = activeChatId || sessionId;
    
    if (!chatId) {
      console.log('[Store] No active chat, skipping message load');
      return [];
    }
    
    set({ loading: true, firestoreError: null });

    try {
      console.log('[Store] Loading messages for chat:', chatId);
      const messagesRef = getMessagesRef(chatId);
      const q = query(messagesRef, orderBy('createdAt', 'asc'));
      
      const querySnapshot = await getDocs(q);
      const loadedMessages = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        
        // Handle different message types
        // NOTE: Images are NOT loaded from Firestore (cache-only mode)
        // Only text messages are persisted
        if (data.type === 'image') {
          // Skip image messages - they are cache-only
          console.log('[Store] Skipping image message from Firestore (cache-only mode)');
          return;
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
    const { activeChatId, sessionId, unsubscribe } = get();
    const chatId = activeChatId || sessionId;
    
    if (!chatId) {
      console.log('[Store] No active chat, skipping realtime listener');
      return;
    }
    
    // Clean up existing listener
    if (unsubscribe) {
      unsubscribe();
    }

    try {
      console.log('[Store] Setting up realtime listener for chat:', chatId);
      const messagesRef = getMessagesRef(chatId);
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
              // NOTE: Images are NOT loaded from Firestore (cache-only mode)
              let newMessage;
              if (data.type === 'image') {
                // Skip image messages - they are cache-only
                console.log('[Store] Skipping image message from realtime update (cache-only mode)');
                return;
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
   * Save message to Firestore (TEXT ONLY - images are NOT persisted)
   * Images are stored only in local cache (Zustand state)
   */
  saveMessageWithoutImageToFirestore: async (role, text, model = DEFAULT_MODEL) => {
    const { activeChatId, sessionId } = get();
    const chatId = activeChatId || sessionId;
    
    if (!chatId) {
      console.warn('[Store] No active chat, cannot save message');
      return null;
    }
    
    try {
      const messagesRef = getMessagesRef(chatId);
      
      // Build message data for text messages only
      const messageData = {
        role: role,
        sender: role === 'user' ? 'user' : 'assistant',
        text: text || null,
        model,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(messagesRef, messageData);
      console.log('[Store] Text message saved to Firestore successfully');
      console.log('[Store] Document ID:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('[Store] Error saving text message to Firestore:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Save image to Firebase Storage (STUB - to be implemented tomorrow)
   * For now, images are stored only in local cache
   */
  saveImageToStorage: async (imageBase64, messageId) => {
    // TODO: Implement Firebase Storage upload tomorrow
    console.log('[Store] saveImageToStorage() called but not implemented yet');
    console.log('[Store] Image saved in local cache (NOT persisted).');
    return null;
  },

  /**
   * Send image message (user uploads image)
   * Converts file to base64 and stores ONLY in local cache (NOT persisted)
   */
  sendImageMessage: async (file) => {
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
      
      // Add user message with base64 immediately to UI (local cache only)
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
      console.log('[Store] Image saved in local cache (NOT persisted).');

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

      // Build modelSettings from current config
      const modelSettings = get().buildModelSettings(modelToUse);
      const { debugMode } = get();
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.googleModel,
          prompt: prompt,
          ...(modelSettings && { modelSettings }),
          debugMode: debugMode
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

      // Add assistant message with base64 image (local cache only)
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
      console.log('[Store] Image saved in local cache (NOT persisted).');

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

      // Build modelSettings from current config
      const modelSettings = get().buildModelSettings(modelToUse);
      const { debugMode } = get();
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.googleModel,
          prompt: prompt,
          ...(modelSettings && { modelSettings }),
          debugMode: debugMode
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
      console.log('[Store] Nanobanana response received');
      
      // Handle TEXT+IMAGE, TEXT, or IMAGE responses
      const hasText = data.text || data.reply;
      const imageBase64 = data.image || data.imageBase64;
      
      if (hasText && imageBase64) {
        // TEXT+IMAGE mode
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        
        // Add text message first
        const textMessage = {
          id: tempMessageId,
          role: 'assistant',
          content: hasText,
          model: modelToUse,
          messageType: 'text',
          timestamp: Date.now()
        };
        
        // Add image message
        const imageMessage = {
          id: `${tempMessageId}-img`,
          type: 'image',
          role: 'assistant',
          sender: 'assistant',
          model: modelToUse,
          base64: imageDataUrl,
          timestamp: Date.now() + 1
        };
        
        set(state => ({
          messages: [...state.messages, textMessage, imageMessage]
        }));
        
        // Save text to Firestore
        try {
          await get().saveMessageWithoutImageToFirestore('assistant', hasText, modelToUse);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant text:', firestoreError);
        }
        
        console.log('[Store] TEXT+IMAGE messages added to UI');
        return imageDataUrl;
      } else if (hasText) {
        // TEXT only mode
        const textMessage = {
          id: tempMessageId,
          role: 'assistant',
          content: hasText,
          model: modelToUse,
          messageType: 'text',
          timestamp: Date.now()
        };
        
        set(state => ({
          messages: [...state.messages, textMessage]
        }));
        
        // Save text to Firestore
        try {
          await get().saveMessageWithoutImageToFirestore('assistant', hasText, modelToUse);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant text:', firestoreError);
        }
        
        console.log('[Store] TEXT message added to UI');
        return hasText;
      } else if (imageBase64) {
        // IMAGE only mode
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        
        const assistantMessage = {
          id: tempMessageId,
          type: 'image',
          role: 'assistant',
          sender: 'assistant',
          model: modelToUse,
          base64: imageDataUrl,
          timestamp: Date.now()
        };

        set(state => ({
          messages: [...state.messages, assistantMessage]
        }));

        console.log('[Store] Image message added to UI, rendering from base64');
        console.log('[Store] Image saved in local cache (NOT persisted).');

        return imageDataUrl;
      } else {
        console.error('[Store] No text or image data in response:', data);
        throw new Error('No text or image data in API response');
      }
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
   * Includes pipeline pre-processing if enabled
   */
  sendMessage: async (message) => {
    const { activeChatId, sessionId, selectedModel } = get();
    const chatId = activeChatId || sessionId;
    
    // If no active chat, create one
    if (!chatId) {
      console.log('[Store] No active chat, creating new chat...');
      const newChatId = await get().createNewChat();
      set({ activeChatId: newChatId, sessionId: newChatId });
    }
    
    try {
      // 1) Load pipeline config for this chat
      let finalUserMessage = message;
      let pipelineUsed = false;
      
      try {
        const pipeline = await loadChatPipelineConfig(chatId);
        
        if (pipeline.enabled && pipeline.model && pipeline.systemInstruction) {
          console.log('[PIPELINE] Enabled: true');
          console.log('[PIPELINE] Model used:', pipeline.model);
          console.log('[PIPELINE] System instruction length:', pipeline.systemInstruction.length);
          console.log('[PIPELINE] Preprocessed user input:', message);
          
          // Call pre-model API
          const apiUrl = import.meta.env.VITE_API_URL || '/api/chat';
          const preModelConfig = resolveModelConfig(pipeline.model);
          
          // Build system instruction tag (Gemini format)
          const systemTag = pipeline.systemInstruction && pipeline.systemInstruction.trim() !== ""
            ? `<system_instruction>${pipeline.systemInstruction}</system_instruction>\n`
            : "";
          
          const preMessageText = systemTag + message;
          
          const preModelSettings = {
            temperature: pipeline.temperature,
            top_p: pipeline.topP,
            max_output_tokens: pipeline.maxTokens
          };
          
          console.log('[PIPELINE] Calling pre-model API:', pipeline.model);
          
          const preResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: preMessageText,
              model: preModelConfig.googleModel,
              modelSettings: preModelSettings
            }),
          });
          
          if (!preResponse.ok) {
            throw new Error(`Pre-model API error: ${preResponse.status}`);
          }
          
          const preData = await preResponse.json();
          finalUserMessage = preData.reply || message;
          pipelineUsed = true;
          
          console.log('[PIPELINE] Output from pre-model:', finalUserMessage);
          console.log('[PIPELINE] Forwarding to main model');
        } else {
          console.log('[PIPELINE] Disabled or incomplete config');
        }
      } catch (pipelineError) {
        console.error('[PIPELINE] Error in pipeline pre-processing:', pipelineError);
        console.warn('[PIPELINE] Continuing with original message');
        // Continue with original message if pipeline fails
      }
      
      // 2) Resolve model configuration (endpoint, type, googleModel)
      const config = resolveModelConfig(selectedModel);
      console.log('[Store] Model config resolved:', config);

      // 3) Add user message immediately to UI (show original message, not preprocessed)
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message, // Show original message to user
        model: selectedModel,
        messageType: config.type,
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // 4) Save user message to Firestore (TEXT ONLY - images are not persisted)
      if (config.type !== 'image') {
        try {
          await get().saveMessageWithoutImageToFirestore('user', message, selectedModel);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for user message, continuing with API call:', firestoreError);
        }
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

        // Build modelSettings from current config
        const modelSettings = get().buildModelSettings(selectedModel);
        const { debugMode } = get();
        
        // Create abort controller for stopping generation
        const controller = new AbortController();
        get().setAbortController(controller);
        get().setIsGenerating(true);
        
        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              message: finalUserMessage, // Use preprocessed message if pipeline was used
              model: config.googleModel,
              ...(modelSettings && { modelSettings }),
              debugMode: debugMode
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
          timestamp: Date.now(),
          preprocessedBy: data.preprocessedBy || null // Track if pre-processed
        };

          set(state => ({
            messages: [...state.messages, assistantMessage]
          }));

          // Save assistant message to Firestore (TEXT ONLY)
          try {
            await get().saveMessageWithoutImageToFirestore('assistant', data.reply || 'No response generated', selectedModel);
            console.log('[Store] Text message saved to Firestore successfully');
          } catch (firestoreError) {
            console.warn('[Store] Firestore save failed for assistant message:', firestoreError);
          }

          get().setIsGenerating(false);
          get().setAbortController(null);
          return data.reply;
        } catch (error) {
          get().setIsGenerating(false);
          get().setAbortController(null);
          
          if (error.name === 'AbortError') {
            console.log('[Store] Generation aborted by user');
            // Remove the last assistant message if it was being generated
            set(state => ({
              messages: state.messages.filter(msg => msg.role !== 'assistant' || msg.id !== `temp-${Date.now() + 1}`)
            }));
            return null;
          }
          throw error;
        }
      }
    } catch (error) {
      console.error('[Store] Error sending message:', error);
      throw error;
    }
  },


  /**
   * Clear all messages and create new session
   */
  clearMessages: async () => {
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe();
    }
    
    // Create new chat
    const newChatId = await get().createNewChat();
    
      set({ 
        messages: [], 
        sessionId: newChatId,
        activeChatId: newChatId,
        currentChatId: newChatId, // Update alias
        unsubscribe: null,
        firestoreError: null
      });
    
    console.log('[Store] New chat created:', newChatId);
  },

  /**
   * Message Actions
   */
  abortController: null, // For stopping generation
  isGenerating: false, // Generation state

  /**
   * Update a message in the messages array
   */
  updateMessage: (messageId, updates) => {
    set(state => ({
      messages: state.messages.map(msg => 
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }));
  },

  /**
   * Get previous user message before a given message
   */
  getPreviousUserMessage: (messageId) => {
    const { messages } = get();
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return null;
    
    // Find the last user message before this message
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i];
      }
    }
    return null;
  },

  /**
   * Regenerate response for a message
   */
  regenerateMessage: async (messageId) => {
    const { messages, selectedModel } = get();
    const message = messages.find(msg => msg.id === messageId);
    
    if (!message || message.role !== 'assistant') {
      console.error('[Store] Cannot regenerate: message not found or not assistant message');
      return;
    }

    // Find the previous user message
    const userMessage = get().getPreviousUserMessage(messageId);
    if (!userMessage) {
      console.error('[Store] Cannot regenerate: no previous user message found');
      return;
    }

    console.log('[Store] Regenerating response for message:', messageId);
    
    // Remove the old assistant message
    set(state => ({
      messages: state.messages.filter(msg => msg.id !== messageId)
    }));

    // Resend the user message to get a new response
    try {
      await get().sendMessage(userMessage.content);
    } catch (error) {
      console.error('[Store] Error regenerating message:', error);
      throw error;
    }
  },

  /**
   * Edit user message and regenerate response
   */
  editUserMessage: async (messageId, newText) => {
    const { messages } = get();
    const message = messages.find(msg => msg.id === messageId);
    
    if (!message || message.role !== 'user') {
      console.error('[Store] Cannot edit: message not found or not user message');
      return;
    }

    console.log('[Store] Editing user message:', messageId);
    
    // Update the user message text
    get().updateMessage(messageId, { content: newText });
    
    // Find and remove all assistant messages after this user message
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    const messagesToKeep = messages.slice(0, messageIndex + 1);
    const messagesToRemove = messages.slice(messageIndex + 1);
    
    set({ messages: messagesToKeep });
    
    // Save updated user message to Firestore
    try {
      const { selectedModel } = get();
      await get().saveMessageWithoutImageToFirestore('user', newText, selectedModel);
    } catch (error) {
      console.warn('[Store] Failed to save edited message to Firestore:', error);
    }

    // Regenerate response with new text
    try {
      await get().sendMessage(newText);
    } catch (error) {
      console.error('[Store] Error regenerating after edit:', error);
      throw error;
    }
  },

  /**
   * Set abort controller for stopping generation
   */
  setAbortController: (controller) => {
    set({ abortController: controller });
  },

  /**
   * Stop generation
   */
  stopGeneration: () => {
    const { abortController } = get();
    if (abortController) {
      console.log('[Store] Stopping generation...');
      abortController.abort();
      set({ abortController: null, isGenerating: false });
    }
  },

  /**
   * Set generation state
   */
  setIsGenerating: (generating) => {
    set({ isGenerating: generating });
  },

  /**
   * Model Configuration Management
   */
  modelConfigs: {}, // Cache for model configs
  debugMode: false, // DEBUG MODE toggle

  /**
   * Load model configuration from Firestore
   */
  loadModelConfig: async (modelId) => {
    try {
      // Check cache first
      const { modelConfigs } = get();
      if (modelConfigs[modelId]) {
        return modelConfigs[modelId];
      }

      console.log('[Store] Loading model config for:', modelId);
      const configRef = doc(db, 'modelConfigs', modelId);
      const configSnap = await getDoc(configRef);

      if (configSnap.exists()) {
        const data = configSnap.data();
        const config = {
          modelId: data.modelId || modelId,
          displayName: data.displayName || modelId,
          description: data.description || '',
          systemPrompt: data.systemPrompt || '',
          temperature: data.temperature ?? 0.7,
          topP: data.topP ?? 0.95,
          maxOutputTokens: data.maxOutputTokens ?? 8192,
          outputType: data.outputType || 'TEXT',
          aspectRatio: data.aspectRatio || '1:1',
          sampleCount: data.sampleCount ?? 1,
          safetySettings: data.safetySettings || {},
          enabled: data.enabled !== false,
          updatedAt: data.updatedAt || Date.now()
        };
        
        // Update cache
        set(state => ({
          modelConfigs: { ...state.modelConfigs, [modelId]: config }
        }));
        
        return config;
      } else {
        // Create default config
        const defaultConfig = {
          modelId,
          displayName: modelId,
          description: '',
          systemPrompt: '',
          temperature: 0.7,
          topP: 0.95,
          maxOutputTokens: 8192,
          outputType: modelId.includes('image') || modelId.includes('imagen') ? 'IMAGE' : 'TEXT',
          aspectRatio: '1:1',
          sampleCount: 1,
          safetySettings: {},
          enabled: true,
          updatedAt: Date.now()
        };
        
        // Save default to Firestore
        await setDoc(configRef, defaultConfig);
        
        // Update cache
        set(state => ({
          modelConfigs: { ...state.modelConfigs, [modelId]: defaultConfig }
        }));
        
        return defaultConfig;
      }
    } catch (error) {
      console.error('[Store] Error loading model config:', error);
      // Return default config on error
      return {
        modelId,
        displayName: modelId,
        description: '',
        systemPrompt: '',
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 8192,
        outputType: 'TEXT',
        aspectRatio: '1:1',
        sampleCount: 1,
        safetySettings: {},
        enabled: true,
        updatedAt: Date.now()
      };
    }
  },

  /**
   * Save model configuration to Firestore
   */
  saveModelConfig: async (config) => {
    try {
      console.log('[Store] Saving model config for:', config.modelId);
      const configRef = doc(db, 'modelConfigs', config.modelId);
      
      const configData = {
        ...config,
        updatedAt: Date.now()
      };
      
      await setDoc(configRef, configData, { merge: true });
      
      // Update cache
      set(state => ({
        modelConfigs: { ...state.modelConfigs, [config.modelId]: configData }
      }));
      
      console.log('[Store] Model config saved successfully');
      return true;
    } catch (error) {
      console.error('[Store] Error saving model config:', error);
      set({ firestoreError: error.message });
      throw error;
    }
  },

  /**
   * Set DEBUG MODE
   */
  setDebugMode: (enabled) => {
    set({ debugMode: enabled });
    console.log('[Store] DEBUG MODE:', enabled ? 'ENABLED' : 'DISABLED');
  },

  /**
   * Build modelSettings object from current model config
   */
  buildModelSettings: (modelId) => {
    const { modelConfigs } = get();
    const config = modelConfigs[modelId];
    
    if (!config) {
      return null;
    }
    
    const modelSettings = {};
    
    if (config.systemPrompt) {
      modelSettings.system = config.systemPrompt;
    }
    
    if (config.temperature !== undefined) {
      modelSettings.temperature = config.temperature;
    }
    
    if (config.topP !== undefined) {
      modelSettings.top_p = config.topP;
    }
    
    if (config.maxOutputTokens !== undefined) {
      modelSettings.max_output_tokens = config.maxOutputTokens;
    }
    
    // For image models
    if (config.aspectRatio) {
      modelSettings.aspect_ratio = config.aspectRatio;
    }
    
    // For Nanobanana
    if (config.outputType) {
      // Map Firestore outputType to API format
      const outputTypeMap = {
        'TEXT': 'text',
        'IMAGE': 'image',
        'TEXT+IMAGE': 'both'
      };
      modelSettings.output_type = outputTypeMap[config.outputType] || config.outputType.toLowerCase();
    }
    
    return Object.keys(modelSettings).length > 0 ? modelSettings : null;
  },

  /**
   * Load all model configs
   */
  loadAllModelConfigs: async () => {
    try {
      console.log('[Store] Loading all model configs');
      const configsRef = collection(db, 'modelConfigs');
      const snapshot = await getDocs(configsRef);
      
      const configs = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        configs[doc.id] = {
          modelId: doc.id,
          displayName: data.displayName || doc.id,
          description: data.description || '',
          systemPrompt: data.systemPrompt || '',
          temperature: data.temperature ?? 0.7,
          topP: data.topP ?? 0.95,
          maxOutputTokens: data.maxOutputTokens ?? 8192,
          outputType: data.outputType || 'TEXT',
          aspectRatio: data.aspectRatio || '1:1',
          sampleCount: data.sampleCount ?? 1,
          safetySettings: data.safetySettings || {},
          enabled: data.enabled !== false,
          updatedAt: data.updatedAt || Date.now()
        };
      });
      
      set({ modelConfigs: configs });
      console.log('[Store] Loaded', Object.keys(configs).length, 'model configs');
      return configs;
    } catch (error) {
      console.error('[Store] Error loading all model configs:', error);
      return {};
    }
  },

  /**
   * Pipeline Configuration Management (per-chat)
   */
  pipelineConfig: null, // Cache for current chat's pipeline config

  /**
   * Load pipeline configuration for current active chat
   */
  loadPipelineConfig: async () => {
    try {
      const { activeChatId } = get();
      if (!activeChatId) {
        return {
          enabled: false,
          model: null,
          systemInstruction: '',
          temperature: 0.8,
          topP: 0.95,
          maxTokens: 2048
        };
      }

      // Load from Firestore using the new per-chat structure
      const config = await loadChatPipelineConfig(activeChatId);
      
      // Update cache
      set({ pipelineConfig: config });
      
      return config;
    } catch (error) {
      console.error('[Store] Error loading pipeline config:', error);
      return {
        enabled: false,
        model: null,
        systemInstruction: '',
        temperature: 0.8,
        topP: 0.95,
        maxTokens: 2048
      };
    }
  },

  /**
   * Save pipeline configuration for current active chat
   */
  savePipelineConfig: async (config) => {
    try {
      const { activeChatId } = get();
      if (!activeChatId) {
        throw new Error('No active chat to save pipeline config');
      }

      console.log('[Store] Saving pipeline config for chat:', activeChatId);
      await saveChatPipelineConfig(activeChatId, config);
      
      // Update cache
      set({ pipelineConfig: config });
      
      console.log('[Store] Pipeline config saved successfully');
      return true;
    } catch (error) {
      console.error('[Store] Error saving pipeline config:', error);
      set({ firestoreError: error.message });
      throw error;
    }
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
