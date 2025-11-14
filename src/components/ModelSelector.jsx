import { useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { ALL_MODELS, MODEL_INFO, getModelDisplayName, DEFAULT_MODEL } from '../constants/models';

/**
 * Model Selector Component with tooltips
 */
const ModelSelector = () => {
  const { selectedModel, setSelectedModel } = useChatStore();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredModel, setHoveredModel] = useState(null);

  const handleModelChange = (model) => {
    setSelectedModel(model);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Dropdown Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-white transition-colors"
      >
        <span>{getModelDisplayName(selectedModel)}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          {/* Menu */}
          <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 max-h-96 overflow-y-auto">
            {ALL_MODELS.map((model) => (
              <div
                key={model}
                className="relative group"
                onMouseEnter={() => setHoveredModel(model)}
                onMouseLeave={() => setHoveredModel(null)}
              >
                <button
                  onClick={() => handleModelChange(model)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700 transition-colors ${
                    selectedModel === model ? 'bg-gray-700' : ''
                  }`}
                >
                  <span className="text-sm text-white">{getModelDisplayName(model)}</span>
                  <div className="flex items-center gap-2">
                    {selectedModel === model && (
                      <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {/* Info Icon */}
                    <div className="relative">
                      <svg
                        className="w-4 h-4 text-gray-400 hover:text-gray-300"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      {/* Tooltip */}
                      {hoveredModel === model && (
                        <div className="absolute right-0 top-6 w-56 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-lg z-30 text-xs text-gray-200">
                          {MODEL_INFO[model]}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ModelSelector;

