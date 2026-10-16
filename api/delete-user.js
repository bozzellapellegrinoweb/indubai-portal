import { SUPABASE_URL, SERVICE_KEY, requireRole } from './_auth.js';


export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  // Token verificato da Supabase, non solo decodificato.
  const auth = await requireRole(req, 'admin');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { userId } = req.body;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });

  if (!r.ok) return res.status(400).json({ error: await r.text() });
  return res.status(200).json({ ok: true });
}
