const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzIwNTEsImV4cCI6MjA4NzYwODA1MX0.I0hB8POnRunvGyr7XXItp8E5H70i0slG-pqxqzCOBOg';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

// Le note arrivano dal dipendente e finiscono in un'email HTML: vanno filtrate.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Verifica il token presso GoTrue e restituisce l'id dell'utente autenticato.
// Prima l'id veniva preso decodificando il payload del JWT senza controllarne la
// firma: bastava inviare un token costruito a mano con il `sub` di un admin per
// approvare, rifiutare o eliminare qualunque richiesta di ferie.
async function getVerifiedUserId(token) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error('[getVerifiedUserId] token rifiutato:', res.status);
      return null;
    }
    const user = await res.json();
    return user?.id || null;
  } catch (e) {
    console.error('[getVerifiedUserId] error:', e.message);
    return null;
  }
}

async function getUserRole(userId, callerToken) {
  // Strategy 1: service key (bypasses RLS)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (res.ok) {
      const profiles = await res.json();
      if (Array.isArray(profiles) && profiles.length > 0) return profiles[0].role;
    } else {
      console.error('[getUserRole] svc-key profiles query failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.error('[getUserRole] svc-key profiles error:', e.message);
  }

  // Strategy 2: caller's own JWT (uses RLS, but profiles SELECT is open to authenticated)
  if (callerToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${callerToken}` }
      });
      if (res.ok) {
        const profiles = await res.json();
        if (Array.isArray(profiles) && profiles.length > 0) return profiles[0].role;
      } else {
        console.error('[getUserRole] caller-jwt profiles query failed:', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.error('[getUserRole] caller-jwt profiles error:', e.message);
    }
  }

  // Strategy 3: fallback — l'utente è un dipendente noto ma non riusciamo a
  // leggerne il ruolo. Restituiamo 'staff' (NON admin): può creare richieste
  // per se stesso, ma non approvare/rifiutare/eliminare quelle degli altri.
  // Prima qui si restituiva 'admin', il che dava poteri di approvazione a
  // qualunque dipendente ogni volta che le due query sopra fallivano.
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/employees?profile_id=eq.${userId}&select=id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (res.ok) {
      const emps = await res.json();
      if (Array.isArray(emps) && emps.length > 0) return 'staff';
    }
  } catch (e) {
    console.error('[getUserRole] employees error:', e.message);
  }

  return null;
}

// Indirizzo aggiuntivo per le notifiche ferie, oltre alla casella con cui
// l'admin accede al portale. Storicamente era l'unico destinatario, cablato
// nel codice; resta come default per non perdere la casella già in uso.
// Impostare LEAVE_NOTIFY_EMAIL (anche come lista separata da virgole) per
// cambiarlo, o a stringa vuota per non usarne nessuno.
const EXTRA_NOTIFY_EMAILS = (process.env.LEAVE_NOTIFY_EMAIL ?? 'bozzellapellegrino@gmail.com')
  .split(',').map(e => e.trim()).filter(Boolean);

// Destinatari delle notifiche "nuova richiesta": tutti i profili admin.
// Restituisce sia i profile_id (per la notifica in-app) sia gli indirizzi
// email risolti da auth.users, uniti a EXTRA_NOTIFY_EMAILS e deduplicati.
async function getAdminRecipients() {
  const ids = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?role=eq.admin&select=id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) ids.push(...rows.map(r => r.id));
    } else {
      console.error('[getAdminRecipients] query profiles fallita:', res.status);
    }
  } catch (e) {
    console.error('[getAdminRecipients] error:', e.message);
  }
  if (!ids.length) console.error('[getAdminRecipients] nessun profilo admin trovato');

  const emails = await Promise.all(ids.map(async id => {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      if (!r.ok) return null;
      return (await r.json())?.email || null;
    } catch { return null; }
  }));

  const to = [...new Set(
    [...emails, ...EXTRA_NOTIFY_EMAILS]
      .filter(Boolean)
      .map(e => e.toLowerCase())
  )];
  return { ids, to };
}

async function getEmployeeForUser(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/employees?profile_id=eq.${userId}&select=id`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const emps = await res.json();
  return emps?.[0]?.id || null;
}

export default async function handler(req, res) {
  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const callerId = await getVerifiedUserId(token);
  if (!callerId) return res.status(401).json({ error: 'Invalid token' });

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // GET — list all leave requests (small team, all authenticated users can see all)
  if (req.method === 'GET') {
    const columns = req.query.columns || 'id,employee_id,type,date_from,date_to,days,status,note_employee,note_admin,created_at';
    const order = req.query.order || 'created_at.desc';
    const url = `${SUPABASE_URL}/rest/v1/leave_requests?select=${columns}&order=${order}`;
    const r = await fetch(url, { headers });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  }

  // For write operations, check role
  const role = await getUserRole(callerId, token);
  const isAdmin = ['admin', 'mini_admin', 'senior'].includes(role);
  if (!isAdmin) console.error('[leave-requests] role check failed — callerId:', callerId, 'role:', role);

  // POST — insert new leave request
  if (req.method === 'POST') {
    const body = req.body;
    if (!body || !body.employee_id) return res.status(400).json({ error: 'employee_id required' });

    // Non-admin can only create for themselves
    if (!isAdmin) {
      const empId = await getEmployeeForUser(callerId);
      if (body.employee_id !== empId) return res.status(403).json({ error: 'Cannot create for other employees' });
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // Invia email agli admin quando qualcuno crea una richiesta.
    // NB: la condizione NON è più `!isAdmin`. `isAdmin` serve a decidere chi può
    // scrivere e include i ruoli 'senior' e 'mini_admin': di conseguenza le
    // richieste di Mercedes e Martina (entrambe 'senior') non generavano nessuna
    // email. Qui conta solo se chi richiede è l'amministratore stesso.
    if (role !== 'admin') {
      try {
        const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${body.employee_id}&select=id,profile:profiles(full_name)`, { headers });
        const empRows = await empRes.json();
        const empName = esc(empRows?.[0]?.profile?.full_name || 'Dipendente');
        const typeLabel = { ferie:'🏖 Ferie', permesso:'🕐 Permesso', malattia:'🤒 Malattia' }[body.type] || body.type;
        const fmtDate = (d) => { const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`; };
        const row = Array.isArray(data) ? data[0] : data;
        const html = `
          <h3 style="margin:0 0 14px;color:#1a2744">🏖 Nuova richiesta — ${empName}</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:7px 0;color:#6b7280;width:120px">Dipendente</td><td style="font-weight:700">${empName}</td></tr>
            <tr><td style="padding:7px 0;color:#6b7280">Tipo</td><td>${typeLabel}</td></tr>
            <tr><td style="padding:7px 0;color:#6b7280">Dal</td><td><strong>${fmtDate(body.date_from)}</strong></td></tr>
            <tr><td style="padding:7px 0;color:#6b7280">Al</td><td><strong>${fmtDate(body.date_to)}</strong></td></tr>
            <tr><td style="padding:7px 0;color:#6b7280">Giorni</td><td><strong>${body.days}</strong></td></tr>
            ${body.note_employee ? `<tr><td style="padding:7px 0;color:#6b7280">Nota</td><td>${esc(body.note_employee)}</td></tr>` : ''}
          </table>
          <p style="text-align:center;margin-top:24px">
            <a href="https://portal.indubai.it/ferie.html" style="background:#1a2744;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Approva o Rifiuta</a>
          </p>`;
        const { ids: adminIds, to } = await getAdminRecipients();
        if (!to.length) {
          console.error('[leave-requests] nessun destinatario per la richiesta', row?.id);
        }

        await Promise.all([
          // Email agli admin (un solo invio, destinatari deduplicati)
          ...(to.length ? [fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to,
              subject: `🏖 Nuova richiesta ${typeLabel} — ${empName}`,
              html,
              event_type: 'leave_request_new',
              entity_id: row?.id || null,
              entity_type: 'leave',
            }),
          }).then(async r => {
            if (!r.ok) console.error('[leave-requests] send-email', r.status, await r.text().catch(() => ''));
          })] : []),
          // Notifica in-app (campanella del portale) per ogni admin
          ...adminIds.map(adminId => fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              user_id: adminId,
              type: 'leave_request_new',
              title: `Nuova richiesta ${row?.type || body.type} — ${empName}`,
              body: `${fmtDate(body.date_from)} → ${fmtDate(body.date_to)} · ${body.days} giorni`,
              link: '/ferie.html',
              entity_type: 'leave',
              entity_id: row?.id || null,
            }),
          }).then(async r => {
            if (!r.ok) console.error('[leave-requests] notification', adminId, r.status, await r.text().catch(() => ''));
          })),
        ]);
      } catch (e) { console.error('[leave-requests] notifica admin fallita:', e.message); }
    }

    return res.status(201).json(data);
  }

  // PATCH — update leave request (approve/reject)
  if (req.method === 'PATCH') {
    if (!isAdmin) return res.status(403).json({ error: 'Admin only', role, callerId });
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(updates),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // Invia email al dipendente quando la richiesta viene approvata/rifiutata
    if (updates.status === 'approved' || updates.status === 'rejected') {
      try {
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.employee_id) {
          const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${row.employee_id}&select=profile_id,profile:profiles(full_name)`, { headers });
          const empRows = await empRes.json();
          const emp = empRows?.[0];
          if (emp?.profile_id) {
            const approved = updates.status === 'approved';
            const icon = approved ? '✅' : '❌';
            const label = approved ? 'approvata' : 'rifiutata';
            const typeLabel = { ferie:'🏖 Ferie', permesso:'🕐 Permesso', malattia:'🤒 Malattia' }[row.type] || row.type;
            const fmtDate = (d) => { const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`; };
            const html = `
              <h3 style="margin:0 0 14px;color:#1a2744">${icon} Richiesta ${label}</h3>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:7px 0;color:#6b7280;width:120px">Tipo</td><td>${typeLabel}</td></tr>
                <tr><td style="padding:7px 0;color:#6b7280">Dal</td><td><strong>${fmtDate(row.date_from)}</strong></td></tr>
                <tr><td style="padding:7px 0;color:#6b7280">Al</td><td><strong>${fmtDate(row.date_to)}</strong></td></tr>
                <tr><td style="padding:7px 0;color:#6b7280">Giorni</td><td><strong>${row.days}</strong></td></tr>
                ${updates.note_admin ? `<tr><td style="padding:7px 0;color:#6b7280">Nota admin</td><td>${esc(updates.note_admin)}</td></tr>` : ''}
              </table>
              <p style="text-align:center;margin-top:24px">
                <a href="https://portal.indubai.it/ferie.html" style="background:#1a2744;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Vedi le tue ferie</a>
              </p>`;
            await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: emp.profile_id,
                subject: `${icon} Richiesta ${row.type} ${label} — ${fmtDate(row.date_from)} → ${fmtDate(row.date_to)}`,
                html,
                event_type: approved ? 'leave_request_approved' : 'leave_request_rejected',
                entity_id: row.id,
                entity_type: 'leave',
              }),
            });
          }
        }
      } catch (e) { console.error('[leave-requests] email to employee failed:', e.message); }
    }

    return res.status(200).json(data);
  }

  // DELETE — remove leave request
  if (req.method === 'DELETE') {
    if (!isAdmin) return res.status(403).json({ error: 'Admin only', role, callerId });
    const requestId = req.query.id || req.body?.id;
    if (!requestId) return res.status(400).json({ error: 'id required' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests?id=eq.${requestId}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
    });
    if (!r.ok) return res.status(400).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
