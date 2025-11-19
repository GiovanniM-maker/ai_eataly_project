import { useState, useEffect, useRef } from 'react';
import { useChatStore, testFirestoreRead, testFirestoreWrite } from '../store/chatStore';
import ModelSelector from './ModelSelector';
import ModelSettings from './ModelSettings';
import PipelineConfig from './PipelineConfig';
import { getModelDisplayName } from '../constants/models';
import { 
  Copy, 
  RotateCcw, 
  Edit3, 
  Square, 
  Sparkles, 
  Settings, 
  SlidersHorizontal, 
  Workflow, 
  Send, 
  Image as ImageIcon,
  X
} from 'lucide-react';

/**
 * Minimal Chat UI Component with Firestore persistence
 */
const ChatUI = () => {
  const { 
    messages, 
    sendMessage, 
    sendImageMessage, 
    loadMessages, 
    firestoreError, 
    loading, 
    selectedModel,
    loadModelConfig,
    buildModelSettings,
    updateMessage,
    regenerateMessage,
    editUserMessage,
    stopGeneration,
    isGenerating
  } = useChatStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [firestoreStatus, setFirestoreStatus] = useState(null);
  // Pending composer state (like ChatGPT)
  const [pendingImages, setPendingImages] = useState([]); // Array of { file: File, base64: string }
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showPipelineConfig, setShowPipelineConfig] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [snackbar, setSnackbar] = useState(null);
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const { activeChatId, loadChatsFromFirestore, pipelineConfig: currentPipelineConfig } = useChatStore();

  // Load chats and messages on mount
  useEffect(() => {
    loadChatsFromFirestore();
    // Load model configs on mount to ensure settings are available
    const { loadAllModelConfigs } = useChatStore.getState();
    loadAllModelConfigs();
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
      // Convert images to attachments format
      const attachments = [];
      
      for (const img of images) {
        // Get image dimensions
        const dimensions = await new Promise((resolve) => {
          const imgEl = new Image();
          imgEl.onload = () => {
            resolve({ width: imgEl.width, height: imgEl.height });
          };
          imgEl.onerror = () => {
            resolve({ width: 0, height: 0 });
          };
          imgEl.src = img.base64;
        });
        
        // Extract base64 data (remove data:image/...;base64, prefix)
        const base64Data = img.base64.includes(',') 
          ? img.base64.split(',')[1] 
          : img.base64;
        
        const attachment = {
          type: "image",
          mimeType: img.file.type || 'image/jpeg',
          base64: base64Data,
          width: dimensions.width,
          height: dimensions.height
        };
        
        console.log("[DEBUG/UI] Image attached:", attachment);
        attachments.push(attachment);
      }
      
      // Send message with text and attachments together
      await sendMessage({
        text: text || '',
        attachments: attachments
      });
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

  /**
   * Copy message to clipboard
   */
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setSnackbar('Copiato!');
      setTimeout(() => setSnackbar(null), 2000);
    } catch (err) {
      console.error('Clipboard error', err);
      setSnackbar('Errore durante la copia');
      setTimeout(() => setSnackbar(null), 2000);
    }
  };

  /**
   * Handle regenerate response
   */
  const handleRegenerate = async (messageId) => {
    try {
      setIsLoading(true);
      await regenerateMessage(messageId);
    } catch (error) {
      console.error('Error regenerating message:', error);
      setError(error.message || 'Errore durante la rigenerazione');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle edit user message
   */
  const handleEditMessage = (messageId, currentText) => {
    setEditingMessageId(messageId);
    setEditedText(currentText);
  };

  /**
   * Save edited message
   */
  const handleSaveEdit = async (messageId) => {
    if (!editedText.trim()) {
      setEditingMessageId(null);
      return;
    }

    try {
      setIsLoading(true);
      await editUserMessage(messageId, editedText.trim());
      setEditingMessageId(null);
      setEditedText('');
    } catch (error) {
      console.error('Error editing message:', error);
      setError(error.message || 'Errore durante la modifica');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Cancel edit
   */
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditedText('');
  };

  return (
    <div className="flex flex-col flex-1 h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
      {/* Header */}
      <div 
        className="border-b px-6 py-4 flex items-center justify-between"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.8), rgba(246,248,255,0.55))',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-text-main">AI Chat</h1>
          {/* Pipeline Active Badge */}
          {currentPipelineConfig?.enabled && currentPipelineConfig?.model && (
            <span 
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium pipeline-pulse"
              style={{
                background: 'rgba(255,184,76,0.18)',
                border: '1px solid rgba(255,184,76,0.4)',
                color: '#CA8A04',
              }}
            >
              <Workflow size={12} strokeWidth={1.5} />
              Pipeline attiva – {getModelDisplayName(currentPipelineConfig.model)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector />
          <button
            onClick={() => setShowModelSettings(true)}
            className="p-2 rounded-lg transition-all duration-fast hover:bg-glass-white-hover"
            style={{ color: 'rgba(74,79,88,0.8)' }}
            title="Model Settings"
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(74,79,88,0.8)'}
          >
            <SlidersHorizontal size={20} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setShowPipelineConfig(true)}
            className={`p-2 rounded-lg transition-all duration-fast ${
              currentPipelineConfig?.enabled 
                ? 'text-accent-warning' 
                : ''
            }`}
            style={{ 
              color: currentPipelineConfig?.enabled ? 'var(--accent-warning)' : 'rgba(74,79,88,0.8)',
            }}
            title="Modello prima"
            onMouseEnter={(e) => {
              if (!currentPipelineConfig?.enabled) {
                e.currentTarget.style.color = 'var(--accent-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!currentPipelineConfig?.enabled) {
                e.currentTarget.style.color = 'rgba(74,79,88,0.8)';
              }
            }}
          >
            <Workflow size={20} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Model Settings Modal */}
      <ModelSettings isOpen={showModelSettings} onClose={() => setShowModelSettings(false)} />
      
      {/* Pipeline Config Modal */}
      <PipelineConfig isOpen={showPipelineConfig} onClose={() => setShowPipelineConfig(false)} />

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8" style={{ backgroundColor: 'var(--bg-app)' }}>
        <div className="max-w-[900px] mx-auto space-y-3">
          {loading && messages.length === 0 ? (
            <div className="text-center text-text-muted mt-12">
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-text-muted mt-12">
              <p>Start a conversation by typing a message below</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id || `msg-${message.timestamp}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} group message-enter`}
                onMouseEnter={() => setHoveredMessageId(message.id)}
                onMouseLeave={() => setHoveredMessageId(null)}
              >
                <div
                  className="max-w-[80%] relative flex items-start gap-3"
                  style={{
                    background: 'rgba(255,255,255,0.65)',
                    backdropFilter: 'blur(12px)',
                    borderRadius: '18px',
                    border: '1px solid rgba(200,200,200,0.35)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.05)',
                    padding: '16px 18px',
                    transition: 'transform 120ms ease-out, box-shadow 120ms ease-out, background 120ms ease-out',
                  }}
                >
                  {/* Accent bar on left */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full"
                    style={{
                      background: message.role === 'user' 
                        ? 'rgba(107,203,119,0.35)' 
                        : 'rgba(74,116,255,0.35)',
                    }}
                  />
                  
                  {/* Message Actions Bar (visible on hover) */}
                  {hoveredMessageId === message.id && (
                    <div 
                      className="absolute -top-9 right-0 flex gap-1 rounded-full px-2 py-1 z-10"
                      style={{
                        background: 'rgba(255,255,255,0.9)',
                        border: '1px solid rgba(0,0,0,0.04)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      }}
                    >
                      {/* Copy Button (all messages) */}
                      {(message.content || message.base64) && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(message.content || '')}
                          className="p-1.5 rounded-full transition-all duration-fast hover:bg-glass-white-hover"
                          style={{ color: 'rgba(74,79,88,0.5)' }}
                          title="Copia"
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(74,79,88,0.5)'}
                        >
                          <Copy size={16} strokeWidth={1.5} />
                        </button>
                      )}
                      
                      {/* Edit Button (user messages only) */}
                      {message.role === 'user' && message.content && (
                        <button
                          type="button"
                          onClick={() => handleEditMessage(message.id, message.content)}
                          className="p-1.5 rounded-full transition-all duration-fast hover:bg-glass-white-hover"
                          style={{ color: 'rgba(74,79,88,0.5)' }}
                          title="Modifica"
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(74,79,88,0.5)'}
                        >
                          <Edit3 size={16} strokeWidth={1.5} />
                        </button>
                      )}
                      
                      {/* Regenerate Button (assistant messages only) */}
                      {message.role === 'assistant' && (
                        <button
                          type="button"
                          onClick={() => handleRegenerate(message.id)}
                          disabled={isLoading || isGenerating}
                          className="p-1.5 rounded-full transition-all duration-fast hover:bg-glass-white-hover disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ color: 'rgba(74,79,88,0.5)' }}
                          title="Rigenera risposta"
                          onMouseEnter={(e) => {
                            if (!e.currentTarget.disabled) {
                              e.currentTarget.style.color = 'var(--accent-primary)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!e.currentTarget.disabled) {
                              e.currentTarget.style.color = 'rgba(74,79,88,0.5)';
                            }
                          }}
                        >
                          <RotateCcw size={16} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Content wrapper */}
                  <div className="flex-1 pl-3">
                    {/* Pre-processed badge (backwards compatible: check metadata.preprocessedBy or legacy preprocessedBy) */}
                    {(message.metadata?.preprocessedBy || message.preprocessedBy) && (
                      <div className="mb-2">
                        <span 
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{
                            background: 'rgba(255,184,76,0.15)',
                            color: '#CA8A04',
                          }}
                        >
                          <Workflow size={11} strokeWidth={1.5} />
                          Pre-processato da {getModelDisplayName(message.metadata?.preprocessedBy || message.preprocessedBy)}
                        </span>
                      </div>
                    )}
                    
                    {/* Model label (if different from selected) */}
                    {message.model && message.model !== selectedModel && !(message.metadata?.preprocessedBy || message.preprocessedBy) && (
                      <div className="mb-2">
                        <span className="text-xs text-text-muted italic">
                          Model: {getModelDisplayName(message.model)}
                        </span>
                      </div>
                    )}
                    
                    {/* Text content (editable if editing) */}
                    {message.content && (
                      editingMessageId === message.id ? (
                        <div className="mb-2">
                          <textarea
                            value={editedText}
                            onChange={(e) => setEditedText(e.target.value)}
                            className="w-full bg-bg-surface border border-border-subtle text-text-main rounded-lg px-3 py-2 resize-none min-h-[60px] text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                            rows={3}
                            autoFocus
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(message.id)}
                              className="px-3 py-1.5 bg-accent-success hover:bg-accent-success/90 text-white rounded-lg text-sm transition-all duration-fast"
                            >
                              Aggiorna
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="px-3 py-1.5 bg-border-subtle hover:bg-border-soft text-text-main rounded-lg text-sm transition-all duration-fast"
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p 
                          className="whitespace-pre-wrap mb-2"
                          style={{
                            fontSize: '15px',
                            lineHeight: '1.6',
                            color: 'var(--text-main)',
                          }}
                        >
                          {message.content}
                        </p>
                      )
                    )}
                    
                    {/* Image messages: type === "image" with imageUrl or base64 */}
                    {message.type === 'image' && (message.imageUrl || message.base64) && (
                      <img
                        src={message.imageUrl || message.base64}
                        alt={message.role === 'user' ? 'Uploaded image' : 'Generated image'}
                        className="max-w-full rounded-lg mt-2"
                        style={{ maxWidth: '100%', height: 'auto', borderRadius: '12px' }}
                        onLoad={() => console.log('[UI] Image rendered successfully from', message.imageUrl ? 'Storage URL' : 'base64')}
                        onError={(e) => console.error('[UI] Error rendering image:', e)}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div 
                className="relative rounded-lg px-4 py-3"
                style={{
                  background: 'rgba(255,255,255,0.65)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(200,200,200,0.35)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.05)',
                }}
              >
                <p className="text-text-muted text-sm">Thinking...</p>
                {/* Stop Generation Button */}
                {isGenerating && (
                  <button
                    type="button"
                    onClick={stopGeneration}
                    className="absolute -top-9 right-0 bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-full text-sm flex items-center gap-2 transition-all duration-fast shadow-md"
                    style={{ transform: 'scale(1)' }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <Square size={14} strokeWidth={2} fill="currentColor" />
                    Stop
                  </button>
                )}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Snackbar for feedback */}
      {snackbar && (
        <div 
          className="fixed bottom-24 left-1/2 transform -translate-x-1/2 px-4 py-2.5 rounded-full shadow-lg z-50"
          style={{
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(200,200,200,0.3)',
            color: 'var(--text-main)',
            fontSize: '13px',
            fontWeight: '500',
          }}
        >
          {snackbar}
        </div>
      )}

      {/* Input Area */}
      <div 
        className="border-t p-4 sticky bottom-0"
        style={{
          borderColor: 'var(--border-subtle)',
          backgroundColor: 'var(--bg-app)',
        }}
      >
        <form onSubmit={handleSubmit} className="max-w-[900px] mx-auto">
          {error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
          {firestoreError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              Firestore Error: {firestoreError}
            </div>
          )}
          {firestoreStatus && (
            <div className={`mb-3 p-2 rounded-lg text-sm ${
              firestoreStatus.includes('OK') 
                ? 'bg-green-50 border border-green-200 text-green-700' 
                : 'bg-red-50 border border-red-200 text-red-600'
            }`}>
              {firestoreStatus}
            </div>
          )}
          {/* Firestore Test Buttons - Hidden in production, shown only for debugging */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={handleTestRead}
                className="px-3 py-1.5 bg-bg-surface border border-border-subtle hover:bg-glass-white-hover text-text-main text-sm rounded-lg transition-all duration-fast"
              >
                Test Read
              </button>
              <button
                type="button"
                onClick={handleTestWrite}
                className="px-3 py-1.5 bg-bg-surface border border-border-subtle hover:bg-glass-white-hover text-text-main text-sm rounded-lg transition-all duration-fast"
              >
                Test Write
              </button>
            </div>
          )}
          {/* Image Preview Bubble (above textarea) */}
          {pendingImages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingImages.map((img, index) => (
                <div key={index} className="relative inline-block">
                  <img
                    src={img.base64}
                    alt={`Preview ${index + 1}`}
                    className="h-20 w-20 rounded-lg object-cover border"
                    style={{
                      borderColor: 'var(--border-subtle)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(index)}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center transition-all duration-fast shadow-md"
                    style={{ transform: 'scale(1)' }}
                    title="Remove image"
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div 
            className="flex gap-2 items-end"
            style={{
              background: 'rgba(255,255,255,0.9)',
              borderRadius: '22px',
              border: '1px solid rgba(200,200,200,0.4)',
              padding: '6px 8px 6px 12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
            }}
          >
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
              className="p-2 rounded-full cursor-pointer transition-all duration-fast flex items-center flex-shrink-0 hover:bg-glass-white-hover"
              style={{ color: 'rgba(74,79,88,0.8)' }}
              title="Attach image"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(74,79,88,0.8)'}
            >
              <ImageIcon size={20} strokeWidth={1.5} />
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-transparent border-none outline-none resize-none min-h-[40px] max-h-[200px] overflow-y-auto"
              style={{ 
                fontSize: '14px',
                color: 'var(--text-main)',
                height: 'auto',
                minHeight: '40px',
                lineHeight: '1.5',
              }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
            />
            <button
              type="submit"
              disabled={(input.trim().length === 0 && pendingImages.length === 0) || isLoading}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-fast flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: (input.trim().length > 0 || pendingImages.length > 0) && !isLoading
                  ? '#3A5FE6' // Slightly darker blue
                  : 'var(--border-subtle)',
                transform: 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'scale(1.08)';
                  e.currentTarget.style.background = '#2D4FD9'; // Even darker on hover
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.background = '#3A5FE6'; // Back to darker blue
                }
              }}
            >
              <Send size={16} strokeWidth={2} className="text-white" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatUI;
