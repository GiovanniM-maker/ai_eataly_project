/**
 * Model Router - Automatic routing for all Gemini models
 * Determines endpoint, payload, and response handling based on model type
 */

/**
 * Resolve model configuration
 * @param {string} modelName - Model identifier (e.g., "gemini-2.5-pro", "imagen-4")
 * @returns {Object} Configuration object with type, endpoint, and googleModel
 */
export function resolveModelConfig(modelName) {
  if (!modelName) {
    throw new Error('Model name is required');
  }

  const normalizedModel = modelName.toLowerCase().trim();

  // TEXT MODELS
  const textModels = {
    'gemini-2.5-pro': {
      type: 'text',
      endpoint: '/api/chat',
      googleModel: 'gemini-2.5-pro'
    },
    'gemini-2.5-flash': {
      type: 'text',
      endpoint: '/api/chat',
      googleModel: 'gemini-2.5-flash'
    },
    'gemini-2.5-flash-lite': {
      type: 'text',
      endpoint: '/api/chat',
      googleModel: 'gemini-2.5-flash-lite'
    },
    'gemini-1.5-pro': {
      type: 'text',
      endpoint: '/api/chat',
      googleModel: 'gemini-1.5-pro'
    },
    'gemini-1.5-flash': {
      type: 'text',
      endpoint: '/api/chat',
      googleModel: 'gemini-1.5-flash'
    }
  };

  // IMAGE GENERATION MODELS
  // Only 3 models supported
  const imageModels = {
    'gemini-2.5-flash-image': {
      type: 'image',
      endpoint: '/api/generateImage',
      googleModel: 'gemini-2.5-flash-image',
      provider: 'gemini-image' // Uses generateContent with responseModalities: ["IMAGE"]
    },
    'gemini-2.5-flash-image-multimodal': {
      type: 'image',
      endpoint: '/api/generateImage',
      googleModel: 'gemini-2.5-flash-image-multimodal',
      provider: 'gemini-multimodal' // Uses generateContent with responseModalities: ["TEXT","IMAGE"]
    },
    'imagen-4': {
      type: 'image',
      endpoint: '/api/generateImage',
      googleModel: 'imagen-4',
      provider: 'imagen' // Uses generateImage endpoint
    }
  };

  // VISION INPUT MODELS
  const visionModels = {
    'gemini-2.5-pro-vision': {
      type: 'vision',
      endpoint: '/api/generateVision',
      googleModel: 'gemini-2.5-pro-vision'
    },
    'gemini-1.5-pro-vision': {
      type: 'vision',
      endpoint: '/api/generateVision',
      googleModel: 'gemini-1.5-pro-vision'
    }
  };

  // AUDIO MODELS
  const audioModels = {
    'gemini-2.5-flash-audio': {
      type: 'audio',
      endpoint: '/api/generateAudio',
      googleModel: 'gemini-2.5-flash-audio'
    },
    'gemini-1.5-flash-audio': {
      type: 'audio',
      endpoint: '/api/generateAudio',
      googleModel: 'gemini-1.5-flash-audio'
    }
  };

  // Check all model maps
  if (textModels[normalizedModel]) {
    return textModels[normalizedModel];
  }
  
  if (imageModels[normalizedModel]) {
    return imageModels[normalizedModel];
  }
  
  if (visionModels[normalizedModel]) {
    return visionModels[normalizedModel];
  }
  
  if (audioModels[normalizedModel]) {
    return audioModels[normalizedModel];
  }

  // Default fallback to text model
  console.warn(`[ModelRouter] Unknown model "${modelName}", defaulting to gemini-2.5-flash`);
  return {
    type: 'text',
    endpoint: '/api/chat',
    googleModel: 'gemini-2.5-flash'
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

/**
 * Check if model is a vision model
 */
export function isVisionModel(modelName) {
  const config = resolveModelConfig(modelName);
  return config.type === 'vision';
}

/**
 * Check if model is an audio model
 */
export function isAudioModel(modelName) {
  const config = resolveModelConfig(modelName);
  return config.type === 'audio';
}

