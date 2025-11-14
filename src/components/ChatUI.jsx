import { useState } from 'react';
import { useChatStore, testFirestoreRead, testFirestoreWrite } from '../store/chatStore';

/**
 * Minimal Chat UI Component
 */
const ChatUI = () => {
  const { messages, sendMessage } = useChatStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [firestoreStatus, setFirestoreStatus] = useState(null);

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

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <h1 className="text-xl font-semibold">AI Chat</h1>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-400 mt-12">
              <p>Start a conversation by typing a message below</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
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
          <div className="flex gap-3">
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

