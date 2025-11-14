import { createSign } from 'crypto';
import { loadModelConfig } from './helpers/firestoreConfig.js';

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://ai-eataly-project.vercel.app'
];

// Cache for access token
let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

/**
 * Load Service Account from environment variable
 */
const loadServiceAccount = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable');
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON: must be valid JSON');
  }
};

/**
 * Generate JWT for OAuth2 authentication
 */
const generateJWT = (serviceAccount) => {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/generative-language',
    aud: serviceAccount.token_uri,
    exp: nowInSeconds + 3600,
    iat: nowInSeconds,
  };

  const base64UrlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;

  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const sign = createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${unsignedToken}.${signature}`;
};

/**
 * Get OAuth2 access token (cached for 1 hour)
 */
const getAccessToken = async () => {
  const now = Date.now();
  
  // Return cached token if still valid (refresh 60 seconds before expiry)
  if (cachedAccessToken && now < cachedAccessTokenExpiry - 60000) {
    return cachedAccessToken;
  }

  try {
    const serviceAccount = loadServiceAccount();
    const jwt = generateJWT(serviceAccount);

    const tokenResponse = await fetch(serviceAccount.token_uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token request failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    cachedAccessToken = tokenData.access_token;
    cachedAccessTokenExpiry = now + (tokenData.expires_in * 1000);

    return cachedAccessToken;
  } catch (error) {
    console.error('[API] Error getting access token:', error);
    throw error;
  }
};

/**
 * Call Google Gemini API (REST API v1)
 * ONLY for gemini-2.5-flash (text model)
 */
const callGeminiAPI = async (model, message, modelConfig = null, modelSettings = null, debugMode = false) => {
  const accessToken = await getAccessToken();
  
  // Gemini 2.x models use v1 API
  const apiVersion = "v1";
  const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent`;
  
  const DEBUG_MODE = process.env.DEBUG_MODE === "true" || debugMode === true;
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ GEMINI API CALL =============");
    console.log("[DEBUG] Model:", model);
    console.log("[DEBUG] Endpoint:", endpoint);
  }

  // Extract modelSettings (override Firestore config if provided)
  const {
    system,
    temperature,
    top_p,
    max_output_tokens
  } = modelSettings || {};

  // Build request body with config
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: message }]
      }
    ]
  };

  // Add system instruction (priority: modelSettings > Firestore config)
  const systemPrompt = system || modelConfig?.systemPrompt;
  if (systemPrompt) {
    requestBody.systemInstruction = {
      role: 'system',
      parts: [{ text: systemPrompt }]
    };
  }

  // Add generation config (only include defined fields)
  requestBody.generationConfig = {};
  if (temperature !== undefined) {
    requestBody.generationConfig.temperature = temperature;
  } else if (modelConfig?.temperature !== undefined) {
    requestBody.generationConfig.temperature = modelConfig.temperature;
  }
  
  if (top_p !== undefined) {
    requestBody.generationConfig.topP = top_p;
  } else if (modelConfig?.topP !== undefined) {
    requestBody.generationConfig.topP = modelConfig.topP;
  }
  
  if (max_output_tokens !== undefined) {
    requestBody.generationConfig.maxOutputTokens = max_output_tokens;
  } else if (modelConfig?.maxOutputTokens !== undefined) {
    requestBody.generationConfig.maxOutputTokens = modelConfig.maxOutputTokens;
  }

  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ PAYLOAD =============");
    console.log(JSON.stringify(requestBody, null, 2));
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ RAW RESPONSE =========");
    console.log(JSON.stringify(data, null, 2));
  }
  
  console.log("[API] Gemini response OK");
  return data;
};

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Handle CORS
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, model: requestedModel, modelSettings, debugMode: requestDebugMode } = req.body;
    const DEBUG_MODE = process.env.DEBUG_MODE === "true" || requestDebugMode === true;
    
    if (DEBUG_MODE) {
      console.log("[DEBUG] ============ INCOMING =============");
      console.log(JSON.stringify(req.body, null, 2));
    }

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "message" field' });
    }

    // ONLY allow gemini-2.5-flash (text model)
    const model = requestedModel || "gemini-2.5-flash";
    
    if (model.toLowerCase() !== 'gemini-2.5-flash') {
      return res.status(400).json({ 
        error: `Wrong endpoint: model "${model}" is not supported. This endpoint only accepts "gemini-2.5-flash" (text model). Use /api/generateImage for Imagen 4 or /api/nanobananaImage for Nanobanana.` 
      });
    }

    // Load model configuration from Firestore
    console.log('[API] Loading model config from Firestore...');
    const modelConfig = await loadModelConfig(model);
    
    // Check if model is enabled
    if (!modelConfig.enabled) {
      return res.status(403).json({ 
        error: `Model "${model}" is currently disabled. Please enable it in Model Settings.` 
      });
    }

    // Call Gemini API with config and modelSettings
    console.log('[API] Calling Gemini API:', { model, messageLength: message.length });
    const result = await callGeminiAPI(model, message, modelConfig, modelSettings, DEBUG_MODE);

    // Extract reply from response
    const reply = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

    if (DEBUG_MODE) {
      console.log("[DEBUG] ============ EXTRACTED TEXT =========");
      console.log(reply);
    }

    const responseData = {
      reply,
    };

    if (DEBUG_MODE) {
      responseData.debug = {
        request: {
          model,
          message,
          modelSettings,
          modelConfig
        },
        response: result
      };
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('[API] ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
