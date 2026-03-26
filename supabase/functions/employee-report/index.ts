/**
 * employee-report — Edge Function
 *
 * Invia ogni giorno alle 09:00 Dubai (07:00 UTC) un report email all'admin
 * con il riepilogo delle attività di ogni dipendente del giorno precedente.
 *
 * Fonti dati:
 *  - activity_log  → azioni del giorno (clienti, onboarding, pagamenti, estratti)
 *  - tasks         → snapshot task completate / in attesa per dipendente
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PORTAL_URL   = 'https://portal.indubai.it';
const ADMIN_EMAIL  = 'bozzellapellegrino@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
};

const ACTION_LABELS: Record<string, string> = {
  client_created:           '👤 Cliente creato',
  onboarding_step_updated:  '📋 Step onboarding aggiornato',
  subscription_updated:     '💳 Pagamento aggiornato',
  bank_statement_updated:   '🏦 Estratto conto aggiornato',
};

function wrapTemplate(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f0f2f5;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#1a2744;padding:24px 32px;text-align:center">
      <p style="color:#c9a84c;margin:0 0 4px;font-size:13px;letter-spacing:2px;text-transform:uppercase">INDUBAI</p>
      <p style="color:white;margin:0;font-size:16px;font-weight:500">Report Attività Dipendenti</p>
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Finestra "oggi" in Dubai (UTC+4) ──────────────────────────────────────
    const now = new Date();
    // Mezzanotte Dubai = UTC-4h
    const dubaiOffset = 4 * 60 * 60 * 1000;
    const dubaiNow = new Date(now.getTime() + dubaiOffset);
    const dayStart = new Date(Date.UTC(dubaiNow.getUTCFullYear(), dubaiNow.getUTCMonth(), dubaiNow.getUTCDate()) - dubaiOffset);
    const dayEnd   = now; // fino ad ora

    const yLabel = dayStart.toLocaleDateString('it-IT', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai',
    });
    const todayStr = dubaiNow.toISOString().split('T')[0];

    // ── Dedup: non reinviare se già inviato oggi ───────────────────────────────
    const { data: existing } = await sb
      .from('email_log')
      .select('id')
      .eq('event_type', 'employee_report')
      .gte('created_at', `${todayStr}T00:00:00Z`)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'already_sent_today' }), { headers: CORS });
    }

    // ── 1. Activity log di ieri ────────────────────────────────────────────────
    const { data: activities } = await sb
      .from('activity_log')
      .select('action, details, created_at, user_id')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())
      .order('user_id')
      .order('created_at');

    // ── 2. Nomi profili per gli user_id trovati ────────────────────────────────
    const userIds = [...new Set((activities || []).map((a: any) => a.user_id).filter(Boolean))];
    const profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await sb
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      for (const p of (profiles || [])) {
        profileMap[p.id] = p.full_name || 'Sconosciuto';
      }
    }

    // ── 3. Snapshot task per dipendente ───────────────────────────────────────
    const { data: taskRows } = await sb
      .from('tasks')
      .select('assigned_to, status')
      .in('status', ['open', 'in_progress', 'completed', 'cancelled'])
      .not('assigned_to', 'is', null);

    const taskAssigneeIds = [...new Set((taskRows || []).map((t: any) => t.assigned_to).filter(Boolean))];
    if (taskAssigneeIds.length > 0) {
      const { data: taskProfiles } = await sb
        .from('profiles')
        .select('id, full_name')
        .in('id', taskAssigneeIds);
      for (const p of (taskProfiles || [])) {
        if (!profileMap[p.id]) profileMap[p.id] = p.full_name || 'Sconosciuto';
      }
    }

    // ── 4. Aggrega attività per nome ──────────────────────────────────────────
    const actMap: Record<string, Record<string, number>> = {};
    for (const act of (activities || [])) {
      const name = profileMap[(act as any).user_id] || 'Sconosciuto';
      if (!actMap[name]) actMap[name] = {};
      actMap[name][(act as any).action] = (actMap[name][(act as any).action] || 0) + 1;
    }

    // ── 5. Aggrega task per nome ───────────────────────────────────────────────
    const taskMap: Record<string, { completed: number; open: number }> = {};
    for (const t of (taskRows || [])) {
      const name = profileMap[(t as any).assigned_to] || 'Sconosciuto';
      if (!taskMap[name]) taskMap[name] = { completed: 0, open: 0 };
      if ((t as any).status === 'completed') taskMap[name].completed++;
      else taskMap[name].open++;
    }

    // ── 6. Unione nomi (esclude 'admin' / 'Pellegrino') ───────────────────────
    const allNames = new Set([...Object.keys(actMap), ...Object.keys(taskMap)]);
    // Rimuove profili admin dal report (opzionale: aggiungi filtro qui se necessario)

    // ── 7. Build HTML sezioni ─────────────────────────────────────────────────
    let sections = '';
    for (const name of Array.from(allNames).sort()) {
      const counts = actMap[name] || {};
      const tasks  = taskMap[name] || { completed: 0, open: 0 };

      let actRows = '';
      for (const [action, count] of Object.entries(counts)) {
        const label = ACTION_LABELS[action] || action;
        actRows += `<tr>
          <td style="padding:7px 12px;color:#374151;font-size:13px">${label}</td>
          <td style="padding:7px 12px;text-align:right;font-weight:700;color:#1a2744;font-size:13px">${count}</td>
        </tr>`;
      }
      if (!actRows) {
        actRows = `<tr><td colspan="2" style="padding:7px 12px;color:#9ca3af;font-size:13px;font-style:italic">Nessuna attività registrata ieri</td></tr>`;
      }

      sections += `
        <div style="background:#f8f9fb;border:1.5px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:16px">
          <div style="font-size:15px;font-weight:700;color:#1a2744;margin-bottom:12px;display:flex;align-items:center;gap:8px">
            👤 ${name}
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
            <thead>
              <tr style="background:#e8eaf0">
                <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280">Azione</th>
                <th style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280">N°</th>
              </tr>
            </thead>
            <tbody>${actRows}</tbody>
          </table>
          <div style="display:flex;gap:20px;font-size:13px;padding-top:10px;border-top:1px solid #e5e7eb">
            <span>✅ Task completate: <strong style="color:#16a34a">${tasks.completed}</strong></span>
            <span>⏳ In attesa/aperte: <strong style="color:#d97706">${tasks.open}</strong></span>
          </div>
        </div>`;
    }

    if (!sections) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_data' }), { headers: CORS });
    }

    const htmlContent = `
      <h2 style="margin:0 0 6px;color:#1a2744;font-size:18px">📋 Report Attività Dipendenti</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:13px">Riferito a: <strong>${yLabel}</strong></p>
      ${sections}
      <p style="text-align:center;margin-top:24px">
        <a href="${PORTAL_URL}" style="background:#1a2744;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Apri il Portale</a>
      </p>`;

    // ── 8. Invia via send-email ────────────────────────────────────────────────
    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: ADMIN_EMAIL,
        subject: `📋 Report attività dipendenti — ${yLabel}`,
        html: htmlContent,
        event_type: 'employee_report',
      }),
    });

    const sendData = await sendRes.json();
    return new Response(
      JSON.stringify({ ok: sendRes.ok, sent: true, details: sendData }),
      { headers: CORS }
    );

  } catch (err: any) {
    console.error('[employee-report]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
