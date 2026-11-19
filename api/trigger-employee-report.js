import { SUPABASE_URL, SERVICE_KEY, cronAuthorized } from './_auth.js';
/**
 * /api/trigger-employee-report
 *
 * Endpoint chiamato dal cron Vercel ogni giorno alle 16:00 UTC (20:00 Dubai).
 * Invoca la Edge Function employee-report con service role key.
 */

const REPORT_FN_URL  = `${SUPABASE_URL}/functions/v1/employee-report`;


export default async function handler(req, res) {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(REPORT_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[trigger-employee-report] Edge Function error:', data);
      return res.status(500).json({ error: 'Edge function failed', details: data });
    }

    console.log('[trigger-employee-report] Completato:', data);
    return res.status(200).json(data);
  } catch (err) {
    console.error('[trigger-employee-report] Fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
