/**
 * /api/ambassador-apply
 *
 * Endpoint pubblico della landing /diventa-ambassador.
 *
 *  POST { full_name, email, phone, city, instagram, tiktok, other_social,
 *         niche, audience, message, website (honeypot) }
 *
 * Registra la candidatura, avvisa segreteria + staff e manda al candidato
 * la guida al programma. Non crea nessun ambassador e non promette nulla:
 * l'accesso lo crea lo studio da /ambassadors.html dopo la valutazione.
 *
 * Gira con service role: la landing e' pubblica e l'anon key non ha (ne' deve
 * avere) permessi di scrittura su ambassador_applications.
 */

import {
  sbSelect, sbInsert, sendEmail, notifyStaff,
  escapeHtml, PORTAL_URL, SEGRETERIA_EMAIL,
} from './_ambassador-lib.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Ripulisce un campo di testo: niente HTML, lunghezza massima. */
const field = (v, max = 160) => String(v ?? '').trim().slice(0, max) || null;

/** Normalizza un handle social: accetta @nome, nome, o l'URL completo. */
function handle(v, max = 120) {
  let s = field(v, max);
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?/i, '');
  return s.slice(0, max);
}

/** Link cliccabile a un profilo social, per l'email allo staff. */
function socialLink(value, base) {
  if (!value) return '—';
  const clean = value.replace(/^@/, '');
  const url = /\//.test(value) ? `https://${value}` : `https://${base}/${clean}`;
  return `<a href="${escapeHtml(url)}" style="color:#16a34a">${escapeHtml(value)}</a>`;
}

/**
 * Email al candidato: come funziona il programma e cosa succede adesso.
 * Esportata a parte così si può renderizzare per un invio di prova.
 */
