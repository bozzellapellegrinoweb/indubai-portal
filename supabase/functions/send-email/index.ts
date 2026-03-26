import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FROM_EMAIL     = 'InDubai Portal <noreply@indubai.it>';
const PORTAL_URL     = 'https://portal.indubai.it';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
};

function wrapTemplate(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f0f2f5;margin:0;padding:24px">
  <div style="max-width:580px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#1a2744;padding:24px 32px;text-align:center">
      <p style="color:#c9a84c;margin:0 0 4px;font-size:13px;letter-spacing:2px;text-transform:uppercase">INDUBAI</p>
      <p style="color:white;margin:0;font-size:16px;font-weight:500">Portal Notifiche</p>
    </div>
    <div style="padding:32px">
      ${content}
    </div>
    <div style="background:#f8f9fb;padding:16px 32px;text-align:center;border-top:1px solid #e8eaf0">
      <p style="margin:0;font-size:12px;color:#9ca3af">
        InDubai Portal &mdash; Non rispondere a questa email.<br>
        <a href="${PORTAL_URL}" style="color:#1a2744;text-decoration:none">Accedi al portale</a>
      </p>
    </div>
  </div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY non configurata');

    // Autenticazione: accetta sia JWT utente sia service role key
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) throw new Error('Token mancante');

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve utente chiamante (solo per validare che sia autenticato)
    let callerOk = token === SERVICE_KEY;
    if (!callerOk) {
      const { data: { user } } = await sbAdmin.auth.getUser(token);
      callerOk = !!user;
    }
    if (!callerOk) throw new Error('Non autorizzato');

    const body = await req.json();
    let { to, subject, html, event_type, entity_id, entity_type, user_id } = body;

    // Se viene passato user_id invece di to, recupera email dall'auth
    if (!to && user_id) {
      const { data: { user } } = await sbAdmin.auth.admin.getUserById(user_id);
      if (!user?.email) throw new Error('Utente non trovato: ' + user_id);
      to = user.email;
    }

    if (!to || !subject || !html) throw new Error('to, subject e html sono obbligatori');

    const recipients = Array.isArray(to) ? to : [to];
    const htmlWrapped = wrapTemplate(html);

    // Invia via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html: htmlWrapped }),
    });

    const resendData = await resendRes.json();
    const resend_id: string | null = resendData?.id || null;
    const status = resendRes.ok ? 'sent' : 'failed';

    // Log per ogni destinatario
    for (const email of recipients) {
      await sbAdmin.from('email_log').insert({
        recipient_email: email,
        subject,
        event_type: event_type || 'manual',
        entity_id: entity_id || null,
        entity_type: entity_type || null,
        status,
        resend_id,
      }).catch(() => {});
    }

    if (!resendRes.ok) {
      console.error('Resend error:', JSON.stringify(resendData));
      return new Response(JSON.stringify({ ok: false, error: resendData?.message || 'Resend error' }), { status: 400, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true, resend_id, recipients: recipients.length }), { headers: CORS });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: CORS });
  }
});
