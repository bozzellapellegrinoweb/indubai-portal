import { SUPABASE_URL, SERVICE_KEY, STAFF_ROLES, verifiedUser, roleOf } from './_auth.js';
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata' });
  const caller = await verifiedUser(req);
  if (!caller) return res.status(401).json({ error: 'Sessione non valida o scaduta' });
  const callerId = caller.id;

  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Missing fields' });

  // Password di un altro: prima bastava non essere 'client' (anche un
  // ambassador poteva cambiare la password dell'admin). Ora:
  //   - serve un ruolo interno;
  //   - la password di un utente interno la cambia solo l'admin.
  if (userId !== callerId) {
    const role = await roleOf(callerId);
    if (!STAFF_ROLES.includes(role)) return res.status(403).json({ error: 'Not allowed' });
    const targetRole = await roleOf(userId);
    if (targetRole !== 'client' && role !== 'admin') return res.status(403).json({ error: 'Solo l\'admin cambia la password di un utente interno' });
  }

  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ password })
  });

  const body = await r.text();
  if (!r.ok) return res.status(400).json({ error: body });
  return res.status(200).json({ ok: true });
}
