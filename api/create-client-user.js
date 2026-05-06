const SUPABASE_URL = 'https://gvdoqcgkzbziqufahhxh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';
const PORTAL_URL = 'https://portal.indubai.it/client-portal/login.html';
const APP_STORE_URL = 'https://apps.apple.com/ae/app/indubai-portal/id6760120859';

function buildWelcomeEmail(email, password) {
  return `
<h2 style="color:#1a2744;margin:0 0 20px;font-size:22px">Benvenuto su InDubai</h2>

<p style="color:#374151;line-height:1.7;margin:0 0 14px">Gentile cliente,</p>

<p style="color:#374151;line-height:1.7;margin:0 0 14px">
  Siamo lieti di comunicarti che la nostra app <strong>InDubai</strong> è finalmente disponibile su <strong>App Store</strong>.
  Puoi scaricarla gratuitamente cliccando il pulsante qui sotto.
</p>

<div style="text-align:center;margin:28px 0">
  <a href="${APP_STORE_URL}"
     style="display:inline-block;background:#1a2744;color:#c9a84c;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.3px">
    Scarica su App Store
  </a>
</div>

<div style="background:#fffbf0;border-left:4px solid #c9a84c;padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0">
  <p style="margin:0 0 8px;font-weight:700;color:#1a2744;font-size:14px">Hai un Android?</p>
  <p style="margin:0;color:#374151;line-height:1.7;font-size:14px">
    InDubai è disponibile anche come web app. Apri il link di accesso qui sotto dal tuo browser Chrome,
    tocca i tre puntini in alto a destra e seleziona <strong>"Aggiungi alla schermata Home"</strong>.
    In pochi secondi avrai l'icona dell'app direttamente sul tuo telefono.
  </p>
</div>

<div style="background:#1a2744;border-radius:10px;padding:22px 24px;margin:28px 0">
  <p style="color:#c9a84c;margin:0 0 14px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">Le tue credenziali di accesso</p>
  <p style="color:white;margin:0 0 8px;font-size:15px"><span style="color:#9ca3af;font-size:13px">Email &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> ${email}</p>
  <p style="color:white;margin:0 0 8px;font-size:15px"><span style="color:#9ca3af;font-size:13px">Password</span> ${password}</p>
  <p style="margin:16px 0 0">
    <a href="${PORTAL_URL}"
       style="display:inline-block;background:#c9a84c;color:#1a2744;text-decoration:none;padding:10px 22px;border-radius:6px;font-weight:700;font-size:14px">
      Accedi al portale
    </a>
  </p>
</div>

<p style="color:#374151;line-height:1.7;margin:0 0 14px">
  Questo è solo l'inizio! L'app si migliorerà nel tempo con tante nuove funzioni pensate appositamente per te.
</p>

<p style="color:#374151;line-height:1.7;margin:0">
  Grazie per aver scelto InDubai. Siamo a tua disposizione per qualsiasi domanda.<br><br>
  <strong>Team InDubai</strong>
</p>`;
}

async function sendWelcomeEmail(email, password) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: email,
        subject: 'Scarica l\'app InDubai — Le tue credenziali di accesso sono pronte!',
        html: buildWelcomeEmail(email, password),
        event_type: 'client_welcome',
      }),
    });
  } catch (_) { /* non bloccante */ }
}

const SB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, client_id, company_name } = req.body;
  if (!email || !password || !client_id) return res.status(400).json({ error: 'Missing fields' });

  // 1. Create auth user (email_confirm: true = no email confirmation needed)
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: company_name || email, role: 'client' }
    })
  });

  const created = await createRes.json();
  if (!created.id) {
    return res.status(400).json({ error: created.message || created.msg || created.error_description, raw: created, status: createRes.status });
  }

  // 2. Wait for trigger to fire (creates profile row)
  await new Promise(r => setTimeout(r, 1500));

  // 3. Force profile role=client with PATCH (overrides trigger default)
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${created.id}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ full_name: company_name || email, role: 'client' })
  });

  // 4. Insert into client_users
  const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/client_users`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: created.id, client_id })
  });

  if (!linkRes.ok) {
    const linkErr = await linkRes.json();
    // Rollback: delete user
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: SB_HEADERS });
    return res.status(400).json({ error: linkErr.message || 'Errore collegamento cliente' });
  }

  // 5. Send welcome email with credentials
  await sendWelcomeEmail(email, password);

  return res.status(200).json({ id: created.id });
}
