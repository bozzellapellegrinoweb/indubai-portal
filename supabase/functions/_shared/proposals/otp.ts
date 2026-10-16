// ============================================================
// Adattatore dei codici di accesso — sostituibile con OTP_PROVIDER
// ============================================================
//   email          -> codice per email (Resend). Per i test, finche' non c'e'
//                     il template WhatsApp approvato.
//   ghl            -> WhatsApp tramite GHL, con ripiego SMS.
//   twilio_verify  -> Twilio Verify: WhatsApp, con ripiego SMS. Il codice lo
//                     genera e lo verifica Twilio.
//
// Due famiglie di fornitore:
//   - "deliver": il codice lo generiamo noi (sei cifre), ne salviamo solo
//     l'HMAC e il fornitore lo consegna;
//   - "verify":  il fornitore genera e controlla il codice (Twilio Verify).
// In entrambi i casi scadenza (10 minuti) e tentativi (5) li contiamo noi.
// ============================================================

import { env, OTP_TTL_MIN } from './env.ts';
import { ghlConfigured, ghlSend, ghlUpsertContact } from './ghl.ts';
import { sendEmail } from './email.ts';
import { escapeHtml } from './util.ts';

export interface OtpTarget {
  phone: string;           // E.164 registrato sul destinatario
  email: string | null;
  name: string;
  locale: 'it' | 'en';
}

export interface DeliverResult { channel: 'email' | 'whatsapp' | 'sms'; ref: string | null }

export interface OtpProvider {
  name: string;
  /** true = il codice lo genera e lo verifica il fornitore */
  verifiesItself: boolean;
  /** Fornitore "deliver": consegna il codice generato da noi. */
  deliver?(target: OtpTarget, code: string): Promise<DeliverResult>;
  /** Fornitore "verify": avvia la verifica. */
  start?(target: OtpTarget): Promise<DeliverResult>;
  /** Fornitore "verify": controlla il codice. */
  check?(target: OtpTarget, code: string, ref: string | null): Promise<boolean>;
}

function codeMessage(code: string, locale: 'it' | 'en') {
  return locale === 'en'
    ? `PB TAX: your access code is ${code}. It is valid for ${OTP_TTL_MIN} minutes. Do not share it with anyone.`
    : `PB TAX: il tuo codice di accesso è ${code}. Vale ${OTP_TTL_MIN} minuti. Non condividerlo con nessuno.`;
}

// ── email ───────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function emailProvider(sb: any): OtpProvider {
  return {
    name: 'email',
    verifiesItself: false,
    async deliver(t, code) {
      if (!t.email) throw new Error('Il destinatario non ha un indirizzo email');
      const it = t.locale !== 'en';
      const r = await sendEmail(sb, {
        to: t.email,
        locale: t.locale,
        subject: it ? `Codice di accesso alla proposta: ${code}` : `Proposal access code: ${code}`,
        event_type: 'proposal_otp',
        html: `<p style="margin:0 0 12px">${it ? 'Gentile' : 'Dear'} ${escapeHtml(t.name)},</p>
          <p style="margin:0 0 18px">${it ? 'ecco il codice per aprire la proposta:' : 'here is the code to open the proposal:'}</p>
          <div style="font-size:34px;font-weight:700;letter-spacing:.3em;background:#47ee74;border-radius:12px;padding:14px 18px;text-align:center">${code}</div>
          <p style="margin:18px 0 0;color:#5c5a55;font-size:13px">${it
            ? `Vale ${OTP_TTL_MIN} minuti. Se non hai richiesto tu il codice, ignora questa email.`
            : `It is valid for ${OTP_TTL_MIN} minutes. If you did not request it, ignore this email.`}</p>`,
      });
      if (!r.ok) throw new Error(r.error || 'invio email fallito');
      return { channel: 'email', ref: null };
    },
  };
}

// ── GHL: WhatsApp con ripiego SMS ───────────────────────────
function ghlProvider(): OtpProvider {
  return {
    name: 'ghl',
    verifiesItself: false,
    async deliver(t, code) {
      if (!ghlConfigured()) throw new Error('GHL non configurato (GHL_API_TOKEN, GHL_LOCATION_ID)');
      const contactId = await ghlUpsertContact(t.phone, t.name, t.email);
      const msg = codeMessage(code, t.locale);
      try {
        return { channel: 'whatsapp', ref: await ghlSend(contactId, 'WhatsApp', msg) };
      } catch (e) {
        console.warn('[otp/ghl] WhatsApp fallito, ripiego SMS:', (e as Error).message);
        return { channel: 'sms', ref: await ghlSend(contactId, 'SMS', msg) };
      }
    },
  };
}

// ── Twilio Verify: WhatsApp con ripiego SMS ─────────────────
function twilioProvider(): OtpProvider {
  const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN'), svc = env('TWILIO_VERIFY_SERVICE_SID');
  const auth = 'Basic ' + btoa(`${sid}:${tok}`);
  const call = async (path: string, form: Record<string, string>) => {
    if (!sid || !tok || !svc) throw new Error('Twilio non configurato (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)');
    const r = await fetch(`https://verify.twilio.com/v2/Services/${svc}/${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twilio ${path}: ${d?.message || r.status}`);
    return d;
  };
  return {
    name: 'twilio_verify',
    verifiesItself: true,
    async start(t) {
      const locale = t.locale === 'en' ? 'en' : 'it';
      try {
        const d = await call('Verifications', { To: t.phone, Channel: 'whatsapp', Locale: locale });
        return { channel: 'whatsapp', ref: d.sid || null };
      } catch (e) {
        console.warn('[otp/twilio] WhatsApp fallito, ripiego SMS:', (e as Error).message);
        const d = await call('Verifications', { To: t.phone, Channel: 'sms', Locale: locale });
        return { channel: 'sms', ref: d.sid || null };
      }
    },
    async check(t, code) {
      try {
        const d = await call('VerificationCheck', { To: t.phone, Code: code });
        return d.status === 'approved';
      } catch { return false; }
    },
  };
}

// deno-lint-ignore no-explicit-any
export function getOtpProvider(sb: any): OtpProvider {
  const name = env('OTP_PROVIDER', 'email').toLowerCase();
  if (name === 'ghl') return ghlProvider();
  if (name === 'twilio_verify' || name === 'twilio') return twilioProvider();
  return emailProvider(sb);
}
