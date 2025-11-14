import { create } from 'zustand';
import { collection, getDocs, addDoc, getDoc, doc } from 'firebase/firestore';
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

// SUPER DETAILED WRITE DEBUG
export async function testFirestoreWrite() {
  console.group("[🔥 Firestore WRITE DEBUG]");

  try {
    console.log("➡️ Starting write test...");

    console.log("📌 Project ID:", import.meta.env.VITE_FIREBASE_PROJECT_ID);
    console.log("📌 Firestore Instance:", db);

    const testCollection = "test";
    const payload = {
      timestamp: Date.now(),
      example: "write-test",
      envProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    };

    console.log("🧪 Payload:", payload);
    console.log("📁 Writing to collection:", testCollection);

    // REAL WRITE COMMAND
    const ref = await addDoc(collection(db, testCollection), payload);

    console.log("✅ WRITE SUCCESS - Document ID:", ref.id);

    // VERIFY BY READING BACK
    const snap = await getDoc(doc(db, testCollection, ref.id));

    if (snap.exists()) {
      console.log("📖 CONFIRMED READ BACK:", snap.data());
    } else {
      console.warn("⚠️ READ BACK FAILED — document not found after write");
    }

    console.groupEnd();
    return true;

  } catch (error) {
    console.group("❌ WRITE ERROR DETAILS");
    console.error("Error:", error);
    console.error("Error code:", error.code);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.groupEnd();

    console.group("🧠 Possible Causes");
    console.warn("1️⃣ Firestore Rules block writes");
    console.warn("2️⃣ Wrong projectId / wrong environment variables");
    console.warn("3️⃣ Firestore is Datastore Mode (write not allowed)");
    console.warn("4️⃣ App using different Firebase project than expected");
    console.groupEnd();

    console.groupEnd();
    return false;
  }
}

