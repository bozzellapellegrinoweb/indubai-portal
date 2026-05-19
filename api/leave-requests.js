const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

function decodeJWT(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
}

async function getUserRole(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const profiles = await res.json();
  return profiles?.[0]?.role || null;
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

  const role = await getUserRole(callerId);
  const isAdmin = ['admin', 'mini_admin', 'senior'].includes(role);

  // GET — list leave requests
  if (req.method === 'GET') {
    const columns = req.query.columns || 'id,employee_id,type,date_from,date_to,days,status,note_employee,note_admin,created_at';
    const order = req.query.order || 'created_at.desc';
    let url = `${SUPABASE_URL}/rest/v1/leave_requests?select=${columns}&order=${order}`;

    // Non-admin: only see own requests
    if (!isAdmin) {
      const empId = await getEmployeeForUser(callerId);
      if (empId) url += `&employee_id=eq.${empId}`;
      else return res.status(200).json([]); // no employee record
    }

    const r = await fetch(url, { headers });
    const data = await r.json();
    return res.status(200).json(data);
  }

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
    return res.status(201).json(data);
  }

  // PATCH — update leave request (approve/reject)
  if (req.method === 'PATCH') {
    if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(updates),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  }

  // DELETE — remove leave request
  if (req.method === 'DELETE') {
    if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
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
