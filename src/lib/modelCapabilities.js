/**
 * Model Capabilities Configuration
 * Defines which options are available for each model
 */

export const MODEL_CAPABILITIES = {
  // ============================================================
  // TEXT MODEL — Gemini 2.5 Flash Preview
  // ============================================================
  "gemini-2.5-flash": {
    label: "Gemini 2.5 Flash Preview (Testo)",
    type: "text",
    options: {
      temperature: true,
      topP: true,
      maxTokens: true,
      systemInstruction: true,
      thoughtBudget: {
        enabled: true,
        values: ["auto", "manual", "off"],
      },
      groundingGoogle: true,
      groundingYourData: true,
      structuredOutput: true,
      streaming: true,
      safetySettings: true,
      region: true,
    },
  },

  // ============================================================
  // IMAGE MODEL — Nanobanana
  // ============================================================
  "gemini-2.5-flash-image": {
    label: "Nano Banana (Generazione Immagini)",
    type: "image",
    options: {
      outputType: {
        enabled: true,
        values: [
          "image", 
          "image_and_text"
        ]
      },
      imageFormat: {
        enabled: true,
        values: [
          "1:1",
          "3:2",
          "2:3",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16"
        ]
      },
      temperature: true,
      topP: true,
      // maxTokens SOLO se output = "image_and_text"
      maxTokens: true,
      systemInstruction: true,
      streaming: false, // Immagini → niente streaming
      safetySettings: true,
      region: true
    },
  },
};

/**
 * Get capabilities for a model
 */
export function getModelCapabilities(modelId) {
  return MODEL_CAPABILITIES[modelId] || null;
}

/**
 * Check if a model supports a specific option
 */
export function modelSupportsOption(modelId, option) {
  const capabilities = getModelCapabilities(modelId);
  if (!capabilities) return false;
  
  const optionValue = capabilities.options[option];
  if (optionValue === undefined) return false;
  
  // For boolean options
  if (typeof optionValue === 'boolean') {
    return optionValue === true;
  }
  
  // For object options (like outputType, imageFormat)
  if (typeof optionValue === 'object' && optionValue !== null) {
    return optionValue.enabled === true;
  }
  
  return false;
}

/**
 * Get available values for an option (if it's a dropdown/select)
 */
export function getOptionValues(modelId, option) {
  const capabilities = getModelCapabilities(modelId);
  if (!capabilities) return [];
  
  const optionValue = capabilities.options[option];
  if (typeof optionValue === 'object' && optionValue !== null && optionValue.values) {
    return optionValue.values;
  }
  
  return [];
}

/**
 * Get all supported models
 */
export function getSupportedModels() {
  return Object.keys(MODEL_CAPABILITIES);
}

