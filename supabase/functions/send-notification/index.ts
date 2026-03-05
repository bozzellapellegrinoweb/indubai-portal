import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const APP_ID  = '06f381cd-ed3d-4393-a5c2-3f6ef8322661';
const API_KEY = Deno.env.get('ONESIGNAL_API_KEY') || '';
const CORS    = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json'
};

async function sendPush(payload: object) {
  const r = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, ...payload }),
  });
  const text = await r.text();
  console.log('OneSignal response:', text);
  try { return JSON.parse(text); } catch { return { error: text }; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!API_KEY) throw new Error('ONESIGNAL_API_KEY secret not configured');

    const { action, title, message, url, user_id, company } = await req.json();
    console.log('Received:', { action, title, user_id, company });
    
    if (!title || !message) throw new Error('title and message are required');

    const notification: any = {
      headings: { it: title, en: title },
      contents: { it: message, en: message },
    };
    if (url) notification.url = url;

    let data;

    if (action === 'send_to_user' && user_id) {
      // Filtra per tag client_id
      data = await sendPush({
        ...notification,
        filters: [
          { field: 'tag', key: 'client_id', relation: '=', value: user_id }
        ]
      });
    } else if (action === 'send_to_company' && company) {
      data = await sendPush({
        ...notification,
        filters: [
          { field: 'tag', key: 'company', relation: '=', value: company }
        ]
      });
    } else if (action === 'send_to_all') {
      data = await sendPush({
        ...notification,
        included_segments: ['Total Subscriptions']
      });
    } else {
      throw new Error('Invalid action or missing target');
    }

    console.log('Result:', JSON.stringify(data));
    
    // OneSignal errors sono dentro data.errors
    if (data?.errors) {
      // Se no recipients trovati non è un errore bloccante
      if (data.recipients === 0) {
        return new Response(
          JSON.stringify({ ok: true, id: data.id, recipients: 0, warning: 'Nessun subscriber trovato per questo cliente' }),
          { headers: CORS }
        );
      }
      throw new Error(JSON.stringify(data.errors));
    }
    
    return new Response(
      JSON.stringify({ ok: true, id: data?.id, recipients: data?.recipients ?? 0 }),
      { headers: CORS }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: CORS });
  }
});
