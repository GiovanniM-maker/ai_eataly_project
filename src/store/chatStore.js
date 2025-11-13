import { create } from 'zustand';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'firebase/storage';
import { db, storage } from '../config/firebase';
import { MODELS, DEFAULT_MODEL } from '../constants/models';

// Convert File to base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Convert image URL to base64 (for images already uploaded to Firebase)
const imageUrlToBase64 = async (imageUrl) => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting image URL to base64:', error);
    return null;
  }
};

// Call Google Gemini API via serverless function
const callGeminiAPI = async (message, model, imageFiles = [], imageUrls = [], conversationHistory = []) => {
  try {
    console.log('🔄 Calling Gemini API:', { model, messageLength: message?.length, imageFiles: imageFiles.length, imageUrls: imageUrls.length });
    
    // Prepara contents con storia conversazione
    const contents = [];
    
    // Aggiungi storia conversazione (ultimi 10 messaggi per evitare token limit)
    const recentHistory = conversationHistory.slice(-10);
    recentHistory.forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    });

    // Aggiungi nuovo messaggio utente
    const userParts = [{ text: message || '' }];
    
    // Converti File objects a base64
    if (imageFiles && imageFiles.length > 0) {
      for (const file of imageFiles) {
        try {
          const base64Image = await fileToBase64(file);
          if (base64Image) {
            // Estrai MIME type e data
            const mimeMatch = base64Image.match(/data:([^;]+);base64,(.+)/);
            if (mimeMatch) {
              userParts.push({
                inline_data: {
                  mime_type: mimeMatch[1],
                  data: mimeMatch[2]
                }
              });
              console.log('✅ Image file converted to base64:', file.name);
            }
          }
        } catch (error) {
          console.error('Error converting file to base64:', error);
        }
      }
    }
    
    // Converti image URLs a base64 (per immagini già caricate su Firebase)
    if (imageUrls && imageUrls.length > 0) {
      for (const imageUrl of imageUrls) {
        const base64Image = await imageUrlToBase64(imageUrl);
        if (base64Image) {
          const mimeMatch = base64Image.match(/data:([^;]+);base64,(.+)/);
          if (mimeMatch) {
            userParts.push({
              inline_data: {
                mime_type: mimeMatch[1],
                data: mimeMatch[2]
              }
            });
            console.log('✅ Image URL converted to base64:', imageUrl);
          }
        }
      }
    }

    contents.push({
      role: 'user',
      parts: userParts
    });

    // Determina API endpoint
    // In produzione su Vercel usa /api/generate, in sviluppo locale potrebbe servire URL completo
    const isDevelopment = import.meta.env.DEV;
    const apiUrl = import.meta.env.VITE_API_URL || (isDevelopment ? 'http://localhost:3000/api/generate' : '/api/generate');
    
    console.log('📡 Calling API:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        contents: contents,
        temperature: 0.7,
        top_p: 0.9,
        maxOutputTokens: 2048,
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
      console.error('❌ API Error:', response.status, errorData);
      throw new Error(errorData.error || errorData.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ API Response received:', { modelUsed: data.modelUsed, fallbackApplied: data.fallbackApplied });
    return data.reply || 'No response generated';
  } catch (error) {
    console.error('❌ Error calling Gemini API:', error);
    throw error;
  }
};

