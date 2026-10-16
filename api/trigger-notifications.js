import { SUPABASE_URL, SERVICE_KEY, cronAuthorized } from './_auth.js';
/**
 * /api/trigger-notifications
 *
 * Endpoint chiamato dal cron Vercel ogni giorno alle 07:00 UTC.
 * Invoca la Edge Function notify-deadlines con service role key.
 */

const NOTIFY_FN_URL = `${SUPABASE_URL}/functions/v1/notify-deadlines`;


export default async function handler(req, res) {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  // Vercel cron invia GET; accettiamo anche POST per test manuali
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(NOTIFY_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[trigger-notifications] Edge Function error:', data);
      return res.status(500).json({ error: 'Edge function failed', details: data });
    }

    console.log('[trigger-notifications] Completato:', data);
    return res.status(200).json(data);
  } catch (err) {
    console.error('[trigger-notifications] Fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
