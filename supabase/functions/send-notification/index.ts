import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const APP_ID = '06f381cd-ed3d-4393-a5c2-3f6ef8322661';
const API_KEY = 'os_v2_app_a3zydtpnhvbzhjoch5xpqmrgmga7lo2j2aqep2uioz2cpvnkzyu4mjbwdfvz3ef7tfybxxl6l3xxppitk26a247ir3mlpjvpgjsdtaq';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Content-Type': 'application/json' };

async function sendPush(payload: object) {
  const r = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, target_channel: 'push', ...payload }),
  });
  return r.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { action, title, message, url, user_id, company } = await req.json();
    if (!title || !message) throw new Error('title and message are required');
    const notification: any = { headings: { it: title, en: title }, contents: { it: message, en: message } };
    if (url) notification.url = url;

    let data;
    if (action === 'send_to_user' && user_id) {
      data = await sendPush({ ...notification, include_aliases: { external_id: [user_id] } });
    } else if (action === 'send_to_company' && company) {
      data = await sendPush({ ...notification, filters: [{ field: 'tag', key: 'company', relation: '=', value: company }] });
    } else if (action === 'send_to_all') {
      data = await sendPush({ ...notification, included_segments: ['Total Subscriptions'] });
    } else {
      throw new Error('Invalid action or missing target');
    }

    if (data.errors) throw new Error(JSON.stringify(data.errors));
    return new Response(JSON.stringify({ ok: true, id: data.id, recipients: data.recipients }), { headers: CORS });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: CORS });
  }
});
