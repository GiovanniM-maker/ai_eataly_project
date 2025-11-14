import { loadModelConfig } from './firestoreConfig.js';

/**
 * Load pipeline configuration from Firestore
 * Returns default config if not found
 */
export async function loadPipelineConfig() {
  try {
    // Use the same Firestore REST API approach as firestoreConfig.js
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const projectId = serviceAccount.project_id;
    
    // Get access token using Google Auth Library
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/datastore']
    });
    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();
    
    if (!accessToken) {
      throw new Error('Failed to get access token');
    }
    
    // Firestore REST API endpoint
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/configs/modelPipeline`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 404) {
      // Document doesn't exist, return default
      console.log('[PIPELINE] Config not found, using defaults');
      return getDefaultPipelineConfig();
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore API error: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    
    // Parse Firestore document format
    const fields = data.fields || {};
    
    const config = {
      enabled: fields.enabled?.booleanValue === true || false,
      preModel: fields.preModel?.stringValue || null,
      instructions: fields.instructions?.stringValue || '',
      extraPrompt: fields.extraPrompt?.stringValue || '',
      temperature: fields.temperature?.doubleValue ?? 0.4,
      topP: fields.topP?.doubleValue ?? 0.9
    };
    
    console.log('[PIPELINE] CONFIG LOADED:', config);
    return config;
  } catch (error) {
    console.error('[PIPELINE] Error loading config:', error);
    // Return default on error
    return getDefaultPipelineConfig();
  }
}

/**
 * Save pipeline configuration to Firestore
 */
export async function savePipelineConfig(config) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const projectId = serviceAccount.project_id;
    
    // Get access token
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/datastore']
    });
    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();
    
    if (!accessToken) {
      throw new Error('Failed to get access token');
    }
    
    // Firestore REST API endpoint
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/configs/modelPipeline`;
    
    // Convert config to Firestore document format
    const fields = {
      enabled: { booleanValue: config.enabled || false },
      preModel: config.preModel ? { stringValue: config.preModel } : { nullValue: null },
      instructions: { stringValue: config.instructions || '' },
      extraPrompt: { stringValue: config.extraPrompt || '' },
      temperature: { doubleValue: config.temperature ?? 0.4 },
      topP: { doubleValue: config.topP ?? 0.9 }
    };
    
    const document = {
      fields: fields
    };
    
    // Use PATCH to update or create
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(document)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore API error: ${response.status} ${errorText}`);
    }
    
    console.log('[PIPELINE] Config saved successfully');
    return true;
  } catch (error) {
    console.error('[PIPELINE] Error saving config:', error);
    throw error;
  }
}

/**
 * Get default pipeline configuration
 */
function getDefaultPipelineConfig() {
  return {
    enabled: false,
    preModel: null,
    instructions: '',
    extraPrompt: '',
    temperature: 0.4,
    topP: 0.9
  };
}

