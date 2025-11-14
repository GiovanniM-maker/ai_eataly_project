import { GoogleAuth } from "google-auth-library";

/**
 * Load model configuration from Firestore using REST API
 * Uses Firestore REST API v1 with service account authentication
 */
export async function loadModelConfig(modelId) {
  return loadModelConfigFromFirestore(modelId);
}

/**
 * Load model configuration from Firestore using REST API
 * Uses Firestore REST API v1 with service account authentication
 */
export async function loadModelConfigFromFirestore(modelId) {
  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const projectId = sa.project_id || 'eataly-creative-ai-suite';
    
    // Get access token with cloud-platform scope (works for Firestore)
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();
    
    // Firestore REST API v1 endpoint
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/modelConfigs/${modelId}`;
    
    console.log(`[Config] Loading config for ${modelId} from Firestore...`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[Config] Config not found for ${modelId}, using defaults`);
        // Return default config if not found
        return getDefaultConfig(modelId);
      }
      const errorText = await response.text();
      console.error(`[Config] Firestore error ${response.status}:`, errorText);
      throw new Error(`Firestore error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Parse Firestore document format (REST API v1 format)
    const fields = data.fields || {};
    
    const parseField = (field) => {
      if (!field) return null;
      if (field.stringValue !== undefined) return field.stringValue;
      if (field.integerValue !== undefined) return parseInt(field.integerValue);
      if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
      if (field.booleanValue !== undefined) return field.booleanValue;
      if (field.timestampValue !== undefined) return new Date(field.timestampValue).getTime();
      if (field.mapValue?.fields) return parseMapValue(field.mapValue.fields);
      return null;
    };
    
    const config = {
      modelId: modelId,
      displayName: parseField(fields.displayName) || modelId,
      description: parseField(fields.description) || '',
      systemPrompt: parseField(fields.systemPrompt) || '',
      temperature: parseField(fields.temperature) ?? 0.7,
      topP: parseField(fields.topP) ?? 0.95,
      maxOutputTokens: parseField(fields.maxOutputTokens) ?? 8192,
      outputType: parseField(fields.outputType) || 'TEXT',
      aspectRatio: parseField(fields.aspectRatio) || '1:1',
      sampleCount: parseField(fields.sampleCount) ?? 1,
      safetySettings: parseField(fields.safetySettings) || {},
      enabled: parseField(fields.enabled) !== false,
      updatedAt: parseField(fields.updatedAt) || Date.now()
    };
    
    console.log(`[Config] Loaded config for ${modelId}`);
    return config;
  } catch (error) {
    console.error(`[Config] Error loading config for ${modelId}:`, error);
    // Return default config on error
    return getDefaultConfig(modelId);
  }
}

/**
 * Parse Firestore map value
 */
function parseMapValue(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) result[key] = value.stringValue;
    else if (value.integerValue !== undefined) result[key] = parseInt(value.integerValue);
    else if (value.doubleValue !== undefined) result[key] = parseFloat(value.doubleValue);
    else if (value.booleanValue !== undefined) result[key] = value.booleanValue;
    else if (value.mapValue) result[key] = parseMapValue(value.mapValue.fields);
  }
  return result;
}

/**
 * Get default configuration for a model
 */
function getDefaultConfig(modelId) {
  const isImageModel = modelId.includes('image') || modelId.includes('imagen') || modelId.includes('nanobanana');
  
  return {
    modelId,
    displayName: modelId,
    description: '',
    systemPrompt: '',
    temperature: 0.7,
    topP: 0.95,
    maxOutputTokens: 8192,
    outputType: isImageModel ? 'IMAGE' : 'TEXT',
    aspectRatio: '1:1',
    sampleCount: 1,
    safetySettings: {},
    enabled: true,
    updatedAt: Date.now()
  };
}

/**
 * Save model configuration to Firestore using REST API
 * Uses Firestore REST API v1 with service account authentication
 */
export async function saveModelConfig(modelId, data) {
  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const projectId = sa.project_id || 'eataly-creative-ai-suite';
    
    // Get access token with cloud-platform scope (works for Firestore)
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();
    
    // Firestore REST API v1 endpoint
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/modelConfigs/${modelId}`;
    
    console.log(`[Config] Saving config for ${modelId} to Firestore...`);
    
    // Convert data to Firestore document format
    const fields = {
      modelId: { stringValue: data.modelId || modelId },
      displayName: { stringValue: data.displayName || modelId },
      description: { stringValue: data.description || '' },
      systemPrompt: { stringValue: data.systemPrompt || '' },
      temperature: { doubleValue: data.temperature ?? 0.7 },
      topP: { doubleValue: data.topP ?? 0.95 },
      maxOutputTokens: { integerValue: String(data.maxOutputTokens ?? 8192) },
      outputType: { stringValue: data.outputType || 'TEXT' },
      aspectRatio: { stringValue: data.aspectRatio || '1:1' },
      sampleCount: { integerValue: String(data.sampleCount ?? 1) },
      enabled: { booleanValue: data.enabled !== false },
      updatedAt: { integerValue: String(Date.now()) }
    };
    
    // Add safetySettings if present
    if (data.safetySettings && Object.keys(data.safetySettings).length > 0) {
      fields.safetySettings = { mapValue: { fields: convertToFirestoreMap(data.safetySettings) } };
    }
    
    const requestBody = {
      fields: fields
    };
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Config] Firestore save error ${response.status}:`, errorText);
      throw new Error(`Firestore save error: ${response.status}`);
    }
    
    console.log(`[Config] Saved config for ${modelId}`);
    return true;
  } catch (error) {
    console.error(`[Config] Error saving config for ${modelId}:`, error);
    throw error;
  }
}

/**
 * Convert object to Firestore map format
 */
function convertToFirestoreMap(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        fields[key] = { integerValue: String(value) };
      } else {
        fields[key] = { doubleValue: value };
      }
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (typeof value === 'object' && value !== null) {
      fields[key] = { mapValue: { fields: convertToFirestoreMap(value) } };
    }
  }
  return fields;
}

