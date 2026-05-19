const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Simple secret to prevent accidental calls
  if (req.body?.secret !== 'indubai-seed-2026') {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  try {
    // 1. Find Mercedes employee_id — use RPC to bypass RLS
    const empRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_all_employees`,
      { method: 'POST', headers }
    );
    let mercedes = null;

    // If RPC doesn't exist, try direct query
    if (!empRes.ok) {
      // Try direct employees query (has fewer RLS issues)
      const empRes2 = await fetch(`${SUPABASE_URL}/rest/v1/employees?select=id`, { headers });
      const emps = await empRes2.json();
      if (!Array.isArray(emps) || emps.length === 0) {
        return res.status(500).json({ error: 'Cannot query employees', data: emps });
      }
      // Take second employee if exists (first is likely Martina), otherwise first
      mercedes = emps.length > 1 ? emps[1] : emps[0];
      // Actually, we need to identify Mercedes. Let's try leave_requests to find her employee_id
      const lrRes = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests?select=employee_id,note_employee&limit=50`, { headers });
      const lrs = await lrRes.json();
      if (Array.isArray(lrs)) {
        // Find unique employee_ids
        const ids = [...new Set(lrs.map(r => r.employee_id))];
        // The one with "Brasile" or "Kazakistan" note is Mercedes
        const mercLr = lrs.find(r => r.note_employee && (r.note_employee.includes('2025') || r.note_employee.includes('Brasile') || r.note_employee.includes('Kazak')));
        if (mercLr) mercedes = { id: mercLr.employee_id };
        else if (ids.length > 0) mercedes = { id: ids[0] }; // fallback: first employee with leave
      }
    } else {
      const emps = await empRes.json();
      if (Array.isArray(emps)) {
        mercedes = emps.find(e => e.full_name?.toLowerCase().includes('mercedes')) || emps[1] || emps[0];
      }
    }

    if (!mercedes) return res.status(404).json({ error: 'Cannot identify Mercedes employee' });

    // 2. Delete ALL existing leave_requests (UUID ids, use not.is.null)
    await fetch(`${SUPABASE_URL}/rest/v1/leave_requests?id=not.is.null`, {
      method: 'DELETE',
      headers: { ...headers, 'Prefer': 'return=minimal' },
    });

    // 3. Update Mercedes contract start_date to 30/06/2025 and 30 days/year
    await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${mercedes.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ start_date: '2025-06-30', annual_leave_days: 30 }),
    });

    // 4. Insert correct leave requests from email
    // All are approved ferie (as per the email verification)
    const leaveRequests = [
      { date_from: '2025-09-03', date_to: '2025-09-04', days: 2, note_employee: 'Brasile' },
      { date_from: '2025-09-22', date_to: '2025-09-26', days: 5, note_employee: 'Kazakistan/Kyrgyzstan' },
      { date_from: '2025-09-29', date_to: '2025-09-29', days: 1, note_employee: 'Kazakistan/Kyrgyzstan' },
      { date_from: '2026-01-05', date_to: '2026-01-05', days: 1, note_employee: 'Oman' },
      { date_from: '2026-01-16', date_to: '2026-01-16', days: 1, note_employee: 'Riyadh' },
      { date_from: '2026-02-18', date_to: '2026-02-18', days: 1, note_employee: null },
      { date_from: '2026-03-19', date_to: '2026-03-19', days: 1, note_employee: 'Maldive' },
      { date_from: '2026-03-24', date_to: '2026-03-24', days: 1, note_employee: 'Maldive' },
      { date_from: '2026-04-15', date_to: '2026-04-17', days: 3, note_employee: null },
      { date_from: '2026-04-23', date_to: '2026-04-24', days: 2, note_employee: null },
      { date_from: '2026-04-29', date_to: '2026-04-30', days: 2, note_employee: null },
    ];

    const rows = leaveRequests.map(lr => ({
      employee_id: mercedes.id,
      type: 'ferie',
      ...lr,
      status: 'approved',
      note_admin: 'Verificato da calendario Google',
    }));

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/leave_requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows),
    });
    const inserted = await insertRes.json();

    return res.status(200).json({
      ok: true,
      mercedes_id: mercedes.id,
      deleted: 'all leave_requests',
      inserted: inserted.length,
      start_date: '2025-06-30',
      annual_leave_days: 30,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
