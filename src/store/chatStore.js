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
  // Normalized message structure (Step 1)
  messagesById: new Map(),      // Map<messageId, Message>
  messagesOrder: [],            // Array<messageId> in chronological order
  sessionId: getSessionId(), // Legacy support
  activeChatId: null, // Current active chat ID
  currentChatId: null, // Alias for activeChatId (exposed for compatibility)
  chats: [], // List of all chats
  firestoreError: null,
  unsubscribe: null,
  activeListenerChatId: null,  // chatId currently listened to
  listenerVersion: 0,          // increments on each listener setup to prevent stale listeners
  loading: false,
  selectedModel: DEFAULT_MODEL,
  userId: getUserId(), // User ID for Firestore paths
  reuseLastAssistantImage: false,
  
  /**
   * Set selected model
   */
  setSelectedModel: (model) => {
    set({ selectedModel: model });
    console.log('[Store] Model changed to:', model);
  },

  /**
   * Toggle reuse last assistant image flag
   */
  toggleReuseLastAssistantImage: () => {
    set({ reuseLastAssistantImage: !get().reuseLastAssistantImage });
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
        sessionId: newActiveChatId || state.sessionId
      }));

      // Load messages for new active chat if changed
      if (newActiveChatId && newActiveChatId !== activeChatId) {
        await get().loadMessages();
      } else if (!newActiveChatId) {
        get().replaceMessages([]);
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
      
      // Clean up listener for previous chat
      const { unsubscribe, activeListenerChatId } = get();
      if (unsubscribe && activeListenerChatId && activeListenerChatId !== chatId) {
        console.log('[Store] Cleaning up listener for previous chat:', activeListenerChatId);
        unsubscribe();
      }
      
      set({ 
        activeChatId: chatId,
        currentChatId: chatId, // Update alias
        sessionId: chatId, // Update sessionId for backward compatibility
        unsubscribe: null,
        activeListenerChatId: null
      });
      
      // Clear messages using normalized helper
      get().replaceMessages([]);

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
          // Allow user messages even if they have no imageUrl or base64
          if (data.role === 'user') {
            // Do nothing – keep the message
          } else {
            // Assistant image messages must have imageUrl or base64
            const hasImageUrl = data.imageUrl && typeof data.imageUrl === 'string' && data.imageUrl.trim() !== '';
            const hasBase64 = data.base64 && typeof data.base64 === 'string' && data.base64.trim() !== '';
            
            if (!hasImageUrl && !hasBase64) {
              console.log('[Store] Skipping assistant image message without imageUrl or base64');
              return;
            }
          }
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
        // Promote first attachment's imageUrl to root if root imageUrl is missing
        let rootImageUrl = data.imageUrl || null;
        if (!rootImageUrl && data.attachments && Array.isArray(data.attachments) && data.attachments.length > 0) {
          const firstAttachment = data.attachments[0];
          if (firstAttachment && firstAttachment.imageUrl) {
            rootImageUrl = firstAttachment.imageUrl;
          }
        }
        
        const message = {
          id: doc.id,
          role: role,
          type: messageType,
          content: content,
          base64: rootImageUrl || data.base64 || null, // imageUrl can be used as src in UI
          imageUrl: rootImageUrl || null, // Keep explicit imageUrl field for clarity (promoted from attachments if needed)
          attachments: data.attachments || null,
          model: data.model || DEFAULT_MODEL,
          messageType: data.messageType || messageType, // Always replicate type
          metadata: Object.keys(metadata).length > 0 ? metadata : {},
          timestamp: timestamp
        };
        
        loadedMessages.push(message);
      });

      console.log('[Store] Loaded', loadedMessages.length, 'messages from Firestore');
      get().replaceMessages(loadedMessages);
      set({ loading: false });
      
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
   * Refactored to use normalized message structure (Step 2)
   */
  setupRealtimeListener: () => {
    const { activeChatId, sessionId, unsubscribe, activeListenerChatId, listenerVersion } = get();
    const chatId = activeChatId || sessionId;
    
    if (!chatId) {
      console.log('[Store] No active chat, skipping realtime listener');
      return;
    }
    
    // Prevent multiple listeners for the same chat
    if (activeListenerChatId === chatId && unsubscribe) {
      console.log('[Store] Listener already active for chat:', chatId);
      return;
    }
    
    // Clean up existing listener
    if (unsubscribe) {
      console.log('[Store] Cleaning up existing listener for chat:', activeListenerChatId);
      unsubscribe();
    }

    try {
      // Increment version token to prevent race conditions
      const currentVersion = listenerVersion + 1;
      set({ 
        listenerVersion: currentVersion,
        unsubscribe: null,
        activeListenerChatId: null
      });

      console.log('[Store] Setting up realtime listener for chat:', chatId, 'version:', currentVersion);
      const messagesRef = getMessagesRef(chatId);
      const q = query(messagesRef, orderBy('createdAt', 'asc'));
      
      // Capture version in closure for listener callback
      const version = currentVersion;
      
      const unsubscribeListener = onSnapshot(
        q,
        (snapshot) => {
          // Verify this listener is still for the active chat and version matches
          const { activeChatId: currentActiveChatId, sessionId: currentSessionId, listenerVersion: currentVersion } = get();
          const currentChatId = currentActiveChatId || currentSessionId;
          
          if (currentChatId !== chatId) {
            console.log('[Store] Listener fired for inactive chat, ignoring:', chatId);
            return;
          }
          
          if (currentVersion !== version) {
            console.log('[Store] Listener version mismatch, ignoring stale listener. Current:', currentVersion, 'Listener:', version);
            return;
          }
          
          // Get current messages from normalized structure (falls back to legacy array)
          const currentMessages = get().getMessages();
          
          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const docId = change.doc.id;
            
            // Handle different message types with backwards compatibility
            // Load image messages if they have valid imageUrl OR base64 data (same logic as loadMessages)
            if (data.type === 'image') {
              // Allow user messages even if they have no imageUrl or base64
              if (data.role === 'user') {
                // Do nothing – keep the message
              } else {
                // Assistant image messages must have imageUrl or base64
                const hasImageUrl = data.imageUrl && typeof data.imageUrl === 'string' && data.imageUrl.trim() !== '';
                const hasBase64 = data.base64 && typeof data.base64 === 'string' && data.base64.trim() !== '';
                
                if (!hasImageUrl && !hasBase64) {
                  console.log('[Store] Skipping assistant image message without imageUrl or base64');
                  return;
                }
              }
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
            // Promote first attachment's imageUrl to root if root imageUrl is missing
            let rootImageUrl = data.imageUrl || null;
            if (!rootImageUrl && data.attachments && Array.isArray(data.attachments) && data.attachments.length > 0) {
              const firstAttachment = data.attachments[0];
              if (firstAttachment && firstAttachment.imageUrl) {
                rootImageUrl = firstAttachment.imageUrl;
              }
            }
            
            const parsedMessage = {
              id: docId,
              role: role,
              type: messageType,
              content: content,
              base64: rootImageUrl || data.base64 || null, // imageUrl can be used as src in UI
              imageUrl: rootImageUrl || null, // Keep explicit imageUrl field for clarity (promoted from attachments if needed)
              attachments: data.attachments || null,
              model: data.model || DEFAULT_MODEL,
              messageType: data.messageType || messageType, // Always replicate type
              metadata: Object.keys(metadata).length > 0 ? metadata : {},
              timestamp: timestamp
            };
            
            // Handle change types using normalized helpers
            if (change.type === 'added' || change.type === 'modified') {
              // Use normalized helper to add/update message
              get().addOrUpdateMessage(docId, parsedMessage);
              
              // Find matching temp message to remove
              // Match by: role, type, content (string equality, null == null), timestamp within ±1500ms
              const matchingTempMessage = currentMessages.find(msg => {
                if (!msg.tempMessage) return false;
                if (msg.role !== parsedMessage.role) return false;
                if (msg.type !== parsedMessage.type) return false;
                
                // Content match: both null or both same string
                const msgContent = msg.content || '';
                const newContent = parsedMessage.content || '';
                if (msgContent !== newContent) return false;
                
                // Timestamp within ±1500ms
                const timeDiff = Math.abs((msg.timestamp || 0) - (parsedMessage.timestamp || 0));
                if (timeDiff > 1500) return false;
                
                return true;
              });
              
              if (matchingTempMessage) {
                console.log('[Store] Found matching temp message, removing:', matchingTempMessage.id);
                get().removeMessage(matchingTempMessage.id);
              }
            } else if (change.type === 'removed') {
              // Use normalized helper to remove message
              get().removeMessage(docId);
            }
          });
        },
        (error) => {
          console.error('[Store] Realtime listener error:', error);
          set({ firestoreError: error.message });
        }
      );

      set({ 
        unsubscribe: unsubscribeListener,
        activeListenerChatId: chatId
      });
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
   * Process user attachments before saving: upload to Storage and convert to imageUrl format
   * Returns cleaned attachments array with imageUrl only (no base64)
   */
  processUserAttachmentsBeforeSaving: async (attachments) => {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    const userId = getUserId();
    const { activeChatId, sessionId } = get();
    const chatId = activeChatId || sessionId;

    if (!userId || !chatId) {
      console.warn('[Store] Cannot process attachments: missing userId or chatId');
      return [];
    }

    const cleanedAttachments = [];

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      
      // Skip if already has imageUrl (already processed)
      if (att.imageUrl && !att.base64) {
        cleanedAttachments.push({
          type: att.type,
          mimeType: att.mimeType,
          imageUrl: att.imageUrl,
          width: att.width,
          height: att.height
        });
        continue;
      }

      // If has base64, upload to Storage
      if (att.base64) {
        try {
          // Convert pure base64 to data URL format for saveImageToStorage
          const dataUrl = att.base64.startsWith('data:') 
            ? att.base64 
            : `data:${att.mimeType || 'image/jpeg'};base64,${att.base64}`;
          
          const messageId = `user-attachment-${Date.now()}-${i}`;
          const downloadURL = await get().saveImageToStorage(dataUrl, userId, chatId, messageId);
          
          if (downloadURL) {
            cleanedAttachments.push({
              type: att.type || 'image',
              mimeType: att.mimeType || 'image/jpeg',
              imageUrl: downloadURL,
              width: att.width || null,
              height: att.height || null
            });
            console.log('[Store] User attachment uploaded to Storage:', downloadURL);
          } else {
            console.warn('[Store] Failed to upload user attachment to Storage, skipping');
          }
        } catch (error) {
          console.warn('[Store] Error processing user attachment:', error);
          // Skip this attachment on error
        }
      }
    }

    return cleanedAttachments;
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
      };

      // Handle attachments: only save imageUrl format (no base64, no nested metadata)
      if (attachments && attachments.length > 0) {
        messageData.attachments = attachments.map(att => ({
          type: att.type || 'image',
          mimeType: att.mimeType || 'image/jpeg',
          imageUrl: att.imageUrl,
          width: att.width || null,
          height: att.height || null
        }));
      }

      // Handle metadata: exclude attachments to avoid duplication
      if (metadata && Object.keys(metadata).length > 0) {
        // Remove attachments from metadata if present
        const cleanMetadata = { ...metadata };
        delete cleanMetadata.attachments;
        if (Object.keys(cleanMetadata).length > 0) {
          messageData.metadata = cleanMetadata;
        }
      }

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
      
      // Generate storage path: chats/{chatId}/{timestamp}.{ext}
      const timestamp = messageId ? messageId.replace('temp-', '') : Date.now();
      const storagePath = `chats/${chatId}/${timestamp}.${extension}`;
      
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

      // Add message using normalized helper
      get().addOrUpdateMessage(tempMessageId, userMessage);

      console.log('[Store] Image message added to UI, rendering from base64');
      console.log('[Store] Image saved in local cache (NOT persisted).');

      return true;
    } catch (error) {
      console.error('[Store] Error sending image message:', error);
      // Remove message from UI on error using normalized helper
      get().removeMessage(tempMessageId);
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

      // Add message using normalized helper
      get().addOrUpdateMessage(tempMessageId, assistantMessage);

      console.log('[Store] Image message added to UI, rendering from base64');
      console.log('[Store] Image saved in local cache (NOT persisted).');

      return imageDataUrl;
    } catch (error) {
      console.error('[Store] Error generating image:', error);
      // Remove message from UI on error using normalized helper
      get().removeMessage(tempMessageId);
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
    console.log('[ImageFlow] User attachments (input):', attachments);
    const finalAttachments = [...attachments];
    console.log('[FixB] User attachments (main):', attachments);
    
    // Auto-reuse last assistant image if flag is enabled and no user attachments provided
    // Force reuse to always be ON (ignore toggle/store)
    const reuseLastAssistantImage = true;
    if (reuseLastAssistantImage) {
      const messages = get().getMessages();
      console.log('[ImageFlow] Scanning messages for last assistant image...');
      
      // Find last assistant image message (scan from end backward)
      let preferredBase64Candidate = null;
      let fallbackUrlCandidate = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.type === 'image' && (msg.imageUrl || msg.base64)) {
          const hasDataUrlBase64 =
            typeof msg.base64 === 'string' &&
            msg.base64.trim().startsWith('data:image');
          
          if (hasDataUrlBase64) {
            preferredBase64Candidate = msg;
            break;
          }
          
          if (!fallbackUrlCandidate && msg.imageUrl) {
            fallbackUrlCandidate = msg;
          }
        }
      }
      
      const candidate = preferredBase64Candidate || fallbackUrlCandidate;
      
      if (candidate) {
        console.log('[ImageFlow] Previous assistant image found for reuse');
        try {
          let base64Data = null;
          let mimeType = 'image/png'; // Default mime type
          
          if (preferredBase64Candidate) {
            console.log('[ImageFlow] Using base64 candidate for reuse');
            const dataUrl = preferredBase64Candidate.base64 || '';
            const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            mimeType = matches?.[1] || 'image/png';
            base64Data = matches?.[2];
            if (!base64Data && dataUrl.includes(',')) {
              base64Data = dataUrl.split(',')[1];
            }
            if (!base64Data) {
              base64Data = dataUrl;
            }
          } else if (fallbackUrlCandidate && fallbackUrlCandidate.imageUrl) {
            console.log('[ImageFlow] Falling back to imageUrl candidate for reuse');
            // Fetch imageUrl and convert to base64
            const imageResponse = await fetch(fallbackUrlCandidate.imageUrl);
            const blob = await imageResponse.blob();
            mimeType = blob.type || 'image/png';
            
            base64Data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const dataUrl = reader.result;
                // Remove data:image/...;base64, prefix
                const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                resolve(base64);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
          
          if (base64Data) {
            // Add to attachments in the same format as user uploads
            finalAttachments.push({
              type: 'image',
              mimeType: mimeType,
              base64: base64Data
            });
            console.log('[Store] Auto-attached last assistant image as input');
            console.log('[FixB] Appended previous assistant image (context)');
          }
        } catch (error) {
          console.warn('[Store] Failed to auto-attach last assistant image:', error);
          // Continue without auto-attachment on error
        }
      }
    }
    console.log('[FixB] Final ordered attachments:', finalAttachments);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || config.endpoint;
      
      console.log('[Store] ========================================');
      console.log('[Store] NANOBANANA IMAGE GENERATION REQUEST');
      console.log('[Store] Model:', modelToUse);
      console.log('[Store] Provider:', config.provider);
      console.log('[Store] Endpoint:', apiUrl);
      console.log('[Store] Prompt:', prompt);
      console.log('[Store] Attachments:', finalAttachments.length);
      console.log('[ImageFlow] Final attachments sent:', finalAttachments);
      console.log('[FixB] Sending attachments count:', finalAttachments.length);

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
          ...(finalAttachments.length > 0 && { attachments: finalAttachments }),
          ...(finalAttachments.length > 1 && {
            systemInstruction: 'Use the FIRST image as the main input. Use the SECOND image only as contextual reference.'
          }),
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
          timestamp: Date.now(),
          tempMessage: true // Mark as temp message for deduplication
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
          timestamp: Date.now() + 1,
          tempMessage: true // Mark as temp message for deduplication
        };
        
        // Add messages using normalized helpers
        get().addOrUpdateMessage(tempMessageId, textMessage);
        get().addOrUpdateMessage(`${tempMessageId}-img`, imageMessage);
        
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
            return;
          }

          const downloadURL = await get().saveImageToStorage(imageDataUrl, userId, chatId, `${tempMessageId}-img`);

          // Decide cosa salvare in Firestore:
          // - se abbiamo downloadURL → salviamo solo imageUrl
          // - se NON l'abbiamo → salviamo base64 come fallback
          let imageUrlForDb = null;
          let base64ForDb = null;

          if (downloadURL) {
            imageUrlForDb = downloadURL;
          } else {
            console.warn(
              '[Store] Nanobanana image upload FAILED, no downloadURL. Falling back to base64 in Firestore.'
            );
            base64ForDb = imageDataUrl;
          }

          await get().saveMessageWithoutImageToFirestore(
            'assistant',                 // role
            null,                        // text
            modelToUse,                  // model
            { provider: 'nanobanana' },  // metadata
            'image',                     // type
            base64ForDb,                 // base64 (solo se niente URL)
            null,                        // attachments
            imageUrlForDb                // imageUrl (se presente)
          );
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
          timestamp: Date.now(),
          tempMessage: true // Mark as temp message for deduplication
        };
        
        // Add message using normalized helper
        get().addOrUpdateMessage(tempMessageId, textMessage);
        
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
          timestamp: Date.now(),
          tempMessage: true // Mark as temp message for deduplication
        };

        // Add message using normalized helper
        get().addOrUpdateMessage(tempMessageId, assistantMessage);

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
            return;
          }

          const downloadURL = await get().saveImageToStorage(imageDataUrl, userId, chatId, tempMessageId);

          // Decide cosa salvare in Firestore:
          // - se abbiamo downloadURL → salviamo solo imageUrl
          // - se NON l'abbiamo → salviamo base64 come fallback
          let imageUrlForDb = null;
          let base64ForDb = null;

          if (downloadURL) {
            imageUrlForDb = downloadURL;
          } else {
            console.warn(
              '[Store] Nanobanana image upload FAILED, no downloadURL. Falling back to base64 in Firestore.'
            );
            base64ForDb = imageDataUrl;
          }

          await get().saveMessageWithoutImageToFirestore(
            'assistant',                 // role
            null,                        // text
            modelToUse,                  // model
            { provider: 'nanobanana' },  // metadata
            'image',                     // type
            base64ForDb,                 // base64 (solo se niente URL)
            null,                        // attachments
            imageUrlForDb                // imageUrl (se presente)
          );
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
      // Remove message from UI on error using normalized helper
      get().removeMessage(tempMessageId);
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
      // User messages always have type: 'text' unless they have NO text AND have attachments
      const hasText = originalUserMessage && originalUserMessage.trim().length > 0;
      const hasAttachments = attachments && attachments.length > 0;
      const messageType = (!hasText && hasAttachments) ? 'image' : 'text';
      
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
        timestamp: Date.now(),
        tempMessage: true // Mark as temp message for deduplication
      };

      // Add user message using normalized helper
      get().addOrUpdateMessage(userMessage.id, userMessage);

      // 4) Save user message to Firestore
      // Upload user attachments to Storage first, then save only imageUrl
      try {
        let cleanedAttachments = [];
        let firstImageUrl = null;
        
        if (attachments && attachments.length > 0) {
          cleanedAttachments = await get().processUserAttachmentsBeforeSaving(attachments);
          
          // Promote first attachment's imageUrl to root level for UI consistency
          if (cleanedAttachments.length > 0 && cleanedAttachments[0].imageUrl) {
            firstImageUrl = cleanedAttachments[0].imageUrl;
            // Update userMessage in UI to include imageUrl at root using normalized helper
            get().addOrUpdateMessage(userMessage.id, { imageUrl: firstImageUrl });
          }
        }
        
        // Pass null for metadata to avoid nested attachments
        // Pass firstImageUrl to saveMessageWithoutImageToFirestore for root-level storage
        await get().saveMessageWithoutImageToFirestore('user', originalUserMessage, selectedModel, null, messageType, null, cleanedAttachments, firstImageUrl);
      } catch (firestoreError) {
        console.warn('[Store] Firestore save failed for user message, continuing with API call:', firestoreError);
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
        const messages = get().getMessages();
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
          timestamp: Date.now(),
          tempMessage: true // Mark as temp message for deduplication
        };

          // Add assistant message using normalized helper
          get().addOrUpdateMessage(assistantMessage.id, assistantMessage);

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
            // Remove the last assistant message if it was being generated using normalized helper
            const { messages } = get();
            const lastAssistantMessage = messages.find(msg => msg.role === 'assistant' && msg.tempMessage);
            if (lastAssistantMessage) {
              get().removeMessage(lastAssistantMessage.id);
            }
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
        sessionId: newChatId,
        activeChatId: newChatId,
        currentChatId: newChatId, // Update alias
        unsubscribe: null,
        firestoreError: null
      });
      
      // Clear messages using normalized helper
      get().replaceMessages([]);
    
    console.log('[Store] New chat created:', newChatId);
  },

  /**
   * Message Actions
   */
  abortController: null, // For stopping generation
  isGenerating: false, // Generation state

  /**
   * Update a message in the messages array
   * Uses normalized helper to maintain consistency
   */
  updateMessage: (messageId, updates) => {
    get().addOrUpdateMessage(messageId, updates);
  },

  /**
   * Get previous user message before a given message
   */
  getPreviousUserMessage: (messageId) => {
    const messages = get().getMessages();
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
    const messages = get().getMessages();
    const { selectedModel } = get();
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
    
    // Remove the old assistant message using normalized helper
    get().removeMessage(messageId);

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
    const messages = get().getMessages();
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
    const messagesToRemove = messages.slice(messageIndex + 1);
    
    // Remove all messages after the edited message using normalized helper
    messagesToRemove.forEach(msg => {
      get().removeMessage(msg.id);
    });
    
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
  },

  /**
   * Normalized Message Structure Helpers (Step 1)
   * These functions maintain both normalized structure and legacy messages array
   */

  /**
   * Get ordered messages from normalized structure
   * Falls back to legacy messages array if normalized structure is not initialized
   */
  getMessages: () => {
    const state = get();
    const { messagesById, messagesOrder } = state;

    if (!messagesById || !messagesOrder || messagesById.size === 0) {
      return state.messages || [];
    }

    return messagesOrder
      .map(id => messagesById.get(id))
      .filter(Boolean);
  },

  /**
   * Replace all messages with a new array
   * Updates both normalized structure and legacy messages array
   */
  replaceMessages: (messagesArray) => {
    set((state) => {
      const messagesById = new Map();
      const messagesOrder = [];

      for (const message of messagesArray || []) {
        if (!message || !message.id) continue;
        messagesById.set(message.id, message);
        messagesOrder.push(message.id);
      }

      // Sort by timestamp (used throughout the codebase)
      messagesOrder.sort((a, b) => {
        const msgA = messagesById.get(a);
        const msgB = messagesById.get(b);
        const tsA = msgA?.timestamp ?? 0;
        const tsB = msgB?.timestamp ?? 0;
        return tsA - tsB;
      });

      const orderedMessages = messagesOrder
        .map(id => messagesById.get(id))
        .filter(Boolean);

      return {
        ...state,
        messagesById,
        messagesOrder,
        messages: orderedMessages, // backward compatibility
      };
    });
  },

  /**
   * Add or update a message by ID
   * If ID exists, merges with existing message
   * If ID doesn't exist, adds it and appends to order
   * Maintains both normalized structure and legacy messages array
   */
  addOrUpdateMessage: (id, message) => {
    if (!id || !message) return;

    set((state) => {
      const messagesById = new Map(state.messagesById || []);
      const messagesOrder = [...(state.messagesOrder || [])];

      const existing = messagesById.get(id);
      if (existing) {
        // Update existing message
        messagesById.set(id, { ...existing, ...message });
      } else {
        // Add new message
        messagesById.set(id, message);
        if (!messagesOrder.includes(id)) {
          messagesOrder.push(id);
        }
      }

      // Sort order by timestamp (used throughout the codebase)
      messagesOrder.sort((a, b) => {
        const msgA = messagesById.get(a);
        const msgB = messagesById.get(b);
        const tsA = msgA?.timestamp ?? 0;
        const tsB = msgB?.timestamp ?? 0;
        return tsA - tsB;
      });

      const orderedMessages = messagesOrder
        .map(mid => messagesById.get(mid))
        .filter(Boolean);

      return {
        ...state,
        messagesById,
        messagesOrder,
        messages: orderedMessages, // keep legacy array in sync
      };
    });
  },

  /**
   * Remove a message by ID
   * Removes from both normalized structure and legacy messages array
   */
  removeMessage: (id) => {
    if (!id) return;

    set((state) => {
      const messagesById = new Map(state.messagesById || []);
      const messagesOrder = [...(state.messagesOrder || [])];

      if (!messagesById.has(id)) {
        return state; // nothing to do
      }

      messagesById.delete(id);

      const newOrder = messagesOrder.filter(mid => mid !== id);

      const orderedMessages = newOrder
        .map(mid => messagesById.get(mid))
        .filter(Boolean);

      return {
        ...state,
        messagesById,
        messagesOrder: newOrder,
        messages: orderedMessages, // keep legacy array in sync
      };
    });
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
