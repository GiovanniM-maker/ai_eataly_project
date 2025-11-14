import { GoogleAuth } from "google-auth-library";
import { loadModelConfig } from './helpers/firestoreConfig.js';

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
 * Extract text from response
 */
function extractText(obj) {
  try {
    return obj.candidates[0].content.parts.find(p => p.text)?.text || null;
  } catch {
    return null;
  }
}

/**
 * Call Vertex AI Gemini generateContent (NOT streaming)
 * Supports gemini-2.5-flash-image and gemini-2.5-nano-banana
 */
const callNanobananaAPI = async (prompt, modelConfig = null, modelSettings = null, debugMode = false) => {
  const DEBUG_MODE = process.env.DEBUG_MODE === "true" || debugMode === true;
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ NANOBANANA API CALL =============");
    console.log("[DEBUG] Prompt:", prompt);
  }

  // STEP 1: Generate access token using google-auth-library
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const { token: accessToken } = await client.getAccessToken();

  // STEP 2: Call Vertex AI generateContent (NOT streaming)
  const endpoint = "https://us-central1-aiplatform.googleapis.com/v1/projects/eataly-creative-ai-suite/locations/us-central1/publishers/google/models/gemini-2.5-flash-image:generateContent";
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] Endpoint:", endpoint);
  }

  // Extract modelSettings (override Firestore config if provided)
  const {
    system,
    temperature,
    top_p,
    max_output_tokens,
    output_type
  } = modelSettings || {};

  // Build contents array - system message FIRST, then user message
  const contents = [];
  
  // Add system instruction as FIRST message in contents (priority: modelSettings > Firestore config)
  const systemPrompt = system || modelConfig?.systemPrompt;
  if (systemPrompt && systemPrompt.trim() !== "") {
    contents.push({
      role: 'system',
      parts: [{ text: systemPrompt }]
    });
  }
  
  // Add user message
  contents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  // Build request body
  const body = {
    contents: contents
  };

  // Add generation config (only include defined fields)
  body.generationConfig = {};
  
  if (temperature !== undefined) {
    body.generationConfig.temperature = temperature;
  } else if (modelConfig?.temperature !== undefined) {
    body.generationConfig.temperature = modelConfig.temperature;
  }
  
  if (top_p !== undefined) {
    body.generationConfig.topP = top_p;
  } else if (modelConfig?.topP !== undefined) {
    body.generationConfig.topP = modelConfig.topP;
  }
  
  if (max_output_tokens !== undefined) {
    body.generationConfig.maxOutputTokens = max_output_tokens;
  } else if (modelConfig?.maxOutputTokens !== undefined) {
    body.generationConfig.maxOutputTokens = modelConfig.maxOutputTokens;
  }

  // Add response modalities based on outputType (priority: modelSettings > Firestore config)
  const outputType = output_type || modelConfig?.outputType || 'IMAGE';
  const normalizedOutputType = outputType.toUpperCase();
  
  if (normalizedOutputType === 'TEXT+IMAGE' || normalizedOutputType === 'BOTH') {
    body.generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  } else if (normalizedOutputType === 'TEXT') {
    body.generationConfig.responseModalities = ['TEXT'];
  } else {
    body.generationConfig.responseModalities = ['IMAGE'];
  }

  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ PAYLOAD =============");
    console.log("Final contents payload:", JSON.stringify(contents, null, 2));
    console.log(JSON.stringify(body, null, 2));
    console.log("[DEBUG] Output Type:", normalizedOutputType);
  }

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
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ RAW RESPONSE =========");
    console.log(JSON.stringify(data, null, 2));
  }

  // Extract both text and image based on outputType
  const outputType = output_type || modelConfig?.outputType || 'IMAGE';
  const normalizedOutputType = outputType.toUpperCase();
  const text = extractText(data);
  const imageBase64 = extractImageBase64(data);

  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ EXTRACTED =========");
    console.log("[DEBUG] Output Type:", normalizedOutputType);
    console.log("[DEBUG] Text length:", text?.length || 0);
    console.log("[DEBUG] Image base64 length:", imageBase64?.length || 0);
  }

  if (normalizedOutputType === 'TEXT+IMAGE' || normalizedOutputType === 'BOTH') {
    return { text, imageBase64, rawResponse: DEBUG_MODE ? data : undefined };
  } else if (normalizedOutputType === 'TEXT') {
    if (!text) {
      throw new Error('No text data found in Nanobanana API response');
    }
    return { text, imageBase64: null, rawResponse: DEBUG_MODE ? data : undefined };
  } else {
    // IMAGE mode
    if (!imageBase64) {
      console.error("[API:NANOBANANA] Failed to extract image from response");
      if (DEBUG_MODE) {
        console.error("[DEBUG] Full response structure:", JSON.stringify(data, null, 2));
      }
      throw new Error('No image data found in Nanobanana API response');
    }
    return { text: null, imageBase64, rawResponse: DEBUG_MODE ? data : undefined };
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

    // Allow gemini-2.5-flash-image and gemini-2.5-nano-banana
    const modelToUse = model || "gemini-2.5-flash-image";
    const allowedModels = ['gemini-2.5-flash-image', 'gemini-2.5-nano-banana'];
    
    if (!allowedModels.includes(modelToUse.toLowerCase())) {
      return res.status(400).json({ 
        error: `Wrong endpoint: model "${modelToUse}" is not supported. This endpoint accepts "gemini-2.5-flash-image" or "gemini-2.5-nano-banana". Use /api/chat for Gemini 2.5 Flash or /api/generateImage for Imagen 4.` 
      });
    }

    // Load model configuration from Firestore
    console.log('[API:NANOBANANA] Loading model config from Firestore...');
    const modelConfig = await loadModelConfig(modelToUse);
    
    // Check if model is enabled
    if (!modelConfig.enabled) {
      return res.status(403).json({ 
        error: `Model "${modelToUse}" is currently disabled. Please enable it in Model Settings.` 
      });
    }

    // Determine output type (priority: modelSettings > Firestore config)
    const outputType = modelSettings?.output_type || modelConfig.outputType || 'IMAGE';
    const normalizedOutputType = outputType.toUpperCase();

    // Generate via Vertex AI generateContent (NOT streaming)
    console.log('[API:NANOBANANA] Calling Nanobanana API:', { prompt, model: modelToUse, outputType: normalizedOutputType });
    const result = await callNanobananaAPI(prompt, modelConfig, modelSettings, DEBUG_MODE);

    // Build response
    const responseData = {};
    
    if (normalizedOutputType === 'TEXT+IMAGE' || normalizedOutputType === 'BOTH') {
      responseData.text = result.text;
      responseData.image = result.imageBase64;
      responseData.imageBase64 = result.imageBase64; // Backward compatibility
    } else if (normalizedOutputType === 'TEXT') {
      responseData.text = result.text;
      responseData.reply = result.text; // For compatibility
    } else {
      // IMAGE mode
      if (!result.imageBase64) {
        return res.status(500).json({ error: 'Failed to generate image' });
      }
      responseData.image = result.imageBase64;
      responseData.imageBase64 = result.imageBase64; // Backward compatibility
    }

    if (DEBUG_MODE) {
      responseData.debug = {
        request: {
          model: modelToUse,
          prompt,
          modelSettings,
          modelConfig
        },
        response: result.rawResponse || result
      };
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('[API:NANOBANANA] ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

