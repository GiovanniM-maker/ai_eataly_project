import { GoogleAuth } from "google-auth-library";

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://ai-eataly-project.vercel.app'
];

/**
 * Deep scan recursive function to find base64 image data
 */
function deepScan(o) {
  if (!o || typeof o !== "object") return null;

  for (const k of Object.keys(o)) {
    const v = o[k];

    if (typeof v === "string" && /^[A-Za-z0-9+/=]+$/.test(v) && v.length > 500) {
      return v;
    }

    const sub = deepScan(v);
    if (sub) return sub;
  }
  return null;
}

/**
 * Robust extractor for base64 image from Vertex AI response
 */
function extractImageBase64(obj) {
  // Try 1: inlineData.data (camelCase)
  try {
    return obj.candidates[0].content.parts[0].inlineData.data;
  } catch {}

  // Try 2: inline_data.data (snake_case)
  try {
    return obj.candidates[0].content.parts[0].inline_data.data;
  } catch {}

  // Try 3: media.data
  try {
    return obj.candidates[0].content.parts[0].media.data;
  } catch {}

  // Try 4: image.base64
  try {
    return obj.candidates[0].content.parts[0].image.base64;
  } catch {}

  // Try 5: deep scan recursive
  return deepScan(obj);
}

/**
 * Call Vertex AI Gemini generateContent (NOT streaming)
 * ONLY for gemini-2.5-flash-image (Nanobanana)
 */
const callNanobananaAPI = async (prompt) => {
  console.log("[API:NANOBANANA] ========================================");
  console.log("[API:NANOBANANA] NANOBANANA IMAGE GENERATION REQUEST");
  console.log("[API:NANOBANANA] Prompt:", prompt);

  // STEP 1: Generate access token using google-auth-library
  console.log("[API:NANOBANANA] Generating access token...");
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const { token: accessToken } = await client.getAccessToken();
  console.log("[API:NANOBANANA] Access token obtained");

  // STEP 2: Call Vertex AI generateContent (NOT streaming)
  const endpoint = "https://us-central1-aiplatform.googleapis.com/v1/projects/eataly-creative-ai-suite/locations/us-central1/publishers/google/models/gemini-2.5-flash-image:generateContent";
  
  console.log("[API:NANOBANANA] Endpoint:", endpoint);

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ]
  };

  console.log("[API:NANOBANANA] Request Body:", JSON.stringify(body, null, 2));
  console.log("[API:NANOBANANA] NOTE: NO temperature, top_p, response_modalities, generationConfig");

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[API:NANOBANANA] ========================================");
    console.error("[API:NANOBANANA] NANOBANANA API ERROR");
    console.error("[API:NANOBANANA] Status:", response.status);
    console.error("[API:NANOBANANA] Status Text:", response.statusText);
    console.error("[API:NANOBANANA] Raw Error Response:", errorText);
    console.error("[API:NANOBANANA] ========================================");
    throw new Error(`Nanobanana API error: ${response.status} ${errorText}`);
  }

  // STEP 3: Extract image (NO STREAMING)
  const data = await response.json();
  console.log("[API:NANOBANANA] Response received");
  console.log("[API:NANOBANANA] Response keys:", Object.keys(data));
  
  // Log raw response for debugging
  console.log("[API:NANOBANANA] ========================================");
  console.log("[API:NANOBANANA] RAW RESPONSE (full):");
  console.log(JSON.stringify(data, null, 2));
  console.log("[API:NANOBANANA] ========================================");

  const imageBase64 = extractImageBase64(data);

  if (!imageBase64) {
    console.error("[API:NANOBANANA] Failed to extract image from response");
    console.error("[API:NANOBANANA] Full response structure:", JSON.stringify(data, null, 2));
    throw new Error('No image data found in Nanobanana API response');
  }

    console.log("[API:NANOBANANA] Image extracted successfully");
    console.log("[API:NANOBANANA] Final base64 length:", imageBase64.length, "characters");
    console.log("[API:NANOBANANA] ========================================");

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
    console.log('[API:NANOBANANA] Incoming Nanobanana image generation request', {
      method: req.method,
      origin: req.headers.origin,
      url: req.url
    });

    const { prompt, model } = req.body;

    // Validate required fields
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "prompt" field' });
    }

    // ONLY allow gemini-2.5-flash-image
    const modelToUse = model || "gemini-2.5-flash-image";
    
    if (modelToUse.toLowerCase() !== 'gemini-2.5-flash-image') {
      return res.status(400).json({ 
        error: `Wrong endpoint: model "${modelToUse}" is not supported. This endpoint only accepts "gemini-2.5-flash-image" (Nanobanana). Use /api/chat for Gemini 2.5 Flash or /api/generateImage for Imagen 4.` 
      });
    }

    // Generate image via Vertex AI generateContent (NOT streaming)
    console.log('[API:NANOBANANA] Calling Nanobanana API:', { prompt, model: modelToUse });
    const imageBase64 = await callNanobananaAPI(prompt);

    if (!imageBase64) {
      return res.status(500).json({ error: 'Failed to generate image' });
    }

    return res.status(200).json({
      image: imageBase64,
      imageBase64: imageBase64 // Backward compatibility
    });
  } catch (error) {
    console.error('[API:NANOBANANA] ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

