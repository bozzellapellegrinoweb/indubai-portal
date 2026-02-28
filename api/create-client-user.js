const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

const SB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, client_id, company_name } = req.body;
  if (!email || !password || !client_id) return res.status(400).json({ error: 'Missing fields' });

  // 1. Create auth user (email_confirm: true = no email confirmation needed)
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: company_name || email, role: 'client' }
    })
  });

  const created = await createRes.json();
  if (!created.id) {
    return res.status(400).json({ error: created.message || created.msg || created.error_description, raw: created, status: createRes.status });
  }

  // 2. Wait for trigger to fire (creates profile row)
  await new Promise(r => setTimeout(r, 1500));

  // 3. Force profile role=client with PATCH (overrides trigger default)
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${created.id}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ full_name: company_name || email, role: 'client' })
  });

  // 4. Insert into client_users
  const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/client_users`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: created.id, client_id })
  });

  if (!linkRes.ok) {
    const linkErr = await linkRes.json();
    // Rollback: delete user
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: SB_HEADERS });
    return res.status(400).json({ error: linkErr.message || 'Errore collegamento cliente' });
  }

  return res.status(200).json({ id: created.id });
}
