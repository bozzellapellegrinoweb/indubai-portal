import { SUPABASE_URL, SERVICE_KEY, requireRole } from './_auth.js';


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Token verificato da Supabase, non solo decodificato.
  const auth = await requireRole(req, ['admin', 'mini_admin', 'senior']);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { requestId } = req.body;
  if (!requestId) return res.status(400).json({ error: 'requestId required' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests?id=eq.${requestId}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    }
  });

  if (!r.ok) return res.status(400).json({ error: await r.text() });
  return res.status(200).json({ ok: true });
}
