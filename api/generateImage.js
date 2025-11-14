import { createSign } from 'crypto';

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
 * Call Google Gemini/Imagen API to generate image
 */
const callGeminiImageAPI = async (prompt, model = "gemini-2.5-flash", size = "512x512") => {
  const accessToken = await getAccessToken();
  
  // Determine API version and endpoint based on model
  let apiVersion = "v1";
  let endpoint;
  
  // Check if it's an Imagen model
  if (model && model.startsWith("imagen-")) {
    // Imagen models use a different endpoint
    // Note: Adjust endpoint based on actual Imagen API structure
    endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent`;
  } else {
    // Gemini models
    endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent`;
  }
  
  console.log("[API] Generating image with prompt:", prompt);
  console.log("[API] Using model:", model);
  console.log("[API] Endpoint:", endpoint);

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `Generate an image: ${prompt}` }]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: "image/png"
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
  console.log("[API] Image generation response received");
  
  // Extract base64 image from response
  // Note: Gemini may return image in different formats, adjust based on actual API response
  const imageBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || 
                      data.candidates?.[0]?.content?.parts?.[0]?.text || 
                      null;
  
  return imageBase64;
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
    console.log('[API] Incoming image generation request', {
      method: req.method,
      origin: req.headers.origin,
      url: req.url
    });

    const { prompt, model, size } = req.body;

    // Validate required fields
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "prompt" field' });
    }

    // Use provided model or default
    const modelToUse = model || "gemini-2.5-flash";

    // Generate image
    console.log('[API] Calling Image API:', { prompt, model: modelToUse, size });
    const imageBase64 = await callGeminiImageAPI(prompt, modelToUse, size);

    if (!imageBase64) {
      return res.status(500).json({ error: 'Failed to generate image' });
    }

    return res.status(200).json({
      imageBase64,
    });
  } catch (error) {
    console.error('[API] ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

