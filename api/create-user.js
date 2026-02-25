const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify caller is authenticated admin
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Verify the token is valid and user is admin
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!meRes.ok) return res.status(401).json({ error: 'Invalid token' });
  const me = await meRes.json();

  // Check admin role in profiles
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const profiles = await profileRes.json();
  if (profiles?.[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { email, password, full_name, role } = req.body;
  if (!email || !password || !full_name) return res.status(400).json({ error: 'Missing fields' });

  // 1. Create auth user
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

  // 2. Wait for trigger then update role
  await new Promise(r => setTimeout(r, 800));
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
