import { SUPABASE_URL, SERVICE_KEY, requireRole, roleOf } from './_auth.js';
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
  // Prima non c'era nessun controllo: chiunque poteva cancellare qualunque utente.
  const auth = await requireRole(req, 'staff');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (await roleOf(user_id) !== 'client') return res.status(403).json({ error: 'Si eliminano da qui solo gli accessi dei clienti' });

  // Delete from auth.users (cascades to profiles and client_users)
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, { method: 'DELETE', headers: H });
  if (!r.ok) {
    const err = await r.json();
    return res.status(400).json({ error: err.message || 'Errore eliminazione' });
  }
  return res.status(200).json({ ok: true });
}
