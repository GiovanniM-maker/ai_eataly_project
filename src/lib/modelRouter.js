/**
 * Model Router - Automatic routing for 3 supported models
 * Determines endpoint, payload, and response handling based on model type
 */

/**
 * Resolve model configuration
 * @param {string} modelName - Model identifier
 * @returns {Object} Configuration object with type, endpoint, provider, and modelId
 */
export function resolveModelConfig(modelName) {
  if (!modelName) {
    throw new Error('Model name is required');
  }

  const normalizedModel = modelName.toLowerCase().trim();

  // Model definitions with provider routing
  // ONLY 2 MODELS SUPPORTED
  const models = {
    // Text model - Google REST API
    'gemini-2.5-flash': {
      name: 'gemini-2.5-flash',
      type: 'text',
      provider: 'google-text',
      endpoint: '/api/chat',
      googleModel: 'gemini-2.5-flash'
    },
    
    // Image model - Vertex AI Gemini (Nanobanana)
    'gemini-2.5-flash-image': {
      name: 'gemini-2.5-flash-image',
      type: 'image',
      provider: 'nanobanana',
      endpoint: '/api/generateNanobananaImage',
      googleModel: 'gemini-2.5-flash-image'
    }
  };

  const config = models[normalizedModel];
  
  if (!config) {
    console.warn(`[ModelRouter] Unknown model "${modelName}", defaulting to gemini-2.5-flash`);
    return models['gemini-2.5-flash'];
  }

  return {
    endpoint: config.endpoint,
    type: config.type,
    provider: config.provider,
    modelId: config.name,
    googleModel: config.googleModel
  };
}

/**
 * Check if model is a text model
 */
export function isTextModel(modelName) {
  const config = resolveModelConfig(modelName);
  return config.type === 'text';
}

/**
 * Check if model is an image generation model
 */
export function isImageModel(modelName) {
  const config = resolveModelConfig(modelName);
  return config.type === 'image';
}
