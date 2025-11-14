// CORS allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://ai-eataly-project.vercel.app'
];

import formidable from 'formidable-serverless';
import FormData from 'form-data';
import fs from 'fs';

/**
 * Main handler for image upload to PostImages.org
 * NO API KEY REQUIRED
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
    console.log('[UploadImage] Incoming request', {
      method: req.method,
      origin: req.headers.origin,
      url: req.url,
      contentType: req.headers['content-type']
    });

    // Parse multipart/form-data
    // For Vercel serverless, we need to handle the raw body
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB max
      keepExtensions: true,
    });

    // Parse the request (formidable-serverless works with Vercel)
    const [fields, files] = await form.parse(req);
    
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!uploadedFile) {
      console.error('[UploadImage] No file in request');
      return res.status(400).json({ error: 'Missing file in request' });
    }

    console.log('[UploadImage] File received:', {
      name: uploadedFile.originalFilename || uploadedFile.newFilename,
      size: uploadedFile.size,
      type: uploadedFile.mimetype,
      path: uploadedFile.filepath
    });

    // Read file from temporary path
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    
    // Create FormData for PostImages.org
    const formData = new FormData();
    formData.append('upload', fileBuffer, {
      filename: uploadedFile.originalFilename || 'image.jpg',
      contentType: uploadedFile.mimetype || 'image/jpeg'
    });

    console.log('[UploadImage] Uploading to PostImages.org...');

    // POST to PostImages.org
    const uploadRes = await fetch('https://postimages.org/json/rr', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    // Clean up temporary file
    try {
      fs.unlinkSync(uploadedFile.filepath);
    } catch (cleanupError) {
      console.warn('[UploadImage] Failed to cleanup temp file:', cleanupError);
    }

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.error('[UploadImage] PostImages.org API error:', uploadRes.status, errorText);
      throw new Error(`PostImages.org upload failed: ${uploadRes.status} ${errorText}`);
    }

    const data = await uploadRes.json();
    const url = data?.url;

    if (!url) {
      console.error('[UploadImage] No URL in PostImages.org response:', data);
      throw new Error('No URL returned from PostImages.org');
    }

    console.log('[UploadImage] Upload successful, URL:', url);

    return res.status(200).json({ url });
  } catch (err) {
    console.error('[UploadImage] ERROR:', err);
    return res.status(500).json({ 
      error: err.message || 'Impossibile caricare l\'immagine',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}

// Note: Vercel serverless functions automatically handle body parsing
// formidable-serverless works directly with the request stream
