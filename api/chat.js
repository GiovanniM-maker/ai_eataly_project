import { createSign } from 'crypto';

// CORS allowed origins - Update with your actual production domain
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  // Add your actual Vercel deployment URL here (e.g., 'https://ai-app-vert-chi.vercel.app')
  // Wildcard patterns are not reliable on Vercel, use explicit URLs
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
    console.error('Error getting access token:', error);
    throw error;
  }
};

/**
 * Convert frontend history format to Gemini API format
 */
const convertHistoryToGeminiFormat = (history = []) => {
  return history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));
};

/**
 * Call Google Gemini API
 */
const callGeminiAPI = async (model, message, history = []) => {
  const accessToken = await getAccessToken();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Convert history to Gemini format
  const contents = convertHistoryToGeminiFormat(history);
  
  // Add current message
  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 2048,
    },
  };

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
  return data;
};

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Handle CORS
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  
  // Check if origin is allowed (exact match only, no wildcards)
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    // Log CORS issues for debugging
    console.warn('⚠️ [CORS] Blocked origin:', origin, 'Allowed origins:', ALLOWED_ORIGINS);
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
    const { message, model, history } = req.body;

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "message" field' });
    }

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "model" field' });
    }

    // Validate history format if provided
    if (history && !Array.isArray(history)) {
      return res.status(400).json({ error: 'Invalid "history" field: must be an array' });
    }

    // Validate model
    const validModels = [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-2.0-flash-lite-preview'
    ];

    if (!validModels.includes(model)) {
      return res.status(400).json({ 
        error: `Invalid model. Must be one of: ${validModels.join(', ')}` 
      });
    }

    // Call Gemini API
    let result;
    let modelUsed = model;
    let fallbackApplied = false;

    try {
      result = await callGeminiAPI(model, message, history || []);
    } catch (error) {
      // Fallback to gemini-1.5-flash if model not available
      if (error.message.includes('404') || error.message.includes('400')) {
        console.warn(`Model ${model} not available, falling back to gemini-1.5-flash`);
        modelUsed = 'gemini-1.5-flash';
        fallbackApplied = true;
        result = await callGeminiAPI(modelUsed, message, history || []);
      } else {
        throw error;
      }
    }

    // Extract reply from response
    const reply = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

    return res.status(200).json({
      reply,
      modelUsed,
      fallbackApplied,
    });
  } catch (error) {
    console.error('Error in /api/chat:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

