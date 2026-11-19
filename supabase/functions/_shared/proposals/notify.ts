// Notifiche allo staff: portale (tabella notifications), email e WhatsApp.
// On/off e ruoli destinatari da notification_settings, come il resto del
// portale (fail-open: se la riga manca si invia agli admin).

import { env, PORTAL_URL } from './env.ts';
import { sendEmail } from './email.ts';
import { ghlConfigured, ghlSend, ghlUpsertContact } from './ghl.ts';
import { escapeHtml } from './util.ts';

export interface StaffNotice {
  event_type: string;     // es. 'proposal_signed'
  title: string;
  body: string;
  proposal_id: string;
  client_id: string;
  whatsapp?: boolean;     // default true
  email?: boolean;        // default true
}

// deno-lint-ignore no-explicit-any
async function recipients(sb: any, event_type: string): Promise<{ id: string; email: string | null }[] | null> {
  let roles = ['admin'];
  const { data: cfg } = await sb.from('notification_settings')
    .select('enabled,roles').eq('event_type', event_type).maybeSingle();
  if (cfg?.enabled === false) return null;
  if (Array.isArray(cfg?.roles) && cfg.roles.length) roles = cfg.roles;
  const { data: profs } = await sb.from('profiles').select('id').in('role', roles);
  const out: { id: string; email: string | null }[] = [];
  for (const p of profs || []) {
    let email: string | null = null;
    try { email = (await sb.auth.admin.getUserById(p.id))?.data?.user?.email || null; } catch { /* */ }
    out.push({ id: p.id, email });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function notifyStaff(sb: any, n: StaffNotice): Promise<void> {
  const people = await recipients(sb, n.event_type);
  if (people === null) return; // spenta da /notifiche-admin
  const link = `/client-detail.html?id=${n.client_id}&tab=proposte&proposal=${n.proposal_id}`;

  // 1. Portale
  if (people.length) {
    await sb.from('notifications').insert(people.map((p) => ({
      user_id: p.id, type: n.event_type, title: n.title, body: n.body,
      link, entity_type: 'proposal', entity_id: n.proposal_id,
    }))).then(() => {}, (e: Error) => console.error('[notify] notifications', e.message));
  }

  // 2. Email
  const emails = people.map((p) => p.email).filter(Boolean) as string[];
  if (emails.length && n.email !== false) {
    await sendEmail(sb, {
      to: emails, subject: n.title, event_type: n.event_type, entity_id: n.proposal_id,
      html: `<h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(n.title)}</h2>
        <p style="margin:0 0 20px;line-height:1.6">${escapeHtml(n.body)}</p>
        <a href="${PORTAL_URL}${link}" style="display:inline-block;background:#000;color:#47ee74;text-decoration:none;padding:12px 22px;border-radius:99px;font-weight:700">Apri nel portale</a>`,
    });
  }

  // 3. WhatsApp all'admin (ADMIN_WHATSAPP_PHONE) tramite GHL, best-effort.
  //    Nota: fuori dalla finestra di 24 ore WhatsApp consegna solo messaggi
  //    basati su template approvato; se GHL rifiuta, resta portale + email.
  const adminPhone = env('ADMIN_WHATSAPP_PHONE');
  if (n.whatsapp !== false && adminPhone && ghlConfigured()) {
    try {
      const cid = await ghlUpsertContact(adminPhone, 'Admin Portale');
      await ghlSend(cid, 'WhatsApp', `${n.title}\n${n.body}\n${PORTAL_URL}${link}`);
    } catch (e) {
      console.warn('[notify] WhatsApp admin non inviato:', (e as Error).message);
    }
  }
}
