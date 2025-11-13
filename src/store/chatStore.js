import { create } from 'zustand';

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
      
      console.log('[Store] Calling API:', apiUrl);
      console.log('[Store] Request body:', { message, model: 'gemini-1.5-flash' });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          model: 'gemini-1.5-flash'
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

