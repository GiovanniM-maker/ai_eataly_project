import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';
import { ALL_MODELS, getModelDisplayName } from '../constants/models';
import { loadPipelineConfig, savePipelineConfig } from '../lib/pipelineConfig';

/**
 * Pipeline Config Modal - "Il modello prima" configuration
 * Per chat specifica: users/{uid}/chats/{chatId}/pipeline
 */
const PipelineConfig = ({ isOpen, onClose }) => {
  const { activeChatId } = useChatStore();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const saveTimeoutRef = useRef(null);

  // Load config when modal opens or chat changes
  useEffect(() => {
    if (isOpen && activeChatId) {
      loadConfig();
    } else if (isOpen && !activeChatId) {
      // No active chat, use default config
      setConfig(getDefaultConfig());
      setHasChanges(false);
    }
  }, [isOpen, activeChatId]);

  const getDefaultConfig = () => ({
    enabled: false,
    model: null,
    systemInstruction: '',
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 2048
  });

  const loadConfig = async () => {
    if (!activeChatId) {
      setConfig(getDefaultConfig());
      return;
    }

    setLoading(true);
    try {
      const loadedConfig = await loadPipelineConfig(activeChatId);
      setConfig(loadedConfig);
      setHasChanges(false);
    } catch (error) {
      console.error('[PipelineConfig] Error loading config:', error);
      setConfig(getDefaultConfig());
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
    setHasChanges(true);

    // Auto-save with debounce (400ms)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      handleSave(true); // silent save
    }, 400);
  };

  const handleSave = async (silent = false) => {
    if (!config || !activeChatId) {
      if (!activeChatId && !silent) {
        alert('Nessuna chat attiva. Crea una nuova chat prima di configurare la pipeline.');
      }
      return;
    }
    
    setSaving(true);
    try {
      await savePipelineConfig(activeChatId, config);
      setHasChanges(false);
      if (!silent) {
        alert('Pipeline configuration saved successfully!');
      }
    } catch (error) {
      console.error('[PipelineConfig] Error saving config:', error);
      if (!silent) {
        alert('Error saving configuration: ' + error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset to default values? This will discard all changes.')) {
      loadConfig();
    }
  };

  // Filter only text-capable models
  const textModels = ALL_MODELS.filter(model => {
    // Exclude image-only models
    return !model.includes('imagen') && !model.includes('image');
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Modello Prima (Pipeline)</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading ? (
            <div className="text-center text-gray-400 py-8">
              <p>Loading configuration...</p>
            </div>
          ) : config ? (
            <>
              {/* Enable Toggle */}
              <div className="flex items-center justify-between">
                <label className="text-white font-medium">Abilita pre-processing</label>
                <button
                  type="button"
                  onClick={() => handleConfigChange('enabled', !config.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    config.enabled ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      config.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Pre-Model Selector */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Modello pre-processing *
                </label>
                <select
                  value={config.model || ''}
                  onChange={(e) => handleConfigChange('model', e.target.value || null)}
                  disabled={!config.enabled}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Seleziona modello...</option>
                  {textModels.map((model) => (
                    <option key={model} value={model}>
                      {getModelDisplayName(model)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Solo modelli text-capable
                </p>
              </div>

              {/* System Instructions Textarea */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Istruzioni sistema (per pre-model) *
                </label>
                <textarea
                  value={config.systemInstruction}
                  onChange={(e) => handleConfigChange('systemInstruction', e.target.value)}
                  disabled={!config.enabled}
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Esempio: 'Riformula il messaggio dell'utente in modo più chiaro e strutturato...'"
                />
              </div>

              {/* Temperature Slider */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Temperature: {config.temperature.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                  disabled={!config.enabled}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0.0 (Deterministico)</span>
                  <span>2.0 (Creativo)</span>
                </div>
              </div>

              {/* TopP Slider */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Top P: {config.topP.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.topP}
                  onChange={(e) => handleConfigChange('topP', parseFloat(e.target.value))}
                  disabled={!config.enabled}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0.0</span>
                  <span>1.0</span>
                </div>
              </div>

              {/* Max Tokens Input */}
              <div>
                <label className="block text-white font-medium mb-2">
                  Max Tokens
                </label>
                <input
                  type="number"
                  min="1"
                  max="32768"
                  step="1"
                  value={config.maxTokens}
                  onChange={(e) => handleConfigChange('maxTokens', parseInt(e.target.value) || 2048)}
                  disabled={!config.enabled}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Massimo numero di token generati (1-32768)
                </p>
              </div>
            </>
          ) : (
            <div className="text-center text-gray-400 py-8">
              <p>Error loading configuration</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
          {!activeChatId && (
            <p className="text-sm text-yellow-400">
              ⚠️ Crea una chat per configurare la pipeline
            </p>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={handleReset}
              disabled={!hasChanges || saving || !activeChatId}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving || loading || !activeChatId}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Salva'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PipelineConfig;

