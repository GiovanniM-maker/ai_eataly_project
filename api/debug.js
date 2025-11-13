export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    message: "Debug endpoint reached successfully.",
    method: req.method,
    origin: req.headers.origin,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
}

