import { useState, useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { ALL_MODELS, getModelDisplayName } from '../constants/models';
import { 
  getModelCapabilities, 
  modelSupportsOption, 
  getOptionValues 
} from '../lib/modelCapabilities';
import { isImageModel } from '../lib/modelRouter';
import { HelpCircle } from 'lucide-react';

/**
 * Tooltip component
 */
const Tooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help"
      >
        {children}
      </div>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg max-w-xs">
          {text}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
        </div>
      )}
    </div>
  );
};

/**
 * Model Settings Panel - Dynamic configuration UI based on model capabilities
 */
const ModelSettings = ({ isOpen, onClose }) => {
  const { modelConfigs, loadModelConfig, saveModelConfig, loadAllModelConfigs, debugMode, setDebugMode, userId, reuseLastAssistantImage, toggleReuseLastAssistantImage } = useChatStore();
  const [selectedModel, setSelectedModel] = useState(ALL_MODELS[0]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Get capabilities for selected model
  const capabilities = getModelCapabilities(selectedModel);

  // Load all configs on mount
  useEffect(() => {
    if (isOpen) {
      loadAllModelConfigs();
    }
  }, [isOpen, loadAllModelConfigs]);

  // Load config when model changes
  useEffect(() => {
    if (selectedModel && isOpen) {
      loadConfigForModel(selectedModel);
    }
  }, [selectedModel, isOpen]);

  const loadConfigForModel = async (modelId) => {
    setLoading(true);
    try {
      const loadedConfig = await loadModelConfig(modelId);
      setConfig(loadedConfig);
      setHasChanges(false);
    } catch (error) {
      console.error('Error loading config:', error);
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
  };

  const handleSave = async () => {
    if (!config) return;
    
    setSaving(true);
    try {
      await saveModelConfig(config);
      setHasChanges(false);
      alert('Model configuration saved successfully!');
    } catch (error) {
      console.error('Error saving config:', error);
      alert('Error saving configuration: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset to default values? This will discard all changes.')) {
      loadConfigForModel(selectedModel);
    }
  };

  if (!isOpen) return null;

  // Render field only if model supports it
  const renderField = (optionKey, renderFn) => {
    if (!capabilities || !modelSupportsOption(selectedModel, optionKey)) {
      return null;
    }
    return renderFn();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Model Settings</h2>
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
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading configuration...</div>
          ) : !config ? (
            <div className="text-center text-gray-400 py-8">No configuration loaded</div>
          ) : (
            <div className="space-y-6">
              {/* Model Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ALL_MODELS.map(model => (
                    <option key={model} value={model}>
                      {getModelDisplayName(model)}
                    </option>
                  ))}
                </select>
              </div>

              {/* System Instruction */}
              {renderField('systemInstruction', () => (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    System Instruction
                    <Tooltip text="Instructions that guide the model's behavior and responses">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                  <textarea
                    value={config.systemPrompt || ''}
                    onChange={(e) => handleConfigChange('systemPrompt', e.target.value)}
                    rows={4}
                    placeholder="Enter system instructions..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
                  />
                </div>
              ))}

              {/* Temperature */}
              {renderField('temperature', () => (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    Temperature: {config.temperature ?? 0.7}
                    <Tooltip text="Controls randomness. Lower = more deterministic, Higher = more creative">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={config.temperature ?? 0.7}
                    onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0 (Deterministic)</span>
                    <span>1 (Balanced)</span>
                    <span>2 (Creative)</span>
                  </div>
                </div>
              ))}

              {/* Top P */}
              {renderField('topP', () => (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    Top P: {config.topP ?? 0.95}
                    <Tooltip text="Nucleus sampling: considers tokens with top-p probability mass">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.topP ?? 0.95}
                    onChange={(e) => handleConfigChange('topP', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0 (Focused)</span>
                    <span>1 (Diverse)</span>
                  </div>
                </div>
              ))}

              {/* Max Tokens - Only show if outputType is not "image" for nanobanana */}
              {renderField('maxTokens', () => {
                // For nanobanana, only show if outputType is "image_and_text"
                if (selectedModel === 'gemini-2.5-flash-image') {
                  const outputType = config.outputType || 'image';
                  if (outputType === 'image') {
                    return null; // Don't show maxTokens for image-only mode
                  }
                }
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                      Max Output Tokens
                      <Tooltip text="Maximum number of tokens to generate in the response">
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </Tooltip>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="32768"
                      value={config.maxOutputTokens ?? 8192}
                      onChange={(e) => handleConfigChange('maxOutputTokens', parseInt(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                );
              })}

              {/* Output Type (for nanobanana) */}
              {renderField('outputType', () => {
                const values = getOptionValues(selectedModel, 'outputType');
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                      Output Type
                      <Tooltip text="Type of output: image only or image with text">
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </Tooltip>
                    </label>
                    <select
                      value={config.outputType || 'image'}
                      onChange={(e) => handleConfigChange('outputType', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {values.map(value => (
                        <option key={value} value={value}>
                          {value === 'image' ? 'Image Only' : 'Image + Text'}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}

              {/* Image Format / Aspect Ratio (for nanobanana) */}
              {renderField('imageFormat', () => {
                const values = getOptionValues(selectedModel, 'imageFormat');
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                      Aspect Ratio
                      <Tooltip text="Aspect ratio for generated images">
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </Tooltip>
                    </label>
                    <select
                      value={config.aspectRatio || '1:1'}
                      onChange={(e) => handleConfigChange('aspectRatio', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {values.map(value => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}

              {/* Thought Budget (for text model) */}
              {renderField('thoughtBudget', () => {
                const values = getOptionValues(selectedModel, 'thoughtBudget');
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                      Thought Budget
                      <Tooltip text="Controls reasoning depth: auto, manual, or off">
                        <HelpCircle className="w-4 h-4 text-gray-400" />
                      </Tooltip>
                    </label>
                    <select
                      value={config.thoughtBudget || 'auto'}
                      onChange={(e) => handleConfigChange('thoughtBudget', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {values.map(value => (
                        <option key={value} value={value}>
                          {value.charAt(0).toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}

              {/* Grounding Google */}
              {renderField('groundingGoogle', () => (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="groundingGoogle"
                    checked={config.groundingGoogle || false}
                    onChange={(e) => handleConfigChange('groundingGoogle', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="groundingGoogle" className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    Grounding (Google Search)
                    <Tooltip text="Enable Google Search grounding for real-time information">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                </div>
              ))}

              {/* Grounding Your Data */}
              {renderField('groundingYourData', () => (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="groundingYourData"
                    checked={config.groundingYourData || false}
                    onChange={(e) => handleConfigChange('groundingYourData', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="groundingYourData" className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    Grounding (Your Data)
                    <Tooltip text="Enable grounding with your own data sources">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                </div>
              ))}

              {/* Structured Output */}
              {renderField('structuredOutput', () => (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="structuredOutput"
                    checked={config.structuredOutput || false}
                    onChange={(e) => handleConfigChange('structuredOutput', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="structuredOutput" className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    Structured Output
                    <Tooltip text="Enable structured output format (JSON Schema)">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                </div>
              ))}

              {/* Streaming */}
              {renderField('streaming', () => (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="streaming"
                    checked={config.streaming !== false}
                    onChange={(e) => handleConfigChange('streaming', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="streaming" className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    Streaming
                    <Tooltip text="Enable streaming responses for real-time output">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                </div>
              ))}

              {/* Safety Settings */}
              {renderField('safetySettings', () => (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    Safety Settings
                    <Tooltip text="Configure content safety filters">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
                    <p className="text-xs text-gray-400">Safety settings configuration coming soon</p>
                  </div>
                </div>
              ))}

              {/* Region */}
              {renderField('region', () => (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    Region
                    <Tooltip text="Select the region for API calls">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                  <select
                    value={config.region || 'us-central1'}
                    onChange={(e) => handleConfigChange('region', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="us-central1">US Central 1</option>
                    <option value="us-east1">US East 1</option>
                    <option value="europe-west1">Europe West 1</option>
                    <option value="asia-southeast1">Asia Southeast 1</option>
                  </select>
                </div>
              ))}

              {/* Reuse Last Assistant Image Toggle - Only for image models */}
              {isImageModel(selectedModel) && (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="reuseLastAssistantImage"
                    checked={reuseLastAssistantImage || false}
                    onChange={() => toggleReuseLastAssistantImage()}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="reuseLastAssistantImage" className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    Riutilizza automaticamente l'ultima immagine generata
                    <Tooltip text="Quando abilitato, l'ultima immagine generata dall'assistente viene automaticamente riutilizzata come input per la generazione successiva">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                    </Tooltip>
                  </label>
                </div>
              )}

              {/* DEBUG MODE Toggle */}
              <div className="border-t border-gray-800 pt-4 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="debugMode" className="text-sm font-medium text-gray-300 block mb-1">
                      DEBUG MODE
                    </label>
                    <p className="text-xs text-gray-400">
                      Enable detailed logging in API responses and console
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    id="debugMode"
                    checked={debugMode}
                    onChange={(e) => setDebugMode(e.target.checked)}
                    className="w-4 h-4 text-yellow-600 bg-gray-800 border-gray-700 rounded focus:ring-yellow-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Reset
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving || !config}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelSettings;
