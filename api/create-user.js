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

  // Decode JWT to get user ID
  const decoded = decodeJWT(token);
  const userId = decoded?.sub;
  if (!userId) return res.status(401).json({ error: 'Invalid token' });

  // Check admin role using service key
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const profiles = await profileRes.json();
  const userRole = profiles?.[0]?.role;

  if (userRole !== 'admin') {
    return res.status(403).json({ error: `Admin only (your role: ${userRole || 'not found'})` });
  }

  const { email, password, full_name, role } = req.body;
  if (!email || !password || !full_name) return res.status(400).json({ error: 'Missing fields' });

  // Create auth user
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    })
  });

  const created = await createRes.json();
  if (!created.id) {
    return res.status(400).json({ error: created.message || created.msg || JSON.stringify(created) });
  }

  // Wait for trigger then update role
  await new Promise(r => setTimeout(r, 1000));
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${created.id}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ role: role || 'junior', full_name })
  });

  return res.status(200).json({ id: created.id, email, full_name, role });
}
