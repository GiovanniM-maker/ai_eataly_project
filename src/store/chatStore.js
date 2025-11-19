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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, app, storage } from '../config/firebase';
import { DEFAULT_MODEL } from '../constants/models';
import { resolveModelConfig } from '../lib/modelRouter';
import { loadPipelineConfig as loadChatPipelineConfig, savePipelineConfig as saveChatPipelineConfig } from '../lib/pipelineConfig';
import { modelSupportsOption } from '../lib/modelCapabilities';

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
  userId: getUserId(), // User ID for Firestore paths
  
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
        
        // Handle different message types with backwards compatibility
        // Load image messages if they have valid imageUrl OR base64 data
        // This maintains backwards compatibility: legacy image messages with base64 continue to work
        if (data.type === 'image') {
          const hasImageUrl = data.imageUrl && typeof data.imageUrl === 'string' && data.imageUrl.trim() !== '';
          const hasBase64 = data.base64 && typeof data.base64 === 'string' && data.base64.trim() !== '';
          
          if (!hasImageUrl && !hasBase64) {
            // Skip image messages without either imageUrl or base64 (corrupted/legacy)
            console.log('[Store] Skipping image message without imageUrl or base64 data');
            return;
          }
          // Continue to load image message with imageUrl or base64
        }
        
        // Unified schema with backwards compatibility
        // Determine type (backwards compatible: default to 'text' if missing)
        const messageType = data.type || 'text';
        
        // Extract content (backwards compatible: text → content)
        let content = data.content || data.text || '';
        
        // Extract timestamp (backwards compatible: createdAt → timestamp)
        const timestamp = data.timestamp || 
          (data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now());
        
        // Extract role (backwards compatible: use sender if role missing)
        const role = data.role || (data.sender === 'user' ? 'user' : 'assistant');
        
        // Build metadata from legacy fields or new metadata object
        const metadata = {};
        
        // Migrate legacy fields to metadata
        if (messageType === 'vision' && data.analysis) {
          metadata.analysis = data.analysis;
          content = data.analysis; // Keep for backwards compatibility
        }
        if (messageType === 'audio') {
          if (data.transcript) {
            metadata.transcript = data.transcript;
            content = data.transcript; // Keep for backwards compatibility
          }
          if (data.audioUrl) {
            metadata.audioUrl = data.audioUrl;
          }
        }
        
        // Merge with new metadata if present
        if (data.metadata && typeof data.metadata === 'object') {
          Object.assign(metadata, data.metadata);
        }
        
        // Build unified message structure
        // For images: prefer imageUrl over base64 (new standard), fallback to base64 for legacy
        const message = {
          id: doc.id,
          role: role,
          type: messageType,
          content: content,
          base64: data.imageUrl || data.base64 || null, // imageUrl can be used as src in UI
          imageUrl: data.imageUrl || null, // Keep explicit imageUrl field for clarity
          attachments: data.attachments || null,
          model: data.model || DEFAULT_MODEL,
          messageType: data.messageType || messageType, // Always replicate type
          metadata: Object.keys(metadata).length > 0 ? metadata : {},
          timestamp: timestamp
        };
        
        loadedMessages.push(message);
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
              
              // Handle different message types with backwards compatibility
              // Load image messages if they have valid imageUrl OR base64 data (same logic as loadMessages)
              if (data.type === 'image') {
                const hasImageUrl = data.imageUrl && typeof data.imageUrl === 'string' && data.imageUrl.trim() !== '';
                const hasBase64 = data.base64 && typeof data.base64 === 'string' && data.base64.trim() !== '';
                
                if (!hasImageUrl && !hasBase64) {
                  // Skip image messages without either imageUrl or base64 (corrupted/legacy)
                  console.log('[Store] Skipping image message without imageUrl or base64 data in realtime');
                  return;
                }
                // Continue to load image message with imageUrl or base64
              }
              
              // Unified schema with backwards compatibility
              // Determine type (backwards compatible: default to 'text' if missing)
              const messageType = data.type || 'text';
              
              // Extract content (backwards compatible: text → content)
              let content = data.content || data.text || '';
              
              // Extract timestamp (backwards compatible: createdAt → timestamp)
              const timestamp = data.timestamp || 
                (data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || Date.now());
              
              // Extract role (backwards compatible: use sender if role missing)
              const role = data.role || (data.sender === 'user' ? 'user' : 'assistant');
              
              // Build metadata from legacy fields or new metadata object
              const metadata = {};
              
              // Migrate legacy fields to metadata
              if (messageType === 'vision' && data.analysis) {
                metadata.analysis = data.analysis;
                content = data.analysis; // Keep for backwards compatibility
              }
              if (messageType === 'audio') {
                if (data.transcript) {
                  metadata.transcript = data.transcript;
                  content = data.transcript; // Keep for backwards compatibility
                }
                if (data.audioUrl) {
                  metadata.audioUrl = data.audioUrl;
                }
              }
              
              // Merge with new metadata if present
              if (data.metadata && typeof data.metadata === 'object') {
                Object.assign(metadata, data.metadata);
              }
              
              // Build unified message structure
              // For images: prefer imageUrl over base64 (new standard), fallback to base64 for legacy
              const newMessage = {
                id: change.doc.id,
                role: role,
                type: messageType,
                content: content,
                base64: data.imageUrl || data.base64 || null, // imageUrl can be used as src in UI
                imageUrl: data.imageUrl || null, // Keep explicit imageUrl field for clarity
                attachments: data.attachments || null,
                model: data.model || DEFAULT_MODEL,
                messageType: data.messageType || messageType, // Always replicate type
                metadata: Object.keys(metadata).length > 0 ? metadata : {},
                timestamp: timestamp
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
  saveMessageWithoutImageToFirestore: async (role, text, model = DEFAULT_MODEL, metadata = null, type = 'text', base64 = null, attachments = null, imageUrl = null) => {
    const { activeChatId, sessionId } = get();
    const chatId = activeChatId || sessionId;
    
    if (!chatId) {
      console.warn('[Store] No active chat, cannot save message');
      return null;
    }
    
    try {
      const messagesRef = getMessagesRef(chatId);
      
      // Build message data with unified schema (backwards compatible)
      const messageData = {
        role: role,
        // Keep sender for backwards compatibility but it's redundant
        sender: role === 'user' ? 'user' : 'assistant',
        // New unified fields
        type: type || 'text',
        content: text || null, // Unified field name (was 'text')
        messageType: type || 'text', // Always replicate type
        model: model || null,
        timestamp: Date.now(), // UI-friendly timestamp
        createdAt: serverTimestamp(), // Keep for backwards compatibility
        // Optional fields
        // For images: prefer imageUrl over base64 (new standard)
        // If imageUrl is present, don't save base64 to avoid 1MB limit
        // If only base64 is present (legacy), save it for backwards compatibility
        ...(imageUrl && { imageUrl }),
        ...(base64 && !imageUrl && { base64 }), // Only save base64 if imageUrl is not present
        ...(attachments && attachments.length > 0 && { attachments }),
        ...(metadata && Object.keys(metadata).length > 0 && { metadata })
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
   * Save image to Firebase Storage
   * Converts base64 data URL to Blob and uploads to Storage
   * Returns downloadURL or null on error
   */
  saveImageToStorage: async (imageBase64, userId, chatId, messageId = null) => {
    if (!storage) {
      console.warn('[Store] saveImageToStorage: storage not initialized, aborting upload');
      return null;
    }

    try {
      // Extract mime type and base64 data from data URL
      // Format: "data:image/png;base64,iVBORw0KGgo..."
      const matches = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        console.warn('[Store] Invalid base64 data URL format');
        return null;
      }

      const mimeType = matches[1]; // e.g., "image/png"
      const base64Data = matches[2]; // actual base64 string

      // Convert base64 to Uint8Array
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Determine file extension from mime type
      const extension = mimeType.split('/')[1] || 'png';
      
      // Generate storage path: users/{userId}/chats/{chatId}/{timestamp}.{ext}
      const timestamp = messageId ? messageId.replace('temp-', '') : Date.now();
      const storagePath = `users/${userId}/chats/${chatId}/${timestamp}.${extension}`;
      
      console.log('[Store] Uploading image to Storage:', storagePath, 'mimeType:', mimeType, 'size:', bytes.length, 'bytes');
      
      // Create storage reference
      const storageRef = ref(storage, storagePath);
      
      // Upload bytes
      await uploadBytes(storageRef, bytes, {
        contentType: mimeType
      });
      
      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      
      console.log('[Store] Image uploaded successfully to Storage:', downloadURL);
      return downloadURL;
    } catch (error) {
      console.warn('[Store] saveImageToStorage ERROR:', {
        path: `users/${userId}/chats/${chatId}/${messageId ? messageId.replace('temp-', '') : 'unknown'}`,
        mimeType: imageBase64.match(/^data:([^;]+);base64/)?.[1] || 'unknown',
        message: error.message,
        code: error.code
      });
      return null;
    }
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
      
      // Add user message with base64 immediately to UI (local cache only, unified schema)
      const userMessage = {
        id: tempMessageId,
        role: 'user',
        type: 'image',
        content: null,
        base64: base64DataUrl,
        attachments: null,
        model: null,
        messageType: 'image',
        metadata: {},
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
  generateNanobananaImage: async (prompt, model = null, attachments = []) => {
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
      console.log('[Store] Attachments:', attachments.length);

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
          ...(attachments.length > 0 && { attachments }),
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
        
        // Add text message first (unified schema)
        const textMessage = {
          id: tempMessageId,
          role: 'assistant',
          type: 'text',
          content: hasText,
          base64: null,
          attachments: null,
          model: modelToUse || null,
          messageType: 'text',
          metadata: {},
          timestamp: Date.now()
        };
        
        // Add image message (unified schema)
        const imageMessage = {
          id: `${tempMessageId}-img`,
          role: 'assistant',
          type: 'image',
          content: null,
          base64: imageDataUrl,
          attachments: null,
          model: modelToUse || null,
          messageType: 'image',
          metadata: {},
          timestamp: Date.now() + 1
        };
        
        set(state => ({
          messages: [...state.messages, textMessage, imageMessage]
        }));
        
        // Save text to Firestore
        try {
          await get().saveMessageWithoutImageToFirestore('assistant', hasText, modelToUse, null, 'text', null, null);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant text:', firestoreError);
        }
        
        // Upload image to Firebase Storage and save URL to Firestore
        try {
          const userId = getUserId();
          const { activeChatId, sessionId } = get();
          const chatId = activeChatId || sessionId;
          
          // Debug logging before upload attempt
          console.log('[DEBUG] activeChatId:', activeChatId);
          console.log('[DEBUG] sessionId:', sessionId);
          console.log('[DEBUG] chatId used:', chatId);
          console.log('[Store] Nanobanana upload:', { 
            case: 'TEXT+IMAGE', 
            userId, 
            chatId, 
            hasText: !!hasText,
            imageDataUrlLength: imageDataUrl.length 
          });
          
          if (!userId || !chatId) {
            console.warn('[Store] Nanobanana image NOT uploaded: missing userId or chatId', { userId: !!userId, chatId: !!chatId });
            // Continue to show image in UI (base64), but don't save to Firestore
          } else {
            const downloadURL = await get().saveImageToStorage(imageDataUrl, userId, chatId, `${tempMessageId}-img`);
            
            if (downloadURL) {
              // Save image message with imageUrl (NOT base64) to Firestore
              await get().saveMessageWithoutImageToFirestore('assistant', null, modelToUse, { provider: 'nanobanana' }, 'image', null, null, downloadURL);
              console.log('[Store] Image saved to Firestore with Storage URL');
            } else {
              console.warn('[Store] Nanobanana image upload FAILED, no downloadURL. Skipping Firestore save.');
            }
          }
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant image:', firestoreError);
        }
        
        console.log('[Store] TEXT+IMAGE messages added to UI');
        return imageDataUrl;
      } else if (hasText) {
        // TEXT only mode (unified schema)
        const textMessage = {
          id: tempMessageId,
          role: 'assistant',
          type: 'text',
          content: hasText,
          base64: null,
          attachments: null,
          model: modelToUse || null,
          messageType: 'text',
          metadata: {},
          timestamp: Date.now()
        };
        
        set(state => ({
          messages: [...state.messages, textMessage]
        }));
        
        // Save text to Firestore
        try {
          await get().saveMessageWithoutImageToFirestore('assistant', hasText, modelToUse, null, 'text', null, null);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant text:', firestoreError);
        }
        
        console.log('[Store] TEXT message added to UI');
        return hasText;
      } else if (imageBase64) {
        // IMAGE only mode (unified schema)
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        
        // Keep base64 in UI for immediate display
        const assistantMessage = {
          id: tempMessageId,
          role: 'assistant',
          type: 'image',
          content: null,
          base64: imageDataUrl,
          attachments: null,
          model: modelToUse || null,
          messageType: 'image',
          metadata: {},
          timestamp: Date.now()
        };

        set(state => ({
          messages: [...state.messages, assistantMessage]
        }));

        // Upload image to Firebase Storage and save URL to Firestore
        try {
          const userId = getUserId();
          const { activeChatId, sessionId } = get();
          const chatId = activeChatId || sessionId;
          
          // Debug logging before upload attempt
          console.log('[DEBUG] activeChatId:', activeChatId);
          console.log('[DEBUG] sessionId:', sessionId);
          console.log('[DEBUG] chatId used:', chatId);
          console.log('[Store] Nanobanana upload:', { 
            case: 'IMAGE only', 
            userId, 
            chatId, 
            imageDataUrlLength: imageDataUrl.length 
          });
          
          if (!userId || !chatId) {
            console.warn('[Store] Nanobanana image NOT uploaded: missing userId or chatId', { userId: !!userId, chatId: !!chatId });
            // Continue to show image in UI (base64), but don't save to Firestore
          } else {
            const downloadURL = await get().saveImageToStorage(imageDataUrl, userId, chatId, tempMessageId);
            
            if (downloadURL) {
              // Save image message with imageUrl (NOT base64) to Firestore
              await get().saveMessageWithoutImageToFirestore('assistant', null, modelToUse, { provider: 'nanobanana' }, 'image', null, null, downloadURL);
              console.log('[Store] Image saved to Firestore with Storage URL');
            } else {
              console.warn('[Store] Nanobanana image upload FAILED, no downloadURL. Skipping Firestore save.');
            }
          }
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for assistant image:', firestoreError);
        }

        console.log('[Store] Image message added to UI, rendering from base64');

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
  sendMessage: async (messageOrObject) => {
    const { activeChatId, sessionId, selectedModel } = get();
    const chatId = activeChatId || sessionId;
    
    // If no active chat, create one
    if (!chatId) {
      console.log('[Store] No active chat, creating new chat...');
      const newChatId = await get().createNewChat();
      set({ activeChatId: newChatId, sessionId: newChatId });
    }
    
    // Handle both string (legacy) and object format
    let messageText = '';
    let attachments = [];
    
    if (typeof messageOrObject === 'string') {
      // Legacy format: just text
      messageText = messageOrObject;
      attachments = [];
    } else if (typeof messageOrObject === 'object' && messageOrObject !== null) {
      // New format: { text, attachments }
      messageText = messageOrObject.text || '';
      attachments = messageOrObject.attachments || [];
    } else {
      throw new Error('Invalid message format');
    }
    
    console.log("[DEBUG/STORE] Incoming attachments:", attachments);
    
    try {
      // 1) Load pipeline config for this chat
      const originalUserMessage = messageText; // Store original for UI display
      let finalUserMessage = messageText; // Will be sent to main model
      let pipelineUsed = false;
      let pipelineModel = null; // Store pipeline model for badge
      
      try {
        const pipeline = await loadChatPipelineConfig(chatId);
        
        console.log('[PIPELINE] Enabled for chat ID:', chatId);
        console.log('[PIPELINE] Config:', {
          enabled: pipeline.enabled,
          hasModel: !!pipeline.model,
          hasSystemInstruction: !!pipeline.systemInstruction
        });
        
        if (pipeline.enabled && pipeline.model && pipeline.systemInstruction && pipeline.systemInstruction.trim() !== '') {
          console.log('[PIPELINE] ✅ Pipeline is ACTIVE');
          console.log('[PIPELINE] Pre-model:', pipeline.model);
          console.log('[PIPELINE] System instruction length:', pipeline.systemInstruction.length);
          console.log('[PIPELINE] Original user input:', originalUserMessage);
          
          pipelineModel = pipeline.model; // Store for badge
          
          // Call pre-model API
          const apiUrl = import.meta.env.VITE_API_URL || '/api/chat';
          const preModelConfig = resolveModelConfig(pipeline.model);
          
          // Build message for pre-model: system instruction + user message (NO XML TAGS)
          // The backend will handle system instructions correctly
          const preModelMessage = `${pipeline.systemInstruction}\n\nUser message: ${originalUserMessage}`;
          
          const preModelSettings = {
            system: pipeline.systemInstruction, // Pass system instruction via modelSettings
            temperature: pipeline.temperature,
            top_p: pipeline.topP,
            max_output_tokens: pipeline.maxTokens
          };
          
          console.log('[PIPELINE] Calling pre-model API:', pipeline.model);
          console.log('[PIPELINE] Pre-model message (first 200 chars):', preModelMessage.substring(0, 200));
          
          const preResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: preModelMessage,
              model: preModelConfig.googleModel,
              modelSettings: preModelSettings
            }),
          });
          
          if (!preResponse.ok) {
            const errorText = await preResponse.text();
            throw new Error(`Pre-model API error: ${preResponse.status} - ${errorText}`);
          }
          
          const preData = await preResponse.json();
          
          // Extract preprocessed text (must be a clean string)
          const preprocessedText = preData.reply || preData.text || originalUserMessage;
          
          // Ensure it's a string and clean it
          if (typeof preprocessedText !== 'string') {
            console.warn('[PIPELINE] Pre-model returned non-string, using original message');
            finalUserMessage = originalUserMessage;
          } else {
            // Clean the preprocessed text (remove any XML tags or invalid characters)
            const cleanedText = preprocessedText
              .replace(/<system_instruction>.*?<\/system_instruction>/gi, '')
              .replace(/<system>.*?<\/system>/gi, '')
              .trim();
            
            finalUserMessage = cleanedText || originalUserMessage;
            pipelineUsed = true;
            
            console.log('[PIPELINE] ✅ Pre-model output:');
            console.log(finalUserMessage);
            console.log('[PIPELINE] Final message sent to main model:');
            console.log(JSON.stringify({ role: 'user', parts: [{ text: finalUserMessage }] }, null, 2));
          }
        } else {
          console.log('[PIPELINE] ⚠️ Disabled or incomplete config');
        }
      } catch (pipelineError) {
        console.error('[PIPELINE] ❌ Error in pipeline pre-processing:', pipelineError);
        console.warn('[PIPELINE] ⚠️ Continuing with original message (fallback)');
        // Continue with original message if pipeline fails
        finalUserMessage = originalUserMessage;
        pipelineUsed = false;
      }
      
      // 2) Resolve model configuration (endpoint, type, googleModel)
      const config = resolveModelConfig(selectedModel);
      console.log('[Store] Model config resolved:', config);

      // 3) Add user message immediately to UI (show original message, NOT preprocessed)
      // The preprocessed message is NEVER shown to the user
      // Unified message schema
      const messageType = config.type || 'text';
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        type: messageType,
        content: originalUserMessage, // Always show original message to user
        base64: null,
        attachments: attachments.length > 0 ? attachments : null,
        model: selectedModel || null,
        messageType: messageType, // Always replicate type
        metadata: {},
        timestamp: Date.now()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

      // 4) Save user message to Firestore (TEXT ONLY - images are not persisted)
      // Save ORIGINAL message, NOT preprocessed
      if (config.type !== 'image') {
        try {
          const metadata = attachments.length > 0 ? { attachments } : null;
          await get().saveMessageWithoutImageToFirestore('user', originalUserMessage, selectedModel, metadata, messageType, null, attachments);
        } catch (firestoreError) {
          console.warn('[Store] Firestore save failed for user message, continuing with API call:', firestoreError);
        }
      }

      // Route to appropriate handler based on model provider
      if (config.provider === 'nanobanana') {
        // Nanobanana via Vertex AI generateContent
        const prompt = finalUserMessage; // Use preprocessed message if pipeline was used
        await get().generateNanobananaImage(prompt, selectedModel, attachments);
        return null;
      } else if (config.provider === 'imagen') {
        // Imagen 4 via Vertex AI generateImage
        const prompt = finalUserMessage; // Use preprocessed message if pipeline was used
        await get().generateImagenImage(prompt, selectedModel);
        return null;
      } else if (config.provider === 'google-text') {
        // Text generation (default)
        const apiUrl = import.meta.env.VITE_API_URL || config.endpoint;
        
        console.log('[Store] Calling API:', apiUrl);
        console.log('[Store] Request body:', { 
          message: finalUserMessage, 
          model: config.googleModel,
          isPreprocessed: pipelineUsed 
        });

        // Build modelSettings from current config
        const modelSettings = get().buildModelSettings(selectedModel);
        const { debugMode } = get();
        
        // Create abort controller for stopping generation
        const controller = new AbortController();
        get().setAbortController(controller);
        get().setIsGenerating(true);
        
        // Build conversation history from current messages in store (SAFE MODE - Option C: text only)
        const { messages } = get();
        const conversationHistory = messages
          .filter(msg => {
            // Include only text messages with content
            if (msg.type === 'text' && msg.content && msg.content.trim() !== '') {
              return true;
            }
            // Include vision/audio messages (they have text content)
            if ((msg.type === 'vision' || msg.type === 'audio') && msg.content && msg.content.trim() !== '') {
              return true;
            }
            // SKIP image messages in context (SAFE MODE - Option C)
            return false;
          })
          .map(msg => ({
            role: msg.role,
            content: msg.content,
            type: msg.type
          }));
        
        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              message: finalUserMessage, // Use preprocessed message if pipeline was used
              conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined, // Optional field
              model: config.googleModel,
              ...(modelSettings && { modelSettings }),
              ...(attachments.length > 0 && { attachments }),
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

        // Add assistant message to UI (unified schema)
        const assistantMessage = {
          id: `temp-${Date.now() + 1}`,
          role: 'assistant',
          type: 'text',
          content: data.reply || 'No response generated',
          base64: null,
          attachments: null,
          model: selectedModel || null,
          messageType: 'text', // Always replicate type
          metadata: {
            ...(pipelineUsed && pipelineModel ? { preprocessedBy: pipelineModel } : {})
          },
          timestamp: Date.now()
        };

          set(state => ({
            messages: [...state.messages, assistantMessage]
          }));

          // Save assistant message to Firestore (TEXT ONLY)
          try {
            const metadata = pipelineUsed && pipelineModel ? { preprocessedBy: pipelineModel } : null;
            await get().saveMessageWithoutImageToFirestore('assistant', data.reply || 'No response generated', selectedModel, metadata, 'text', null, null);
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
      // Check if user message has attachments (backwards compatible: check both locations)
      const attachments = userMessage.attachments || userMessage.metadata?.attachments;
      const messageToSend = attachments 
        ? { text: userMessage.content, attachments: attachments }
        : userMessage.content;
      await get().sendMessage(messageToSend);
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
      await get().saveMessageWithoutImageToFirestore('user', newText, selectedModel, null, 'text', null, null);
    } catch (error) {
      console.warn('[Store] Failed to save edited message to Firestore:', error);
    }

    // Regenerate response with new text
    // Preserve attachments if they exist (backwards compatible: check both locations)
    const attachments = message.attachments || message.metadata?.attachments;
    const messageToSend = attachments 
      ? { text: newText, attachments: attachments }
      : newText;
    try {
      await get().sendMessage(messageToSend);
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
   * Path: users/{uid}/modelSettings/{modelId}
   */
  loadModelConfig: async (modelId) => {
    try {
      // Check cache first
      const { modelConfigs, userId } = get();
      if (modelConfigs[modelId]) {
        return modelConfigs[modelId];
      }

      console.log('[Store] Loading model config for:', modelId);
      const configRef = doc(db, 'users', userId, 'modelSettings', modelId);
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
          outputType: data.outputType ?? 'TEXT',
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
          outputType: (modelId.includes('image') || modelId.includes('imagen')) ? 'IMAGE' : 'TEXT',
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
   * Path: users/{uid}/modelSettings/{modelId}
   */
  saveModelConfig: async (config) => {
    try {
      const { userId } = get();
      console.log('[Store] Saving model config for:', config.modelId);
      const configRef = doc(db, 'users', userId, 'modelSettings', config.modelId);
      
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
   * Only includes fields supported by the model (based on capabilities)
   */
  buildModelSettings: (modelId) => {
    const { modelConfigs } = get();
    const config = modelConfigs[modelId];
    
    if (!config) {
      return null;
    }
    
    const modelSettings = {};
    const ignoredFields = [];
    
    // System Instruction
    if (modelSupportsOption(modelId, 'systemInstruction') && config.systemPrompt) {
      modelSettings.system = config.systemPrompt;
    } else if (config.systemPrompt) {
      ignoredFields.push('systemInstruction');
    }
    
    // Temperature
    if (modelSupportsOption(modelId, 'temperature') && config.temperature !== undefined) {
      modelSettings.temperature = config.temperature;
    } else if (config.temperature !== undefined) {
      ignoredFields.push('temperature');
    }
    
    // Top P
    if (modelSupportsOption(modelId, 'topP') && config.topP !== undefined) {
      modelSettings.top_p = config.topP;
    } else if (config.topP !== undefined) {
      ignoredFields.push('topP');
    }
    
    // Max Tokens - Special handling for nanobanana
    if (modelSupportsOption(modelId, 'maxTokens')) {
      // For nanobanana, only include maxTokens if outputType is "image_and_text"
      if (modelId === 'gemini-2.5-flash-image') {
        const outputType = config.outputType || 'image';
        if (outputType === 'image_and_text' && config.maxOutputTokens !== undefined) {
          modelSettings.max_output_tokens = config.maxOutputTokens;
        }
      } else {
        // For text models, always include if defined
        if (config.maxOutputTokens !== undefined) {
          modelSettings.max_output_tokens = config.maxOutputTokens;
        }
      }
    } else if (config.maxOutputTokens !== undefined) {
      ignoredFields.push('maxTokens');
    }
    
    // Output Type (for nanobanana)
    if (modelSupportsOption(modelId, 'outputType') && config.outputType) {
      // Map to API format
      const outputTypeMap = {
        'image': 'image',
        'image_and_text': 'image_and_text'
      };
      const mapped = outputTypeMap[config.outputType] || config.outputType.toLowerCase();
      modelSettings.output_type = mapped;
    } else if (config.outputType) {
      ignoredFields.push('outputType');
    }
    
    // Image Format / Aspect Ratio (for nanobanana)
    if (modelSupportsOption(modelId, 'imageFormat') && config.aspectRatio) {
      modelSettings.aspect_ratio = config.aspectRatio;
    } else if (config.aspectRatio) {
      ignoredFields.push('imageFormat');
    }
    
    // Log ignored fields
    if (ignoredFields.length > 0) {
      console.log(`[MODEL] Ignored unsupported fields for ${modelId}:`, ignoredFields);
    }
    
    console.log(`[MODEL] Applying merged config for ${modelId}:`, modelSettings);
    
    return Object.keys(modelSettings).length > 0 ? modelSettings : null;
  },

  /**
   * Load all model configs
   * Path: users/{uid}/modelSettings
   */
  loadAllModelConfigs: async () => {
    try {
      const { userId } = get();
      console.log('[Store] Loading all model configs for user:', userId);
      const configsRef = collection(db, 'users', userId, 'modelSettings');
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
          outputType: data.outputType ?? 'TEXT',
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
