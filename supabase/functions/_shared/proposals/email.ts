// Email del modulo Proposte via Resend, con carta intestata PB TAX.
// Stessa chiave (RESEND_API_KEY) e stesso registro (email_log) di send-email;
// qui si chiama Resend direttamente perche' serve l'allegato PDF, che
// send-email non supporta.

import { BRAND, env } from './env.ts';
import { b64Encode } from './crypto.ts';

const RESEND_API_KEY = env('RESEND_API_KEY');
const FROM = env('PROPOSALS_EMAIL_FROM', 'PB TAX <noreply@indubai.it>');

export function brandedEmail(content: string, locale = 'it'): string {
  const foot = locale === 'en'
    ? 'Automatic message — please do not reply to this email.'
    : 'Messaggio automatico — non rispondere a questa email.';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f2ef;font-family:'DM Sans',Arial,sans-serif;color:#000">
  <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3dfd6">
    <div style="padding:22px 28px;border-bottom:4px solid #47ee74">
      <div style="font-size:20px;font-weight:700;letter-spacing:-.02em">${BRAND.short}</div>
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5c5a55;font-weight:700">${BRAND.name}</div>
    </div>
    <div style="padding:28px">${content}</div>
    <div style="padding:16px 28px;background:#faf9f6;border-top:1px solid #e3dfd6;font-size:12px;color:#5c5a55">
      ${BRAND.name} · ${BRAND.address}<br>${foot}
    </div>
  </div>
</body></html>`;
}

export interface Attachment { filename: string; content: Uint8Array }

// deno-lint-ignore no-explicit-any
export async function sendEmail(sb: any, opts: {
  to: string | string[]; subject: string; html: string; locale?: string;
  attachments?: Attachment[]; event_type: string; entity_id?: string; entity_type?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'nessun destinatario' };
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY non configurata' };

  let ok = false, resend_id: string | null = null, error: string | undefined;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: recipients, subject: opts.subject,
        html: brandedEmail(opts.html, opts.locale),
        attachments: (opts.attachments || []).map((a) => ({ filename: a.filename, content: b64Encode(a.content) })),
      }),
    });
    const d = await r.json().catch(() => ({}));
    ok = r.ok; resend_id = d?.id || null; if (!r.ok) error = d?.message || `Resend HTTP ${r.status}`;
  } catch (e) { error = (e as Error).message; }

  for (const email of recipients) {
    try {
      await sb.from('email_log').insert({
        recipient_email: email, subject: opts.subject, event_type: opts.event_type,
        entity_id: opts.entity_id || null, entity_type: opts.entity_type || 'proposal',
        status: ok ? 'sent' : 'failed', resend_id,
      });
    } catch { /* il registro non blocca l'invio */ }
  }
  return ok ? { ok } : { ok, error };
}
