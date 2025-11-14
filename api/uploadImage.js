// CORS allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://ai-eataly-project.vercel.app'
];

/**
 * Main handler for image upload to ImgBB
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
      url: req.url
    });

    const { base64 } = req.body;

    if (!base64) {
      return res.status(400).json({ error: 'Missing base64' });
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      console.error('[UploadImage] Missing IMGBB_API_KEY environment variable');
      return res.status(500).json({ error: 'Missing IMGBB_API_KEY' });
    }

    // Clean base64 string (remove data URL prefix if present)
    const cleanBase64 = base64.replace(/^data:image\/[a-z]+;base64,/, '');

    console.log('[UploadImage] Uploading to ImgBB...');

    const uploadRes = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        key: apiKey,
        image: cleanBase64
      })
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.error('[UploadImage] ImgBB API error:', uploadRes.status, errorText);
      throw new Error(`ImgBB upload failed: ${uploadRes.status} ${errorText}`);
    }

    const data = await uploadRes.json();
    const url = data?.data?.url;

    if (!url) {
      console.error('[UploadImage] No URL in ImgBB response:', data);
      throw new Error('No URL returned from ImgBB');
    }

    console.log('[UploadImage] Upload successful, URL:', url);

    return res.status(200).json({ url });
  } catch (err) {
    console.error('[UploadImage] ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
}

