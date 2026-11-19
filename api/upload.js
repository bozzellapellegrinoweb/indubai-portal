/**
 * /api/upload
 * Proxy per upload file su Supabase Storage (bucket task-attachments).
 * Riceve il file come base64 nel body JSON, lo carica con service key.
 */

const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

function decodeJWT(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
}

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const decoded = decodeJWT(token);
  if (!decoded?.sub) return res.status(401).json({ error: 'Invalid token' });

  const { fileName, fileBase64, contentType } = req.body;
  if (!fileName || !fileBase64) return res.status(400).json({ error: 'fileName and fileBase64 required' });

  try {
    // Decode base64
    const buffer = Buffer.from(fileBase64, 'base64');

    // Build unique path: userId/timestamp_filename
    const ts = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${decoded.sub}/${ts}_${safeName}`;

    // Upload to Supabase Storage
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/task-attachments/${path}`;
    const r = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buffer,
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[upload] Storage error:', err);
      return res.status(500).json({ error: 'Upload failed', details: err });
    }

    // Public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/task-attachments/${path}`;

    return res.status(200).json({ ok: true, url: publicUrl, path, fileName: safeName });
  } catch (e) {
    console.error('[upload] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
