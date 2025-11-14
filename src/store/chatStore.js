import { create } from 'zustand';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Minimal chat store
 */
export const useChatStore = create((set, get) => ({
  messages: [],

  /**
   * Send a message to /api/chat and get reply
   */
  sendMessage: async (message) => {
    try {
      // Add user message immediately
      const userMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      };

      set(state => ({
        messages: [...state.messages, userMessage]
      }));

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

      // Add assistant message
      const assistantMessage = {
        role: 'assistant',
        content: data.reply || 'No response generated',
        timestamp: new Date().toISOString()
      };

      set(state => ({
        messages: [...state.messages, assistantMessage]
      }));

      return data.reply;
    } catch (error) {
      console.error('[Store] Error sending message:', error);
      throw error;
    }
  },

  /**
   * Clear all messages
   */
  clearMessages: () => {
    set({ messages: [] });
  }
}));

/**
 * Test Firestore Read
 */
export async function testFirestoreRead() {
  try {
    const querySnapshot = await getDocs(collection(db, "test"));
    const documents = [];
    querySnapshot.forEach((doc) => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    console.log('[Firestore] Read test - Documents:', documents);
    return true;
  } catch (error) {
    console.error('[Firestore] Read test - ERROR:', error);
    return false;
  }
}

/**
 * Test Firestore Write
 */
export async function testFirestoreWrite() {
  try {
    const docRef = await addDoc(collection(db, "test"), {
      message: "hello",
      ts: Date.now()
    });
    console.log('[Firestore] Write test - Document ID:', docRef.id);
    return true;
  } catch (error) {
    console.error('[Firestore] Write test - ERROR:', error);
    return false;
  }
}

