import { SUPABASE_URL, SERVICE_KEY, requireRole } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Prima non c'era nessun controllo: chiunque poteva creare un utente admin.
  const auth = await requireRole(req, 'admin');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

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
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } })
  });

  const created = await createRes.json();
  const rawError = created.message || created.msg || created.error_description || JSON.stringify(created);

  if (!created.id) {
    return res.status(400).json({ error: rawError, raw: created });
  }

  // Upsert profile (handles both: trigger created it as 'staff', or trigger failed)
  await new Promise(r => setTimeout(r, 1000));
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ id: created.id, full_name, role: role || 'junior' })
  });

  return res.status(200).json({ id: created.id });
}
