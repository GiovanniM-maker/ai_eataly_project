import { useState, useEffect, useRef } from 'react';
import { useChatStore, testFirestoreRead, testFirestoreWrite } from '../store/chatStore';
import ModelSelector from './ModelSelector';
import { getModelDisplayName } from '../constants/models';

/**
 * Minimal Chat UI Component with Firestore persistence
 */
const ChatUI = () => {
  const { messages, sendMessage, sendImageMessage, generateImage, loadMessages, firestoreError, loading, selectedModel } = useChatStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [firestoreStatus, setFirestoreStatus] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load messages on mount
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      await sendMessage(message);
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

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedImage(file);
      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendImage = async () => {
    if (!selectedImage || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await sendImageMessage(selectedImage);
      setSelectedImage(null);
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
        setImagePreview(null);
      }
    } catch (error) {
      console.error('Error sending image:', error);
      setError(error.message || 'Failed to send image');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
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
                  {/* Image messages: type === "image" with url */}
                  {message.type === 'image' && message.url && (
                    <img
                      src={message.url}
                      alt={message.role === 'user' ? 'Uploaded image' : 'Generated image'}
                      className="max-w-full rounded-lg mt-2"
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                  )}
                  {/* Legacy: Image from URL (for backward compatibility) */}
                  {!message.type && message.imageUrl && (
                    <img
                      src={message.imageUrl}
                      alt={message.role === 'user' ? 'Uploaded image' : 'Generated image'}
                      className="max-w-full rounded-lg mt-2"
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                  )}
                  {/* Image from base64 (temporary, during upload) */}
                  {message.imageBase64 && (
                    <img
                      src={`data:image/png;base64,${message.imageBase64}`}
                      alt="Generated image"
                      className="max-w-full rounded-lg mt-2"
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                  )}
                  {/* Image from local preview (temporary, user upload) */}
                  {message.localPreviewUrl && (
                    <img
                      src={message.localPreviewUrl}
                      alt="Uploaded image"
                      className="max-w-full rounded-lg mt-2"
                      style={{ maxWidth: '100%', height: 'auto' }}
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
          {/* Image Preview */}
          {imagePreview && (
            <div className="mb-3 relative inline-block">
              <img
                src={imagePreview}
                alt="Preview"
                className="max-w-[240px] rounded-lg border border-gray-700"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
              >
                ×
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
              id="image-upload"
            />
            <label
              htmlFor="image-upload"
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg cursor-pointer transition-colors flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Image
            </label>
            {selectedImage && (
              <button
                type="button"
                onClick={handleSendImage}
                disabled={isLoading}
                className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Send Image
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isLoading}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg transition-all font-medium"
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
