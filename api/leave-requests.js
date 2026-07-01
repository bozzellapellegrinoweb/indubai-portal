const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzIwNTEsImV4cCI6MjA4NzYwODA1MX0.I0hB8POnRunvGyr7XXItp8E5H70i0slG-pqxqzCOBOg';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

function decodeJWT(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
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

  // Strategy 3: check employees table (any employee → treat as admin for this small team)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/employees?profile_id=eq.${userId}&select=id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (res.ok) {
      const emps = await res.json();
      if (Array.isArray(emps) && emps.length > 0) return 'admin';
    }
  } catch (e) {
    console.error('[getUserRole] employees error:', e.message);
  }

  return null;
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

  const decoded = decodeJWT(token);
  const callerId = decoded?.sub;
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

    // Invia email all'admin quando un dipendente crea una richiesta
    if (!isAdmin) {
      try {
        const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${body.employee_id}&select=id,profile:profiles(full_name)`, { headers });
        const empRows = await empRes.json();
        const empName = empRows?.[0]?.profile?.full_name || 'Dipendente';
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
            ${body.note_employee ? `<tr><td style="padding:7px 0;color:#6b7280">Nota</td><td>${body.note_employee}</td></tr>` : ''}
          </table>
          <p style="text-align:center;margin-top:24px">
            <a href="https://portal.indubai.it/ferie.html" style="background:#1a2744;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Approva o Rifiuta</a>
          </p>`;
        await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: 'bozzellapellegrino@gmail.com',
            subject: `🏖 Nuova richiesta ${typeLabel} — ${empName}`,
            html,
            event_type: 'leave_request_new',
            entity_id: row?.id || null,
            entity_type: 'leave',
          }),
        });
      } catch (e) { console.error('[leave-requests] email to admin failed:', e.message); }
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
                ${updates.note_admin ? `<tr><td style="padding:7px 0;color:#6b7280">Nota admin</td><td>${updates.note_admin}</td></tr>` : ''}
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
