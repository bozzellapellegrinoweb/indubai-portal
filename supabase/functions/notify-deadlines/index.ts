/**
 * notify-deadlines — Edge Function eseguita ogni giorno dal cron Vercel.
 *
 * Controlla tutte le scadenze critiche e invia email via Resend.
 * Usa email_log per evitare duplicati (dedup per evento + entità + destinatario).
 */

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

// ── Template HTML ─────────────────────────────────────────────────────────────

function emailHtml(title: string, body: string, ctaLabel?: string, ctaUrl?: string): string {
  const cta = ctaLabel && ctaUrl
    ? `<p style="text-align:center;margin-top:28px">
         <a href="${ctaUrl}" style="background:#1a2744;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">${ctaLabel}</a>
       </p>`
    : '';
  return `
    <h2 style="margin:0 0 16px;color:#1a2744;font-size:20px">${title}</h2>
    <div style="color:#374151;font-size:15px;line-height:1.6">${body}</div>
    ${cta}`;
}

function wrapTemplate(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f0f2f5;margin:0;padding:24px">
  <div style="max-width:580px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#1a2744;padding:24px 32px;text-align:center">
      <p style="color:#c9a84c;margin:0 0 4px;font-size:13px;letter-spacing:2px;text-transform:uppercase">INDUBAI</p>
      <p style="color:white;margin:0;font-size:16px;font-weight:500">Portal Notifiche</p>
    </div>
    <div style="padding:32px">${content}</div>
    <div style="background:#f8f9fb;padding:16px 32px;text-align:center;border-top:1px solid #e8eaf0">
      <p style="margin:0;font-size:12px;color:#9ca3af">
        InDubai Portal &mdash; Non rispondere a questa email.<br>
        <a href="${PORTAL_URL}" style="color:#1a2744;text-decoration:none">Accedi al portale</a>
      </p>
    </div>
  </div>
</body></html>`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr).getTime() - today.getTime()) / 86400000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendEmail(
  sb: ReturnType<typeof createClient>,
  opts: { to: string; subject: string; html: string; event_type: string; entity_id?: string; entity_type?: string }
) {
  const htmlWrapped = wrapTemplate(opts.html);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [opts.to], subject: opts.subject, html: htmlWrapped }),
  });
  const data = await res.json();
  const status = res.ok ? 'sent' : 'failed';
  await sb.from('email_log').insert({
    recipient_email: opts.to,
    subject: opts.subject,
    event_type: opts.event_type,
    entity_id: opts.entity_id || null,
    entity_type: opts.entity_type || null,
    status,
    resend_id: data?.id || null,
  }).catch(() => {});
  return { ok: res.ok, resend_id: data?.id };
}

/** Controlla se email già inviata recentemente per stesso evento + entità + destinatario */
async function alreadySent(
  sb: ReturnType<typeof createClient>,
  event_type: string,
  entity_id: string,
  recipient_email: string,
  withinHours: number
): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 3600000).toISOString();
  const { data } = await sb
    .from('email_log')
    .select('id')
    .eq('event_type', event_type)
    .eq('entity_id', entity_id)
    .eq('recipient_email', recipient_email)
    .eq('status', 'sent')
    .gte('created_at', since)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Recupera email di tutti gli staff con ruoli specificati */
async function getStaffEmails(sb: ReturnType<typeof createClient>, roles = ['admin', 'senior']): Promise<{ id: string; email: string; full_name: string }[]> {
  const { data: profiles } = await sb
    .from('profiles')
    .select('id, full_name, role')
    .in('role', roles);

  if (!profiles?.length) return [];

  const results: { id: string; email: string; full_name: string }[] = [];
  for (const p of profiles) {
    const { data: { user } } = await sb.auth.admin.getUserById(p.id);
    if (user?.email) results.push({ id: p.id, email: user.email, full_name: p.full_name });
  }
  return results;
}

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkVatDeadlines(sb: ReturnType<typeof createClient>, staffEmails: { id: string; email: string }[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const limit = new Date(today); limit.setDate(limit.getDate() + 25);
  const todayStr = today.toISOString().split('T')[0];
  const limitStr = limit.toISOString().split('T')[0];

  const { data: rows } = await sb
    .from('vat_register')
    .select('id, client_id, return_deadline_1, return_deadline_2, return_deadline_3, return_deadline_4, clients(company_name, is_active)')
    .filter('clients.is_active', 'eq', true);

  let sent = 0;
  for (const row of rows || []) {
    if (!row.clients?.is_active) continue;
    const deadlines = [row.return_deadline_1, row.return_deadline_2, row.return_deadline_3, row.return_deadline_4]
      .filter(Boolean)
      .filter(d => d >= todayStr && d <= limitStr);

    for (const dl of deadlines) {
      const days = daysUntil(dl);
      const entityId = `${row.id}_${dl}`;
      const subject = `⚠️ Scadenza VAT: ${row.clients?.company_name} tra ${days} giorni`;
      const html = emailHtml(
        '⚠️ Scadenza VAT imminente',
        `<p>La dichiarazione VAT di <strong>${row.clients?.company_name}</strong> scade tra <strong>${days} giorni</strong>.</p>
         <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
           <tr><td style="padding:8px;color:#6b7280">Cliente</td><td style="padding:8px;font-weight:600">${row.clients?.company_name}</td></tr>
           <tr style="background:#f9f9f9"><td style="padding:8px;color:#6b7280">Scadenza</td><td style="padding:8px;font-weight:600;color:#dc2626">${formatDate(dl)}</td></tr>
           <tr><td style="padding:8px;color:#6b7280">Giorni rimanenti</td><td style="padding:8px;font-weight:600">${days}</td></tr>
         </table>`,
        'Apri VAT Register', `${PORTAL_URL}/vat.html`
      );

      for (const staff of staffEmails) {
        if (await alreadySent(sb, 'vat_deadline', entityId, staff.email, 72)) continue;
        await sendEmail(sb, { to: staff.email, subject, html, event_type: 'vat_deadline', entity_id: entityId, entity_type: 'vat' });
        sent++;
      }
    }
  }
  return sent;
}

async function checkTasksDue(sb: ReturnType<typeof createClient>, staffEmails: { id: string; email: string }[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const limit = new Date(today); limit.setDate(limit.getDate() + 3);
  const todayStr = today.toISOString().split('T')[0];
  const limitStr = limit.toISOString().split('T')[0];

  const { data: tasks } = await sb
    .from('tasks')
    .select('id, title, due_date, assigned_to, client_id, clients(company_name), assigned_profile:profiles!tasks_assigned_to_fkey(full_name)')
    .not('status', 'in', '("completed","cancelled")')
    .gte('due_date', todayStr)
    .lte('due_date', limitStr);

  let sent = 0;
  for (const task of tasks || []) {
    if (!task.assigned_to) continue;
    const days = daysUntil(task.due_date);
    const { data: { user } } = await sb.auth.admin.getUserById(task.assigned_to);
    if (!user?.email) continue;

    if (await alreadySent(sb, 'task_due', task.id, user.email, 24)) continue;

    const clientLabel = task.clients?.company_name ? ` · ${task.clients.company_name}` : '';
    const subject = `📋 Task in scadenza: ${task.title}${days === 0 ? ' (oggi!)' : ` tra ${days} giorni`}`;
    const html = emailHtml(
      '📋 Task in scadenza',
      `<p>Hai una task in scadenza che richiede la tua attenzione.</p>
       <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
         <tr><td style="padding:8px;color:#6b7280">Task</td><td style="padding:8px;font-weight:600">${task.title}</td></tr>
         ${task.clients?.company_name ? `<tr style="background:#f9f9f9"><td style="padding:8px;color:#6b7280">Cliente</td><td style="padding:8px">${task.clients.company_name}</td></tr>` : ''}
         <tr><td style="padding:8px;color:#6b7280">Scadenza</td><td style="padding:8px;font-weight:600;color:#dc2626">${formatDate(task.due_date)}</td></tr>
         <tr style="background:#f9f9f9"><td style="padding:8px;color:#6b7280">Giorni rimanenti</td><td style="padding:8px;font-weight:600">${days === 0 ? 'Oggi!' : days}</td></tr>
       </table>`,
      'Apri Tasks', `${PORTAL_URL}/tasks.html`
    );

    await sendEmail(sb, { to: user.email, subject, html, event_type: 'task_due', entity_id: task.id, entity_type: 'task' });
    sent++;
  }
  return sent;
}

async function checkPaymentsFailed(sb: ReturnType<typeof createClient>, staffEmails: { id: string; email: string }[]) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: payments } = await sb
    .from('subscription_payments')
    .select('id, client_id, status, clients(company_name, is_active)')
    .in('status', ['failed', 'no_tentativo'])
    .eq('year', year)
    .eq('month', month);

  const active = (payments || []).filter(p => p.clients?.is_active);
  if (!active.length) return 0;

  const rows = active.map(p =>
    `<tr><td style="padding:8px">${p.clients?.company_name}</td>
     <td style="padding:8px;text-align:center">
       <span style="background:${p.status === 'failed' ? '#fee2e2' : '#fef9c3'};color:${p.status === 'failed' ? '#dc2626' : '#92400e'};padding:3px 8px;border-radius:4px;font-size:12px">
         ${p.status === 'failed' ? '✕ Failed' : '⚠ No tent.'}
       </span>
     </td></tr>`
  ).join('');

  const subject = `⚠️ ${active.length} pagament${active.length === 1 ? 'o' : 'i'} da verificare — ${new Date().toLocaleString('it-IT', { month: 'long', year: 'numeric' })}`;
  const html = emailHtml(
    '⚠️ Pagamenti da verificare',
    `<p>I seguenti clienti hanno pagamenti problematici per il mese corrente:</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
       <tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Cliente</th><th style="padding:8px">Status</th></tr>
       ${rows}
     </table>`,
    'Apri Pagamenti', `${PORTAL_URL}/payments.html`
  );

  let sent = 0;
  const entityId = `payments_${year}_${month}`;
  for (const staff of staffEmails) {
    if (await alreadySent(sb, 'payment_failed', entityId, staff.email, 24)) continue;
    await sendEmail(sb, { to: staff.email, subject, html, event_type: 'payment_failed', entity_id: entityId, entity_type: 'payment' });
    sent++;
  }
  return sent;
}

async function checkStatementsMissing(sb: ReturnType<typeof createClient>, staffEmails: { id: string; email: string }[]) {
  const now = new Date();
  if (now.getDate() < 10) return 0; // Aspetta il 10 del mese

  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: missing } = await sb
    .from('bank_statements')
    .select('id, client_id, clients(company_name, is_active, in_bilancio)')
    .eq('year', year)
    .eq('month', month)
    .eq('received', false)
    .filter('clients.is_active', 'eq', true)
    .filter('clients.in_bilancio', 'eq', true);

  const active = (missing || []).filter(m => m.clients?.is_active && m.clients?.in_bilancio);
  if (!active.length) return 0;

  const rows = active.map(m =>
    `<tr><td style="padding:8px">${m.clients?.company_name}</td></tr>`
  ).join('');

  const subject = `📄 ${active.length} estratt${active.length === 1 ? 'o' : 'i'} bancari mancanti — ${new Date().toLocaleString('it-IT', { month: 'long', year: 'numeric' })}`;
  const html = emailHtml(
    '📄 Estratti bancari mancanti',
    `<p>${active.length} clienti non hanno ancora inviato gli estratti bancari per il mese corrente:</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
       <tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Cliente</th></tr>
       ${rows}
     </table>`,
    'Apri Estratti', `${PORTAL_URL}/statements.html`
  );

  let sent = 0;
  const entityId = `statements_${year}_${month}`;
  for (const staff of staffEmails) {
    if (await alreadySent(sb, 'statement_missing', entityId, staff.email, 168)) continue; // 7 giorni
    await sendEmail(sb, { to: staff.email, subject, html, event_type: 'statement_missing', entity_id: entityId, entity_type: 'statement' });
    sent++;
  }
  return sent;
}

async function checkBilanciTodo(sb: ReturnType<typeof createClient>, staffEmails: { id: string; email: string }[]) {
  const month = new Date().getMonth() + 1;
  if (![1, 2, 3].includes(month)) return 0; // Solo gen-mar

  const year = new Date().getFullYear();
  const { data: todos } = await sb
    .from('bilanci')
    .select('id, client_id, clients(company_name, is_active)')
    .eq('year', year)
    .eq('bilancio', false)
    .filter('clients.is_active', 'eq', true);

  const active = (todos || []).filter(b => b.clients?.is_active);
  if (!active.length) return 0;

  const rows = active.map(b =>
    `<tr><td style="padding:8px">${b.clients?.company_name}</td></tr>`
  ).join('');

  const subject = `📊 ${active.length} bilanci da completare — ${year}`;
  const html = emailHtml(
    '📊 Bilanci da completare',
    `<p>${active.length} clienti hanno ancora il bilancio ${year} da completare:</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
       <tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Cliente</th></tr>
       ${rows}
     </table>`,
    'Apri Bilanci', `${PORTAL_URL}/bilanci.html`
  );

  let sent = 0;
  const entityId = `bilanci_${year}_${month}`;
  for (const staff of staffEmails) {
    if (await alreadySent(sb, 'bilancio_todo', entityId, staff.email, 168)) continue; // 7 giorni
    await sendEmail(sb, { to: staff.email, subject, html, event_type: 'bilancio_todo', entity_id: entityId, entity_type: 'bilancio' });
    sent++;
  }
  return sent;
}

async function checkAffinitasDue(sb: ReturnType<typeof createClient>, staffEmails: { id: string; email: string }[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const limit = new Date(today); limit.setDate(limit.getDate() + 7);
  const todayStr = today.toISOString().split('T')[0];
  const limitStr = limit.toISOString().split('T')[0];

  const { data: subs } = await sb
    .from('affinitas_subscriptions')
    .select('id, company_name, subscription_ref, package, next_payment')
    .gte('next_payment', todayStr)
    .lte('next_payment', limitStr);

  let sent = 0;
  for (const sub of subs || []) {
    const days = daysUntil(sub.next_payment);
    const subject = `💳 Rinnovo Affinitas: ${sub.company_name} tra ${days} giorni`;
    const html = emailHtml(
      '💳 Rinnovo Affinitas imminente',
      `<p>Il rinnovo Affinitas è in scadenza imminente.</p>
       <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
         <tr><td style="padding:8px;color:#6b7280">Azienda</td><td style="padding:8px;font-weight:600">${sub.company_name}</td></tr>
         ${sub.subscription_ref ? `<tr style="background:#f9f9f9"><td style="padding:8px;color:#6b7280">Ref.</td><td style="padding:8px">${sub.subscription_ref}</td></tr>` : ''}
         ${sub.package ? `<tr><td style="padding:8px;color:#6b7280">Pacchetto</td><td style="padding:8px">${sub.package}</td></tr>` : ''}
         <tr style="background:#f9f9f9"><td style="padding:8px;color:#6b7280">Data rinnovo</td><td style="padding:8px;font-weight:600;color:#dc2626">${formatDate(sub.next_payment)}</td></tr>
         <tr><td style="padding:8px;color:#6b7280">Giorni rimanenti</td><td style="padding:8px;font-weight:600">${days}</td></tr>
       </table>`,
      'Apri Affinitas', `${PORTAL_URL}/affinitas.html`
    );

    for (const staff of staffEmails) {
      if (await alreadySent(sb, 'affinitas_due', sub.id, staff.email, 72)) continue; // 3 giorni
      await sendEmail(sb, { to: staff.email, subject, html, event_type: 'affinitas_due', entity_id: sub.id, entity_type: 'affinitas' });
      sent++;
    }
  }
  return sent;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Non autorizzato' }), { status: 401, headers: CORS });
    }
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY non configurata');

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Staff admin + senior per tutte le notifiche
    const staffEmails = await getStaffEmails(sb, ['admin', 'senior']);
    console.log(`Staff trovati: ${staffEmails.length}`);

    const results = await Promise.all([
      checkVatDeadlines(sb, staffEmails).then(n => ({ vat: n })),
      checkTasksDue(sb, staffEmails).then(n => ({ tasks: n })),
      checkPaymentsFailed(sb, staffEmails).then(n => ({ payments: n })),
      checkStatementsMissing(sb, staffEmails).then(n => ({ statements: n })),
      checkBilanciTodo(sb, staffEmails).then(n => ({ bilanci: n })),
      checkAffinitasDue(sb, staffEmails).then(n => ({ affinitas: n })),
    ]);

    const summary = Object.assign({}, ...results);
    const totalSent = Object.values(summary).reduce((a, b) => a + b, 0);
    console.log('Email inviate:', summary);

    return new Response(JSON.stringify({ ok: true, sent: totalSent, summary, date: new Date().toISOString() }), { headers: CORS });
  } catch (e: any) {
    console.error('notify-deadlines error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
});
