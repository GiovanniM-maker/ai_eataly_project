import { useState, useEffect, useRef } from 'react';
import { useChatStore, testFirestoreRead, testFirestoreWrite } from '../store/chatStore';
import ModelSelector from './ModelSelector';
import { getModelDisplayName } from '../constants/models';

/**
 * Minimal Chat UI Component with Firestore persistence
 */
const ChatUI = () => {
  const { messages, sendMessage, sendImageMessage, loadMessages, firestoreError, loading, selectedModel } = useChatStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [firestoreStatus, setFirestoreStatus] = useState(null);
  // Pending composer state (like ChatGPT)
  const [pendingImages, setPendingImages] = useState([]); // Array of { file: File, base64: string }
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const { activeChatId, loadChatsFromFirestore } = useChatStore();

  // Load chats and messages on mount
  useEffect(() => {
    loadChatsFromFirestore();
  }, [loadChatsFromFirestore]);

  // Load messages when active chat changes
  useEffect(() => {
    if (activeChatId) {
      loadMessages();
    }
  }, [activeChatId, loadMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Don't send if nothing to send
    if ((!input.trim() && pendingImages.length === 0) || isLoading) return;

    const text = input.trim();
    const images = [...pendingImages];
    
    // Clear composer state
    setInput('');
    setPendingImages([]);
    setIsLoading(true);
    setError(null);

    try {
      // If there are images, send them first
      if (images.length > 0) {
        for (const img of images) {
          await sendImageMessage(img.file);
        }
      }
      
      // If there's text, send it
      if (text) {
        await sendMessage(text);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setError(error.message || 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestRead = async () => {
    console.log('[UI] Testing Firestore Read...');
    const result = await testFirestoreRead();
    if (result) {
      setFirestoreStatus('Firestore Read OK');
      console.log('[UI] Firestore Read test: OK');
    } else {
      setFirestoreStatus('Firestore Read ERROR');
      console.error('[UI] Firestore Read test: ERROR');
    }
    setTimeout(() => setFirestoreStatus(null), 3000);
  };

  const handleTestWrite = async () => {
    console.log('[UI] Testing Firestore Write...');
    const result = await testFirestoreWrite();
    if (result) {
      setFirestoreStatus('Firestore Write OK');
      console.log('[UI] Firestore Write test: OK');
    } else {
      setFirestoreStatus('Firestore Write ERROR');
      console.error('[UI] Firestore Write test: ERROR');
    }
    setTimeout(() => setFirestoreStatus(null), 3000);
  };

  /**
   * Add image to pending queue
   */
  const handleImageSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newImages = [];
    
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        // Convert to base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        newImages.push({ file, base64 });
      }
    }
    
    if (newImages.length > 0) {
      setPendingImages(prev => [...prev, ...newImages]);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Remove image from pending queue
   */
  const handleRemoveImage = (index) => {
    setPendingImages(prev => {
      const newImages = [...prev];
      // Revoke object URL if it exists
      if (newImages[index]?.base64?.startsWith('blob:')) {
        URL.revokeObjectURL(newImages[index].base64);
      }
      newImages.splice(index, 1);
      return newImages;
    });
  };

  /**
   * Handle Enter key (send) or Shift+Enter (new line)
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI Chat</h1>
        <ModelSelector />
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {loading && messages.length === 0 ? (
            <div className="text-center text-gray-400 mt-12">
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-400 mt-12">
              <p>Start a conversation by typing a message below</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id || `msg-${message.timestamp}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  {/* Model label (if different from selected) */}
                  {message.model && message.model !== selectedModel && (
                    <div className="mb-2">
                      <span className="text-xs opacity-70 italic">
                        Model: {getModelDisplayName(message.model)}
                      </span>
                    </div>
                  )}
                  {/* Text content */}
                  {message.content && (
                    <p className="whitespace-pre-wrap mb-2">{message.content}</p>
                  )}
                  {/* Image messages: type === "image" with base64 */}
                  {message.type === 'image' && message.base64 && (
                    <img
                      src={message.base64}
                      alt={message.role === 'user' ? 'Uploaded image' : 'Generated image'}
                      className="max-w-full rounded-lg mt-2"
                      style={{ maxWidth: '100%', height: 'auto' }}
                      onLoad={() => console.log('[UI] Image rendered successfully from base64')}
                      onError={(e) => console.error('[UI] Error rendering image from base64:', e)}
                    />
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-lg px-4 py-3">
                <p className="text-gray-400">Thinking...</p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-800 bg-gray-900 p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          {error && (
            <div className="mb-3 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}
          {firestoreError && (
            <div className="mb-3 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              Firestore Error: {firestoreError}
            </div>
          )}
          {firestoreStatus && (
            <div className={`mb-3 p-2 rounded text-sm ${
              firestoreStatus.includes('OK') 
                ? 'bg-green-900/50 border border-green-700 text-green-200' 
                : 'bg-red-900/50 border border-red-700 text-red-200'
            }`}>
              {firestoreStatus}
            </div>
          )}
          {/* Firestore Test Buttons */}
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={handleTestRead}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              Test Read
            </button>
            <button
              type="button"
              onClick={handleTestWrite}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              Test Write
            </button>
          </div>
          {/* Image Preview Bubble (above textarea) */}
          {pendingImages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingImages.map((img, index) => (
                <div key={index} className="relative inline-block">
                  <img
                    src={img.base64}
                    alt={`Preview ${index + 1}`}
                    className="h-20 w-20 rounded-lg object-cover border border-gray-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(index)}
                    className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold transition-colors"
                    title="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              multiple
              className="hidden"
              id="image-upload"
            />
            <label
              htmlFor="image-upload"
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg cursor-pointer transition-colors flex items-center flex-shrink-0"
              title="Attach image"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[48px] max-h-[200px] overflow-y-auto"
              style={{ 
                height: 'auto',
                minHeight: '48px'
              }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
            />
            <button
              type="submit"
              disabled={(input.trim().length === 0 && pendingImages.length === 0) || isLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg transition-all font-medium flex-shrink-0"
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatUI;