export function applicantGuideEmail({ firstName }) {
  const step = (n, title, body) => `
    <tr>
      <td style="padding:0 14px 18px 0;vertical-align:top;width:34px">
        <div style="width:28px;height:28px;border-radius:50%;background:#47ee74;color:#14161a;
                    font-weight:800;font-size:14px;text-align:center;line-height:28px">${n}</div>
      </td>
      <td style="padding:0 0 18px;vertical-align:top">
        <div style="font-weight:700;color:#14161a;font-size:15px;margin-bottom:3px">${title}</div>
        <div style="color:#4b5563;font-size:14px;line-height:1.6">${body}</div>
      </td>
    </tr>`;

  return `
    <h2 style="margin:0 0 14px;color:#14161a;font-size:22px">
      Grazie ${escapeHtml(firstName)}, abbiamo ricevuto la tua candidatura
    </h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 22px">
      Il programma Brand Ambassador InDubai e' a <strong>numero chiuso</strong> e ogni candidatura
      viene letta una per una. Qui sotto trovi come funziona, così arrivi alla call sapendo già tutto.
    </p>

    <div style="height:1px;background:#e7e4dc;margin:0 0 22px"></div>

    <div style="font-weight:800;color:#14161a;font-size:13px;letter-spacing:.08em;
                text-transform:uppercase;margin:0 0 16px">Come funziona</div>
    <table style="width:100%;border-collapse:collapse">
      ${step(1, 'La tua candidatura e\' in valutazione',
        'Guardiamo il tuo profilo social, il tono con cui comunichi, il tipo di pubblico che ti segue e il settore in cui ti muovi.')}
      ${step(2, 'Ti contattiamo noi',
        'Se il profilo e\' in linea con il programma ti scriviamo per fissare una videochiamata. Parli direttamente con il titolare dello studio, senza commerciali in mezzo.')}
      ${step(3, 'Ricevi la proposta',
        'Al termine della call ti presentiamo una proposta di collaborazione costruita sul tuo profilo e sul tuo pubblico.')}
      ${step(4, 'Entri nel programma',
        'Ricevi il tuo link personale e un\'area riservata dove segui in tempo reale le persone che hai segnalato e le commissioni maturate.')}
    </table>

    <div style="background:#f7f6f2;border-left:3px solid #47ee74;padding:16px 18px;margin:6px 0 22px">
      <div style="font-weight:700;color:#14161a;font-size:14px;margin-bottom:5px">E\' una collaborazione retribuita</div>
      <div style="color:#4b5563;font-size:14px;line-height:1.6">
        Nessuno scambio merce, nessun contenuto a gratis. Guadagni su tutti i servizi del gruppo,
        non su una singola campagna, e non c\'e\' un tetto massimo. I numeri li vediamo insieme in
        videochiamata: preferiamo dirteli guardandoti in faccia.
      </div>
    </div>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px">
      <strong>Cosa succede adesso:</strong> lo studio valuta il tuo profilo e ti contatta.
      Non devi fare altro. Se nel frattempo hai domande, rispondi a questa email o scrivi a
      <a href="mailto:${escapeHtml(SEGRETERIA_EMAIL)}" style="color:#16a34a">${escapeHtml(SEGRETERIA_EMAIL)}</a>.
    </p>

    <p style="color:#6b7280;font-size:13px;margin:0">
      InDubai — Platinum Tower, Unit 2503, JLT, Dubai
    </p>`;
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const b = req.body || {};

    // Honeypot: i bot compilano tutti i campi, gli umani non vedono questo.
    if (b.website) return res.status(200).json({ ok: true });

    const full_name = field(b.full_name, 120);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 160);

    if (!full_name || full_name.length < 2) {
      return res.status(400).json({ error: 'Inserisci nome e cognome' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Controlla l\'indirizzo email' });
    }

    const instagram = handle(b.instagram);
    const tiktok = handle(b.tiktok);
    const other_social = field(b.other_social, 300);
    if (!instagram && !tiktok && !other_social) {
      return res.status(400).json({ error: 'Indica almeno un profilo social' });
    }

    const row = {
      full_name,
      email,
      phone: field(b.phone, 40),
      city: field(b.city, 80),
      instagram,
      tiktok,
      other_social,
      niche: field(b.niche, 120),
      audience: field(b.audience, 400),
      message: field(b.message, 1500),
      status: 'nuova',
      source: 'landing',
    };

    // Stessa persona che si ricandida: teniamo tutto, lo staff vede lo storico.
    const application = await sbInsert('ambassador_applications', row);

    // ── Email a segreteria + staff ──
    const line = (k, v) =>
      `<tr><td style="padding:7px 14px 7px 0;color:#6b7280;font-size:13px;width:150px;vertical-align:top">${k}</td>
           <td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600">${v}</td></tr>`;

    const precedenti = await sbSelect('ambassador_applications',
      `email=eq.${encodeURIComponent(email)}&select=id&order=created_at.desc`).catch(() => []);

    await notifyStaff({
      subject: `⭐ Nuova candidatura ambassador — ${full_name}`,
      html: `
        <div style="display:inline-block;background:#e5fbec;color:#16a34a;font-weight:700;font-size:11px;
                    letter-spacing:1px;text-transform:uppercase;padding:5px 10px;border-radius:6px;margin-bottom:14px">
          Candidatura Ambassador
        </div>
        <h2 style="margin:0 0 6px;color:#14161a;font-size:20px">${escapeHtml(full_name)}</h2>
        <p style="color:#374151;font-size:14px;margin:0 0 16px">
          Arrivata dalla landing pubblica.${precedenti?.length > 1
            ? ` <strong>Attenzione: si era già candidato ${precedenti.length - 1} volta/e con questa email.</strong>`
            : ''}
        </p>
        <table style="width:100%;border-collapse:collapse">
          ${line('Email', `<a href="mailto:${escapeHtml(email)}" style="color:#16a34a">${escapeHtml(email)}</a>`)}
          ${line('Telefono', escapeHtml(row.phone || '—'))}
          ${line('Dove vive', escapeHtml(row.city || '—'))}
          ${line('Instagram', socialLink(instagram, 'instagram.com'))}
          ${line('TikTok', socialLink(tiktok, 'tiktok.com/@'))}
          ${line('Altri canali', escapeHtml(other_social || '—'))}
          ${line('Settore', escapeHtml(row.niche || '—'))}
          ${line('Il suo pubblico', escapeHtml(row.audience || '—'))}
        </table>
        ${row.message ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f7f6f2;border-radius:8px;
                           color:#374151;font-size:14px;font-style:italic">"${escapeHtml(row.message)}"</p>` : ''}
        <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:18px 0 0">
          Il candidato ha ricevuto la guida al programma e sa che lo contattate voi.
          Nessun accesso è stato creato: se il profilo va bene, crea l'ambassador dal portale.
        </p>
        <p style="text-align:center;margin-top:26px">
          <a href="${PORTAL_URL}/ambassadors" style="background:#14161a;color:#47ee74;padding:12px 28px;
             border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">Vedi le candidature</a>
        </p>`,
      event_type: 'ambassador_application',
      entity_id: application.id,
      entity_type: 'ambassador_application',
    });

    // ── Guida al candidato ──
    await sendEmail({
      to: email,
      subject: 'Candidatura ricevuta — come funziona il programma Brand Ambassador InDubai',
      html: applicantGuideEmail({ firstName: full_name.split(' ')[0] }),
      event_type: 'ambassador_application_ack',
      entity_id: application.id,
      entity_type: 'ambassador_application',
    });

    return res.status(200).json({ ok: true, application_id: application.id });
  } catch (e) {
    console.error('[ambassador-apply]', e);
    return res.status(500).json({ error: 'Non siamo riusciti a registrare la candidatura. Riprova.' });
  }
}
