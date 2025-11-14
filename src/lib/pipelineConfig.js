import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Get user ID from localStorage
 */
const getUserId = () => {
  const stored = localStorage.getItem('user_id');
  if (stored) {
    return stored;
  }
  const { v4: uuidv4 } = require('uuid');
  const newUserId = uuidv4();
  localStorage.setItem('user_id', newUserId);
  return newUserId;
};

/**
 * Get pipeline config reference for a specific chat
 */
const getPipelineRef = (chatId) => {
  const userId = getUserId();
  return doc(db, 'users', userId, 'chats', chatId, 'pipeline');
};

/**
 * Load pipeline configuration for a specific chat
 * @param {string} chatId - The chat ID
 * @returns {Promise<Object>} Pipeline configuration
 */
export async function loadPipelineConfig(chatId) {
  try {
    if (!chatId) {
      console.log('[Pipeline] No chatId provided, returning default config');
      return getDefaultPipelineConfig();
    }

    console.log('[Pipeline] Loading pipeline config for chat:', chatId);
    const pipelineRef = getPipelineRef(chatId);
    const pipelineSnap = await getDoc(pipelineRef);

    if (pipelineSnap.exists()) {
      const data = pipelineSnap.data();
      const config = {
        enabled: data.enabled || false,
        model: data.model || null,
        systemInstruction: data.systemInstruction || '',
        temperature: data.temperature ?? 0.8,
        topP: data.topP ?? 0.95,
        maxTokens: data.maxTokens ?? 2048
      };
      console.log('[Pipeline] Config loaded:', config);
      return config;
    } else {
      console.log('[Pipeline] Config not found, returning default');
      // Create default config
      const defaultConfig = getDefaultPipelineConfig();
      await setDoc(pipelineRef, defaultConfig);
      return defaultConfig;
    }
  } catch (error) {
    console.error('[Pipeline] Error loading config:', error);
    return getDefaultPipelineConfig();
  }
}

/**
 * Save pipeline configuration for a specific chat
 * @param {string} chatId - The chat ID
 * @param {Object} config - Pipeline configuration
 * @returns {Promise<boolean>} Success status
 */
export async function savePipelineConfig(chatId, config) {
  try {
    if (!chatId) {
      throw new Error('chatId is required to save pipeline config');
    }

    console.log('[Pipeline] Saving pipeline config for chat:', chatId);
    const pipelineRef = getPipelineRef(chatId);
    
    const configData = {
      enabled: config.enabled || false,
      model: config.model || null,
      systemInstruction: config.systemInstruction || '',
      temperature: config.temperature ?? 0.8,
      topP: config.topP ?? 0.95,
      maxTokens: config.maxTokens ?? 2048,
      updatedAt: Date.now()
    };
    
    await setDoc(pipelineRef, configData, { merge: true });
    console.log('[Pipeline] Config saved successfully');
    return true;
  } catch (error) {
    console.error('[Pipeline] Error saving config:', error);
    throw error;
  }
}

/**
 * Get default pipeline configuration
 */
function getDefaultPipelineConfig() {
  return {
    enabled: false,
    model: null,
    systemInstruction: '',
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 2048
  };
}

