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
const callImagenAPI = async (prompt, modelConfig = null, modelSettings = null, debugMode = false) => {
  const DEBUG_MODE = process.env.DEBUG_MODE === "true" || debugMode === true;
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ IMAGEN API CALL =============");
    console.log("[DEBUG] Prompt:", prompt);
  }

  try {
    // Generate access token using google-auth-library
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();

    // Endpoint corretto: imagen-4:predict
    const endpoint = "https://us-central1-aiplatform.googleapis.com/v1/projects/eataly-creative-ai-suite/locations/us-central1/publishers/google/models/imagen-4:predict";
    
    if (DEBUG_MODE) {
      console.log("[DEBUG] Endpoint:", endpoint);
    }

    // Extract modelSettings (override Firestore config if provided)
    const {
      aspect_ratio
    } = modelSettings || {};

    // Request body: { instances: [{ prompt }], parameters: { sampleCount, aspectRatio } }
    const requestBody = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: modelConfig?.sampleCount ?? 1,
        aspectRatio: aspect_ratio || modelConfig?.aspectRatio || '1:1'
      }
    };

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
      console.error("[API:IMAGEN] ========================================");
      console.error("[API:IMAGEN] IMAGEN API ERROR");
      console.error("[API:IMAGEN] Status:", response.status);
      console.error("[API:IMAGEN] Status Text:", response.statusText);
      console.error("[API:IMAGEN] Raw Error Response:", errorText);
      console.error("[API:IMAGEN] ========================================");
      throw new Error(`Imagen API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (DEBUG_MODE) {
      console.log("[DEBUG] ============ RAW RESPONSE =========");
      console.log(JSON.stringify(data, null, 2));
    }
    
    // Extract base64 image from response
    // Try predictions[0].imageBase64 first, then bytesBase64Encoded
    let imageBase64 = null;
    
    if (data.predictions?.[0]?.imageBase64) {
      imageBase64 = data.predictions[0].imageBase64;
    } else if (data.predictions?.[0]?.bytesBase64Encoded) {
      imageBase64 = data.predictions[0].bytesBase64Encoded;
    } else {
      if (DEBUG_MODE) {
        console.error("[DEBUG] Imagen response structure:", JSON.stringify(data, null, 2));
      }
      throw new Error('Imagen response missing image data in predictions[0].imageBase64 or predictions[0].bytesBase64Encoded');
    }
    
    if (!imageBase64) {
      throw new Error('No image data found in Imagen API response');
    }
    
    if (DEBUG_MODE) {
      console.log("[DEBUG] ============ EXTRACTED IMAGE =========");
      console.log("[DEBUG] Base64 length:", imageBase64.length, "characters");
    }
    
    return { imageBase64, rawResponse: DEBUG_MODE ? data : undefined };
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
    const { prompt, model, modelSettings, debugMode: requestDebugMode } = req.body;
    const DEBUG_MODE = process.env.DEBUG_MODE === "true" || requestDebugMode === true;
    
    if (DEBUG_MODE) {
      console.log("[DEBUG] ============ INCOMING =============");
      console.log(JSON.stringify(req.body, null, 2));
    }

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
    const result = await callImagenAPI(prompt, modelConfig, modelSettings, DEBUG_MODE);

    if (!result.imageBase64) {
      return res.status(500).json({ error: 'Failed to generate image' });
    }

    const responseData = {
      image: result.imageBase64,
      imageBase64: result.imageBase64 // Backward compatibility
    };

    if (DEBUG_MODE) {
      responseData.debug = {
        request: {
          model: modelToUse,
          prompt,
          modelSettings,
          modelConfig
        },
        response: result.rawResponse
      };
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('[API:IMAGEN] ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
