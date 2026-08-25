/**
 * /api/create-ambassador-user   (solo staff loggato)
 *
 * POST { ambassador_id, email, password }
 *
 * Crea l'utente Supabase per un ambassador già presente in anagrafica,
 * forza profiles.role = 'ambassador', collega ambassadors.user_id e invia
 * l'email con credenziali e link personale.
 */

import {
  SUPABASE_URL, SB_HEADERS, sbSelect, sbUpdate, sendEmail, requireStaff,
  escapeHtml, PORTAL_URL, AMBASSADOR_LOGIN_URL,
} from './_ambassador-lib.js';

function welcomeEmail({ name, email, password, refLink }) {
  return `
    <h2 style="margin:0 0 14px;color:#14161a;font-size:22px">Benvenuta/o nel programma Ambassador</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 14px">
      Ciao ${escapeHtml(name.split(' ')[0])}, il tuo accesso all'area riservata InDubai è attivo.
      Da li' vedi in tempo reale le persone che hai segnalato, quelle diventate clienti e le commissioni maturate.
    </p>

    <div style="background:#14161a;border-radius:12px;padding:22px 24px;margin:24px 0">
      <p style="color:#47ee74;margin:0 0 14px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">
        Le tue credenziali
      </p>
      <p style="color:white;margin:0 0 6px;font-size:15px">
        <span style="color:#9ca3af;font-size:13px">Email &nbsp;&nbsp;&nbsp;&nbsp;</span> ${escapeHtml(email)}
      </p>
      <p style="color:white;margin:0 0 16px;font-size:15px">
        <span style="color:#9ca3af;font-size:13px">Password</span> ${escapeHtml(password)}
      </p>
      <a href="${AMBASSADOR_LOGIN_URL}" style="display:inline-block;background:#47ee74;color:#14161a;
         text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:700;font-size:14px">
        Accedi all'area ambassador
      </a>
    </div>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 10px"><strong>Il tuo link personale</strong></p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 10px">
      Questo è il link da dare a chi ti chiede informazioni sui nostri servizi. Chi lo compila viene
      registrato automaticamente come tua segnalazione.
    </p>
    <p style="margin:0 0 22px;padding:14px 16px;background:#f7f6f2;border-left:3px solid #47ee74;
              border-radius:0 8px 8px 0;font-family:monospace;font-size:14px;word-break:break-all">
      <a href="${refLink}" style="color:#14161a;text-decoration:none">${refLink}</a>
    </p>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 6px"><strong>Come funziona</strong></p>
    <ol style="color:#374151;font-size:15px;line-height:1.8;margin:0 0 18px;padding-left:20px">
      <li>Condividi il link con chi è interessato ai nostri servizi.</li>
      <li>La persona compila il modulo e riceve la chiamata di consulenza da noi.</li>
      <li>Se diventa cliente, ti arriva una email con la commissione maturata.</li>
      <li>Trovi tutto sempre aggiornato nella tua area riservata.</li>
    </ol>

    <p style="color:#6b7280;font-size:13px;line-height:1.7;margin:0">
      Ti consigliamo di cambiare la password al primo accesso.<br>
      InDubai — Platinum Tower, Unit 2503, JLT, Dubai
    </p>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireStaff(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { ambassador_id, email, password } = req.body || {};
  if (!ambassador_id || !email || !password) {
    return res.status(400).json({ error: 'ambassador_id, email e password sono obbligatori' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
  }

  try {
    const rows = await sbSelect('ambassadors',
      `id=eq.${ambassador_id}&select=id,full_name,ref_code,user_id`);
    const amb = rows?.[0];
    if (!amb) return res.status(404).json({ error: 'Ambassador non trovato' });
    if (amb.user_id) return res.status(400).json({ error: 'Questo ambassador ha già un accesso attivo' });

    // 1. Utente auth (email_confirm: niente email di conferma da Supabase)
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({
        email, password, email_confirm: true,
        user_metadata: { full_name: amb.full_name, role: 'ambassador' },
      }),
    });
    const created = await createRes.json();
    if (!created.id) {
      return res.status(400).json({
        error: created.message || created.msg || created.error_description || 'Creazione utente fallita',
      });
    }

    // 2. Il trigger crea il profilo con ruolo di default: lo forziamo a 'ambassador'
    await new Promise(r => setTimeout(r, 1500));
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ full_name: amb.full_name, role: 'ambassador' }),
    });

    // 3. Collega l'utente all'anagrafica ambassador
    try {
      await sbUpdate('ambassadors', `id=eq.${amb.id}`, { user_id: created.id, email, updated_at: new Date().toISOString() });
    } catch (e) {
      // Rollback: senza collegamento l'utente non vedrebbe nulla
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: SB_HEADERS });
      return res.status(400).json({ error: 'Collegamento ambassador fallito: ' + e.message });
    }

    // 4. Email di benvenuto con credenziali e link personale
    await sendEmail({
      to: email,
      subject: 'Il tuo accesso Ambassador InDubai è pronto',
      html: welcomeEmail({
        name: amb.full_name, email, password,
        refLink: `${PORTAL_URL}/r/${amb.ref_code}`,
      }),
      event_type: 'ambassador_welcome',
      entity_id: amb.id,
      entity_type: 'ambassador',
    });

    return res.status(200).json({ ok: true, user_id: created.id });
  } catch (e) {
    console.error('[create-ambassador-user]', e);
    return res.status(500).json({ error: e.message || 'Errore interno' });
  }
}
