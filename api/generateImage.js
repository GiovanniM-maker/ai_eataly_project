import { GoogleAuth } from "google-auth-library";
import { loadModelConfig } from './helpers/firestoreConfig.js';

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://ai-eataly-project.vercel.app'
];

/**
 * Call Vertex AI Imagen predict endpoint
 * ONLY for imagen-4
 */
const callImagenAPI = async (prompt, modelConfig = null) => {
  console.log("[API:IMAGEN] ========================================");
  console.log("[API:IMAGEN] IMAGEN 4 IMAGE GENERATION REQUEST");
  console.log("[API:IMAGEN] Prompt:", prompt);

  try {
    // Generate access token using google-auth-library
    console.log("[API:IMAGEN] Generating access token...");
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();
    console.log("[API:IMAGEN] Access token obtained");

    // Endpoint corretto: imagen-4:predict
    const endpoint = "https://us-central1-aiplatform.googleapis.com/v1/projects/eataly-creative-ai-suite/locations/us-central1/publishers/google/models/imagen-4:predict";
    
    console.log("[API:IMAGEN] Endpoint:", endpoint);

    // Request body: { instances: [{ prompt }], parameters: { sampleCount, aspectRatio } }
    const requestBody = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: modelConfig?.sampleCount ?? 1,
        aspectRatio: modelConfig?.aspectRatio || '1:1'
      }
    };

    console.log("[API:IMAGEN] Request Body:", JSON.stringify(requestBody, null, 2));
    console.log("[API:IMAGEN] NOTE: Using predict endpoint with instances/parameters format");

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
      console.error("[API:IMAGEN] ========================================");
      console.error("[API:IMAGEN] IMAGEN API ERROR");
      console.error("[API:IMAGEN] Status:", response.status);
      console.error("[API:IMAGEN] Status Text:", response.statusText);
      console.error("[API:IMAGEN] Raw Error Response:", errorText);
      console.error("[API:IMAGEN] ========================================");
      throw new Error(`Imagen API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log("[API:IMAGEN] Imagen response received");
    console.log("[API:IMAGEN] Response keys:", Object.keys(data));
    
    // Log raw response for debugging
    console.log("[API:IMAGEN] ========================================");
    console.log("[API:IMAGEN] RAW RESPONSE (full):");
    console.log(JSON.stringify(data, null, 2));
    console.log("[API:IMAGEN] ========================================");
    
    // Extract base64 image from response
    // Try predictions[0].imageBase64 first, then bytesBase64Encoded
    let imageBase64 = null;
    
    if (data.predictions?.[0]?.imageBase64) {
      imageBase64 = data.predictions[0].imageBase64;
      console.log("[API:IMAGEN] Extracted image from predictions[0].imageBase64");
    } else if (data.predictions?.[0]?.bytesBase64Encoded) {
      imageBase64 = data.predictions[0].bytesBase64Encoded;
      console.log("[API:IMAGEN] Extracted image from predictions[0].bytesBase64Encoded");
    } else {
      console.error("[API:IMAGEN] Imagen response structure:", JSON.stringify(data, null, 2));
      throw new Error('Imagen response missing image data in predictions[0].imageBase64 or predictions[0].bytesBase64Encoded');
    }
    
    if (!imageBase64) {
      throw new Error('No image data found in Imagen API response');
    }
    
    console.log("[API:IMAGEN] Image extracted successfully");
    console.log("[API:IMAGEN] Final base64 length:", imageBase64.length, "characters");
    console.log("[API:IMAGEN] ========================================");
    
    return imageBase64;
  } catch (error) {
    console.error("[API:IMAGEN] ========================================");
    console.error("[API:IMAGEN] ERROR in callImagenAPI:");
    console.error("[API:IMAGEN] Error message:", error.message);
    console.error("[API:IMAGEN] Error stack:", error.stack);
    console.error("[API:IMAGEN] ========================================");
    throw error;
  }
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
    console.log('[API:IMAGEN] Incoming image generation request', {
      method: req.method,
      origin: req.headers.origin,
      url: req.url
    });

    const { prompt, model } = req.body;

    // Validate required fields
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "prompt" field' });
    }

    // ONLY allow imagen-4
    const modelToUse = model || "imagen-4";
    
    if (modelToUse.toLowerCase() !== 'imagen-4') {
      return res.status(400).json({ 
        error: `Wrong endpoint: model "${modelToUse}" is not supported. This endpoint only accepts "imagen-4". Use /api/chat for Gemini 2.5 Flash or /api/generateNanobananaImage for Nanobanana.` 
      });
    }

    // Load model configuration from Firestore
    console.log('[API:IMAGEN] Loading model config from Firestore...');
    const modelConfig = await loadModelConfig(modelToUse);
    
    // Check if model is enabled
    if (!modelConfig.enabled) {
      return res.status(403).json({ 
        error: `Model "${modelToUse}" is currently disabled. Please enable it in Model Settings.` 
      });
    }

    // Generate image via Vertex AI
    console.log('[API:IMAGEN] Calling Imagen API:', { prompt, model: modelToUse });
    const imageBase64 = await callImagenAPI(prompt, modelConfig);

    if (!imageBase64) {
      return res.status(500).json({ error: 'Failed to generate image' });
    }

    return res.status(200).json({
      image: imageBase64,
      imageBase64: imageBase64 // Backward compatibility
    });
  } catch (error) {
    console.error('[API:IMAGEN] ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
