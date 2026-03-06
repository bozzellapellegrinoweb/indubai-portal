import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const APP_ID  = '06f381cd-ed3d-4393-a5c2-3f6ef8322661';
const API_KEY = Deno.env.get('ONESIGNAL_API_KEY') || '';
const CORS    = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!API_KEY) throw new Error('ONESIGNAL_API_KEY not configured');
    const { token, client_id, company } = await req.json();
    if (!token) throw new Error('token required');
    console.log('Registering token for client:', client_id);

    const r = await fetch('https://api.onesignal.com/players', {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: APP_ID,
        device_type: 0,
        identifier: token,
        tags: { client_id, company: company || '' }
      })
    });
    const data = await r.json();
    console.log('OneSignal:', JSON.stringify(data));
    if (data.errors) throw new Error(JSON.stringify(data.errors));
    return new Response(JSON.stringify({ ok: true, player_id: data.id }), { headers: CORS });
  } catch(e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: CORS });
  }
});