// Zustand store for chat state management with Firebase integration
export const useChatStore = create((set, get) => ({
  // State
  currentModel: DEFAULT_MODEL,
  chats: [],
  activeChatId: null,
  sidebarCollapsed: false,
  loading: true,
  unsubscribe: null,

  // Initialize Firebase listener
  initializeChats: async () => {
    const { unsubscribe: existingUnsubscribe } = get();
    if (existingUnsubscribe) {
      existingUnsubscribe(); // Clean up existing listener
    }

    const chatsRef = collection(db, 'chats');
    
    // First, load initial data quickly with getDocs
    try {
      let snapshot;
      let useOrderBy = true;
      
      // Try with orderBy first
      try {
        const q = query(chatsRef, orderBy('createdAt', 'desc'), limit(50));
        snapshot = await getDocs(q);
      } catch (orderByError) {
        // If orderBy fails (missing index), try without it
        if (orderByError.code === 'failed-precondition' || orderByError.message?.includes('index')) {
          console.warn('OrderBy query requires index, loading without order:', orderByError);
          useOrderBy = false;
          const q = query(chatsRef, limit(50));
          snapshot = await getDocs(q);
        } else {
          throw orderByError;
        }
      }
      
      const chatsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        messages: doc.data().messages || []
      }));

      // Sort manually if we couldn't use orderBy
      if (!useOrderBy) {
        chatsData.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
          return bTime - aTime;
        });
      }

      console.log('📥 Loaded chats from Firebase:', chatsData.length);
      set({ chats: chatsData, loading: false });

      // Set first chat as active if no active chat is set
      const { activeChatId } = get();
      if (!activeChatId && chatsData.length > 0) {
        set({ activeChatId: chatsData[0].id });
      }
    } catch (error) {
      console.error('Error loading initial chats:', error);
      set({ loading: false, chats: [] });
      return;
    }

    // Then set up real-time listener for updates
    try {
      let q = query(chatsRef, orderBy('createdAt', 'desc'), limit(50));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const chatsData = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            messages: doc.data().messages || []
          }));

          console.log('🔄 Real-time update from Firebase:', chatsData.length, 'chats');
          set({ chats: chatsData });
        },
        (error) => {
          console.error('Error in real-time listener:', error);
          // Try without orderBy if it fails
          if (error.code === 'failed-precondition') {
            const fallbackQ = query(chatsRef, limit(50));
            const fallbackUnsubscribe = onSnapshot(
              fallbackQ,
              (snapshot) => {
                const chatsData = snapshot.docs.map((doc) => ({
                  id: doc.id,
                  ...doc.data(),
                  messages: doc.data().messages || []
                }));
                // Sort manually
                chatsData.sort((a, b) => {
                  const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
                  const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
                  return bTime - aTime;
                });
                set({ chats: chatsData });
              },
              (fallbackError) => {
                console.error('Error in fallback listener:', fallbackError);
              }
            );
            set({ unsubscribe: fallbackUnsubscribe });
          }
        }
      );

      set({ unsubscribe });
    } catch (error) {
      console.error('Error setting up real-time listener:', error);
    }
  },

  // Actions
  createNewChat: async () => {
    try {
      const { currentModel } = get();
      const newChatData = {
        title: 'New Chat',
        messages: [],
        model: currentModel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'chats'), newChatData);
      console.log('✅ New chat created in Firebase:', docRef.id);
      set({ activeChatId: docRef.id });
      return docRef.id;
    } catch (error) {
      console.error('❌ Error creating chat:', error);
      return null;
    }
  },

  sendMessage: async (content, images = []) => {
    let { activeChatId, currentModel, chats } = get();
    
    // Create a new chat if none exists
    if (!activeChatId) {
      const newChatId = await get().createNewChat();
      if (!newChatId) {
        console.error('Failed to create new chat');
        throw new Error('Failed to create new chat');
      }
      activeChatId = newChatId;
      set({ activeChatId: newChatId });
      
      // Add the new chat to local state immediately
      const newChat = {
        id: newChatId,
        title: 'New Chat',
        messages: [],
        model: currentModel,
        createdAt: new Date()
      };
      set({ chats: [newChat, ...chats] });
      
      // Wait a bit for the chat to be created in Firestore
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    try {
      const chatRef = doc(db, 'chats', activeChatId);
      
      // Get current chat data - try from local state first, then Firestore
      let currentChat = chats.find(chat => chat.id === activeChatId);
      
      // If chat not found in local state, fetch it from Firestore
      if (!currentChat) {
        try {
          const chatDoc = await getDoc(chatRef);
          if (chatDoc.exists()) {
            const docData = chatDoc.data();
            currentChat = {
              id: activeChatId,
              messages: docData.messages || [],
              title: docData.title || 'New Chat'
            };
            // Update local state with fetched chat
            set({ chats: [currentChat, ...chats.filter(c => c.id !== activeChatId)] });
          } else {
            currentChat = { id: activeChatId, messages: [], title: 'New Chat' };
          }
        } catch (fetchError) {
          console.warn('Could not fetch chat from Firestore, using empty:', fetchError);
          currentChat = { id: activeChatId, messages: [], title: 'New Chat' };
        }
      }

      // Upload images to Firebase Storage if any (for persistence)
      const imageUrls = [];
      const imageFiles = Array.isArray(images) ? images : [];
      
      if (imageFiles.length > 0) {
        for (const image of imageFiles) {
          try {
            const timestamp = Date.now();
            const fileName = `${timestamp}_${image.name || 'image'}`;
            const imageRef = ref(storage, `chats/${activeChatId}/${fileName}`);
            await uploadBytes(imageRef, image);
            const downloadURL = await getDownloadURL(imageRef);
            imageUrls.push(downloadURL);
            console.log('✅ Image uploaded to Firebase Storage:', downloadURL);
          } catch (uploadError) {
            console.error('⚠️ Error uploading image to Storage (continuing anyway):', uploadError);
            // Non blocchiamo l'invio del messaggio se l'upload fallisce
          }
        }
      }

      // Prepare user message with images
      const userMessage = {
        role: 'user',
        content: content || '',
        ...(imageUrls.length > 0 && { images: imageUrls }),
        timestamp: new Date().toISOString()
      };

      // Get current messages array
      const currentMessages = Array.isArray(currentChat.messages) ? currentChat.messages : [];
      
      // Prepare new messages array with user message
      const newMessages = [...currentMessages, userMessage];

      // Update title if it's the first user message
      const newTitle = currentMessages.length === 0 
        ? (content?.slice(0, 50) || 'New Chat')
        : (currentChat.title || 'New Chat');

      // Update local state optimistically (show message immediately)
      const { chats: currentChats } = get();
      const updatedChats = currentChats.map(chat => 
        chat.id === activeChatId 
          ? { ...chat, messages: newMessages, title: newTitle }
          : chat
      );
      set({ chats: updatedChats });

      // Update chat with user message in Firestore
      await updateDoc(chatRef, {
        messages: newMessages,
        title: newTitle,
        updatedAt: serverTimestamp()
      });

      console.log('✅ User message saved to Firebase:', { activeChatId, messageCount: newMessages.length });

      // Get assistant response from Google Gemini
      // Passa sia i File objects che gli URL (per supportare entrambi i casi)
      const assistantResponse = await callGeminiAPI(
        content || (imageFiles.length > 0 ? 'Describe this image' : ''),
        currentModel,
        imageFiles, // File objects (per conversione diretta)
        imageUrls,  // URLs (per immagini già caricate)
        currentMessages // Pass conversation history
      );
      
      // Add assistant message
      const assistantMessage = {
        role: 'assistant',
        content: assistantResponse,
        timestamp: new Date().toISOString()
      };

      const finalMessages = [...newMessages, assistantMessage];

      // Update local state optimistically (show assistant message immediately)
      const { chats: currentChatsForAssistant } = get();
      const finalUpdatedChats = currentChatsForAssistant.map(chat => 
        chat.id === activeChatId 
          ? { ...chat, messages: finalMessages }
          : chat
      );
      set({ chats: finalUpdatedChats });

      // Update chat with assistant response in Firestore
      await updateDoc(chatRef, {
        messages: finalMessages,
        updatedAt: serverTimestamp()
      });

      console.log('✅ Assistant message saved to Firebase:', { activeChatId, totalMessages: finalMessages.length });
    } catch (error) {
      console.error('❌ Error sending message:', error);
      throw error; // Re-throw so UI can handle it
    }
  },

  switchModel: (model) => {
    set({ currentModel: model });
    
    // Update current chat's model if there's an active chat
    const { activeChatId } = get();
    if (activeChatId) {
      const chatRef = doc(db, 'chats', activeChatId);
      updateDoc(chatRef, {
        model: model,
        updatedAt: serverTimestamp()
      }).catch(error => {
        console.error('Error updating model:', error);
      });
    }
  },

  setActiveChat: (id) => {
    set({ activeChatId: id });
  },

  toggleSidebar: () => {
    set(state => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  }
}));

