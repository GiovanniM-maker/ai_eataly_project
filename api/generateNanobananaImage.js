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
function extractImageBase64(obj, debugMode = false) {
  if (debugMode) {
    console.log("[API:NANOBANANA] ============ EXTRACT IMAGE DEBUG =============");
    console.log("[API:NANOBANANA] Full response structure:", JSON.stringify(obj, null, 2));
  }

  // Try 1: inlineData.data (camelCase) - most common
  try {
    const data = obj.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (data && typeof data === 'string' && data.length > 100) {
      if (debugMode) console.log("[API:NANOBANANA] ✅ Found image at: candidates[0].content.parts[0].inlineData.data");
      return data;
    }
  } catch (e) {
    if (debugMode) console.log("[API:NANOBANANA] ❌ Try 1 failed:", e.message);
  }

  // Try 2: inline_data.data (snake_case)
  try {
    const data = obj.candidates?.[0]?.content?.parts?.[0]?.inline_data?.data;
    if (data && typeof data === 'string' && data.length > 100) {
      if (debugMode) console.log("[API:NANOBANANA] ✅ Found image at: candidates[0].content.parts[0].inline_data.data");
      return data;
    }
  } catch (e) {
    if (debugMode) console.log("[API:NANOBANANA] ❌ Try 2 failed:", e.message);
  }

  // Try 3: media.data
  try {
    const data = obj.candidates?.[0]?.content?.parts?.[0]?.media?.data;
    if (data && typeof data === 'string' && data.length > 100) {
      if (debugMode) console.log("[API:NANOBANANA] ✅ Found image at: candidates[0].content.parts[0].media.data");
      return data;
    }
  } catch (e) {
    if (debugMode) console.log("[API:NANOBANANA] ❌ Try 3 failed:", e.message);
  }

  // Try 4: image.base64
  try {
    const data = obj.candidates?.[0]?.content?.parts?.[0]?.image?.base64;
    if (data && typeof data === 'string' && data.length > 100) {
      if (debugMode) console.log("[API:NANOBANANA] ✅ Found image at: candidates[0].content.parts[0].image.base64");
      return data;
    }
  } catch (e) {
    if (debugMode) console.log("[API:NANOBANANA] ❌ Try 4 failed:", e.message);
  }

  // Try 5: Check all parts for inlineData
  try {
    const parts = obj.candidates?.[0]?.content?.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.inlineData?.data) {
        const data = part.inlineData.data;
        if (typeof data === 'string' && data.length > 100) {
          if (debugMode) console.log(`[API:NANOBANANA] ✅ Found image at: candidates[0].content.parts[${i}].inlineData.data`);
          return data;
        }
      }
      if (part.inline_data?.data) {
        const data = part.inline_data.data;
        if (typeof data === 'string' && data.length > 100) {
          if (debugMode) console.log(`[API:NANOBANANA] ✅ Found image at: candidates[0].content.parts[${i}].inline_data.data`);
          return data;
        }
      }
    }
  } catch (e) {
    if (debugMode) console.log("[API:NANOBANANA] ❌ Try 5 (all parts) failed:", e.message);
  }

  // Try 6: deep scan recursive
  if (debugMode) console.log("[API:NANOBANANA] Attempting deep scan...");
  const deepScanResult = deepScan(obj);
  if (deepScanResult) {
    if (debugMode) console.log("[API:NANOBANANA] ✅ Found image via deep scan");
    return deepScanResult;
  }

  if (debugMode) {
    console.log("[API:NANOBANANA] ❌ All extraction methods failed");
    console.log("[API:NANOBANANA] Response keys:", Object.keys(obj));
    if (obj.candidates) {
      console.log("[API:NANOBANANA] Candidates count:", obj.candidates.length);
      if (obj.candidates[0]) {
        console.log("[API:NANOBANANA] Candidate[0] keys:", Object.keys(obj.candidates[0]));
        if (obj.candidates[0].content) {
          console.log("[API:NANOBANANA] Content keys:", Object.keys(obj.candidates[0].content));
          if (obj.candidates[0].content.parts) {
            console.log("[API:NANOBANANA] Parts count:", obj.candidates[0].content.parts.length);
            obj.candidates[0].content.parts.forEach((part, idx) => {
              console.log(`[API:NANOBANANA] Part[${idx}] keys:`, Object.keys(part));
            });
          }
        }
      }
    }
    console.log("[API:NANOBANANA] ============================================");
  }

  return null;
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
const callNanobananaAPI = async (prompt, modelConfig = null, modelSettings = null, debugMode = false, attachments = []) => {
  const DEBUG_MODE = process.env.DEBUG_MODE === "true" || debugMode === true;
  
  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ NANOBANANA API CALL =============");
    console.log("[DEBUG] Prompt:", prompt);
    console.log("[API/NANOBANANA] Attachments received:", attachments);
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

  // Get system instruction (priority: modelSettings > Firestore config)
  const systemPrompt = system || modelConfig?.systemPrompt;
  
  // Build parts array - start with text prompt
  const parts = [];
  
  // Add text prompt (with system instruction prepended as plain text, NO XML)
  let promptText = prompt;
  if (systemPrompt && systemPrompt.trim() !== "") {
    promptText = `${systemPrompt}\n\n${prompt}`;
  }
  
  if (promptText.trim()) {
    parts.push({ text: promptText });
  }
  
  // Add image attachments as inline_data
  if (attachments && attachments.length > 0) {
    attachments.forEach(att => {
      parts.push({
        inline_data: {
          mime_type: att.mimeType || 'image/jpeg',
          data: att.base64
        }
      });
    });
  }
  
  console.log("[API/NANOBANANA] Parts built for model:", JSON.stringify(parts, null, 2));

  // Build contents array
  const contents = [
    {
      role: "user",
      parts: parts
    }
  ];

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
  // Determine outputType once (with fallback)
  const outputType = output_type ?? modelConfig?.outputType ?? 'image';
  const normalizedOutputType = outputType.toLowerCase();
  
  // Map outputType to responseModalities
  if (normalizedOutputType === 'image_and_text') {
    body.generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  } else {
    // Default to IMAGE only
    body.generationConfig.responseModalities = ['IMAGE'];
  }
  
  // For nanobanana: maxTokens ONLY if outputType is "image_and_text"
  if (normalizedOutputType === 'image_and_text') {
    if (max_output_tokens !== undefined) {
      body.generationConfig.maxOutputTokens = max_output_tokens;
    } else if (modelConfig?.maxOutputTokens !== undefined) {
      body.generationConfig.maxOutputTokens = modelConfig.maxOutputTokens;
    }
  }
  // If outputType is "image", do NOT include maxTokens

  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ PAYLOAD =============");
    console.log("[DEBUG GEMINI PAYLOAD]", JSON.stringify(contents, null, 2));
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

  // Extract both text and image based on outputType (reuse the same variable declared above)
  const text = extractText(data);
  const imageBase64 = extractImageBase64(data, DEBUG_MODE);

  if (DEBUG_MODE) {
    console.log("[DEBUG] ============ EXTRACTED =========");
    console.log("[DEBUG] Output Type:", normalizedOutputType);
    console.log("[DEBUG] Text length:", text?.length || 0);
    console.log("[DEBUG] Image base64 length:", imageBase64?.length || 0);
  }

  // Handle response based on outputType
  if (normalizedOutputType === 'image_and_text') {
    return { text, imageBase64, rawResponse: DEBUG_MODE ? data : undefined };
  } else {
    // IMAGE mode (default)
    if (!imageBase64) {
      console.error("[API:NANOBANANA] ========================================");
      console.error("[API:NANOBANANA] ❌ FAILED TO EXTRACT IMAGE");
      console.error("[API:NANOBANANA] Response status:", response.status);
      console.error("[API:NANOBANANA] Response structure:", JSON.stringify(data, null, 2));
      console.error("[API:NANOBANANA] Candidates:", data.candidates?.length || 0);
      if (data.candidates?.[0]) {
        console.error("[API:NANOBANANA] Candidate[0] structure:", JSON.stringify(data.candidates[0], null, 2));
      }
      console.error("[API:NANOBANANA] ========================================");
      throw new Error('No image data found in Nanobanana API response. Check logs for response structure.');
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
    const { prompt, model, modelSettings, attachments, debugMode: requestDebugMode } = req.body;
    const DEBUG_MODE = process.env.DEBUG_MODE === "true" || requestDebugMode === true;
    
    if (DEBUG_MODE) {
      console.log("[DEBUG] ============ INCOMING =============");
      console.log(JSON.stringify(req.body, null, 2));
    }

    // Validate required fields
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "prompt" field' });
    }

    // ONLY allow gemini-2.5-flash-image
    const modelToUse = model || "gemini-2.5-flash-image";
    
    if (modelToUse.toLowerCase() !== 'gemini-2.5-flash-image') {
      return res.status(400).json({ 
        error: `Wrong endpoint: model "${modelToUse}" is not supported. This endpoint only accepts "gemini-2.5-flash-image". Use /api/chat for gemini-2.5-flash.` 
      });
    }

    // Extract attachments
    const imageAttachments = attachments || [];
    console.log("[API/NANOBANANA] Attachments received:", imageAttachments);

    // Load model configuration from Firestore
    console.log('[API:NANOBANANA] Loading model config from Firestore...');
    const modelConfig = await loadModelConfig(modelToUse);
    
    // Check if model is enabled
    if (!modelConfig.enabled) {
      return res.status(403).json({ 
        error: `Model "${modelToUse}" is currently disabled. Please enable it in Model Settings.` 
      });
    }

    // Determine output type (priority: modelSettings > Firestore config, with fallback)
    const outputType = modelSettings?.output_type ?? modelConfig?.outputType ?? 'image';
    const normalizedOutputType = outputType.toLowerCase();
    
    // Log payload building
    console.log(`[MODEL] Payload built for ${modelToUse}`);
    console.log(`[MODEL] Output type: ${normalizedOutputType}`);
    if (DEBUG_MODE) {
      console.log(`[MODEL] Applying merged config:`, modelSettings);
    }

    // Generate via Vertex AI generateContent (NOT streaming)
    console.log('[API:NANOBANANA] Calling Nanobanana API:', { prompt, model: modelToUse, outputType: normalizedOutputType, attachmentsCount: imageAttachments.length });
    const result = await callNanobananaAPI(prompt, modelConfig, modelSettings, DEBUG_MODE, imageAttachments);

    // Build response
    const responseData = {};
    
    if (normalizedOutputType === 'image_and_text') {
      responseData.text = result.text;
      responseData.image = result.imageBase64;
      responseData.imageBase64 = result.imageBase64; // Backward compatibility
    } else {
      // IMAGE mode (default)
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

