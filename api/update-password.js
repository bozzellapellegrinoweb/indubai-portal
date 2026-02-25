const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

function decodeJWT(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const decoded = decodeJWT(token);
  const callerId = decoded?.sub;
  if (!callerId) return res.status(401).json({ error: 'Invalid token' });

  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Missing fields' });

  // Allow if changing own password, or if admin
  if (userId !== callerId) {
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=role`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const profiles = await profileRes.json();
    if (profiles?.[0]?.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  }

  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });

  if (!r.ok) return res.status(400).json({ error: await r.text() });
  return res.status(200).json({ ok: true });
}
