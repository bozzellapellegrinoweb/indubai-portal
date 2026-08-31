/**
 * /api/ambassador-lead
 *
 * Endpoint pubblico del form di segnalazione (link /r/<ref_code>).
 *
 *  GET  ?code=<ref_code>  -> dati dell'ambassador + elenco servizi (senza prezzi)
 *  POST { code, full_name, email, phone, service_id, message, website }
 *       -> crea la segnalazione, crea il cliente in pipeline "Non assegnati"
 *          con etichetta referral, avvisa segreteria + ambassador + lead.
 *
 * Gira con service role: l'anon key non ha (e non deve avere) permessi di
 * scrittura su ambassador_referrals e clients.
 */

import {
  sbSelect, sbInsert, sbUpdate, sendEmail, notifyStaff,
  escapeHtml, PORTAL_URL, AMBASSADOR_LOGIN_URL, BOOKING_URL,
} from './_ambassador-lib.js';

/**
 * Conferma alla lead che ha compilato il modulo.
 * Esportata a parte così si può renderizzare per un invio di prova.
 */
export function leadAckEmail({ firstName, serviceName }) {
  return `
    <h2 style="margin:0 0 14px;color:#14161a;font-size:22px">Grazie ${escapeHtml(firstName)}</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 14px">
      Abbiamo ricevuto la tua richiesta di consulenza${serviceName ? ` per <strong>${escapeHtml(serviceName)}</strong>` : ''}.
      Un consulente InDubai ti contatta entro un giorno lavorativo.
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">
      <strong>Se preferisci non aspettare, scegli tu l'orario.</strong> Qui sotto trovi il calendario di
      Pellegrino Bozzella, titolare dello studio: prenoti in trenta secondi e la call è confermata.
    </p>

    <div style="text-align:center;margin:26px 0 14px">
      <a href="${BOOKING_URL}"
         style="display:inline-block;background:#47ee74;color:#14161a;text-decoration:none;
                padding:15px 36px;border-radius:8px;font-weight:700;font-size:16px">
        Prenota la tua call
      </a>
    </div>
    <p style="text-align:center;color:#6b7280;font-size:13px;margin:0 0 24px">
      Non funziona il pulsante? Apri
      <a href="${BOOKING_URL}" style="color:#16a34a">pellegrinobozzella.com/prenota</a>
    </p>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px">
      Se nel frattempo hai domande o documenti da mandarci, scrivi a
      <a href="mailto:segreteria@indubai.it" style="color:#16a34a">segreteria@indubai.it</a>.
    </p>
    <p style="color:#6b7280;font-size:13px;margin:0">
      InDubai — Platinum Tower, Unit 2503, JLT, Dubai
    </p>`;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function setCors(res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function findAmbassador(code) {
  const clean = String(code || '').trim().toLowerCase().slice(0, 60);
  if (!/^[a-z0-9-]{3,60}$/.test(clean)) return null;
  const rows = await sbSelect('ambassadors',
    `ref_code=eq.${encodeURIComponent(clean)}&select=id,full_name,email,user_id,status,commission_multiplier&limit=1`);
  const amb = rows?.[0];
  return amb && amb.status === 'active' ? amb : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: dati per renderizzare il form ──────────────────────────────────
    if (req.method === 'GET') {
      const amb = await findAmbassador(req.query.code);
      if (!amb) return res.status(404).json({ error: 'Link non valido o non più attivo' });
      const services = await sbSelect('ambassador_services',
        'active=eq.true&select=id,name,description&order=position.asc');
      return res.status(200).json({
        ambassador: { full_name: amb.full_name },
        services: services || [],
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ── POST: nuova segnalazione ────────────────────────────────────────────
    const b = req.body || {};

    // Honeypot: i bot compilano tutti i campi, gli umani non vedono questo.
    if (b.website) return res.status(200).json({ ok: true });

    const amb = await findAmbassador(b.code);
    if (!amb) return res.status(404).json({ error: 'Link non valido o non più attivo' });

    const full_name = String(b.full_name || '').trim().slice(0, 120);
    const email     = String(b.email || '').trim().toLowerCase().slice(0, 160);
    const phone     = String(b.phone || '').trim().slice(0, 40) || null;
    const message   = String(b.message || '').trim().slice(0, 1000) || null;
    const service_id = /^[0-9a-f-]{36}$/i.test(b.service_id || '') ? b.service_id : null;

    if (full_name.length < 2) return res.status(400).json({ error: 'Inserisci nome e cognome' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email non valida' });

    let service = null;
    if (service_id) {
      const rows = await sbSelect('ambassador_services', `id=eq.${service_id}&select=id,name`);
      service = rows?.[0] || null;
    }

    // 1. Segnalazione
    const referral = await sbInsert('ambassador_referrals', {
      ambassador_id: amb.id,
      service_id: service?.id || null,
      full_name, email, phone, message,
      status: 'nuovo',
      source: 'form',
    });

    // 2. Cliente in pipeline, colonna "Non assegnati" (pipeline_stage_id = null).
    //    in_bilancio = false: è ancora una lead, non deve sporcare i report finanziari.
    let client = null;
    try {
      client = await sbInsert('clients', {
        company_name: full_name,
        contact_name: full_name,
        email,
        phone_uae: phone,
        is_active: true,
        in_bilancio: false,
        pipeline_stage_id: null,
        ambassador_id: amb.id,
        ambassador_referral_id: referral.id,
        notes: `Lead referral — segnalata da ${amb.full_name}`
          + (service ? ` · Servizio richiesto: ${service.name}` : '')
          + (message ? `\n\n"${message}"` : ''),
      });
      await sbUpdate('ambassador_referrals', `id=eq.${referral.id}`, { client_id: client.id });
    } catch (e) {
      // La segnalazione resta comunque registrata: il cliente si crea a mano.
      console.error('[ambassador-lead] creazione cliente fallita:', e.message);
    }

    // 3. Email a segreteria + staff
    const rows = [
      ['Nome', full_name],
      ['Email', email],
      ['Telefono', phone || '—'],
      ['Servizio', service?.name || 'Non specificato'],
      ['Segnalata da', `${amb.full_name} (ambassador)`],
    ].map(([k, v]) =>
      `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:130px">${k}</td>
           <td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600">${escapeHtml(v)}</td></tr>`
    ).join('');

    await notifyStaff({
      subject: `🤝 Nuova richiesta di consulenza — referral di ${amb.full_name}`,
      html: `
        <div style="display:inline-block;background:#e5fbec;color:#16a34a;font-weight:700;font-size:11px;
                    letter-spacing:1px;text-transform:uppercase;padding:5px 10px;border-radius:6px;margin-bottom:14px">
          Referral Ambassador
        </div>
        <h2 style="margin:0 0 6px;color:#14161a;font-size:20px">Nuova richiesta di consulenza</h2>
        <p style="color:#374151;font-size:14px;margin:0 0 16px">
          Arrivata dal link di <strong>${escapeHtml(amb.full_name)}</strong>. La trovi in pipeline nella
          colonna <strong>Non assegnati</strong> con l'etichetta referral.
        </p>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        ${message ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f7f6f2;border-radius:8px;
                       color:#374151;font-size:14px;font-style:italic">"${escapeHtml(message)}"</p>` : ''}
        <p style="text-align:center;margin-top:26px">
          <a href="${PORTAL_URL}/pipeline" style="background:#14161a;color:#47ee74;padding:12px 28px;
             border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">Apri la Pipeline</a>
        </p>`,
      event_type: 'ambassador_new_referral',
      entity_id: referral.id,
      entity_type: 'ambassador_referral',
    });

    // 4. Conferma all'ambassador
    if (amb.user_id || amb.email) {
      await sendEmail({
        user_id: amb.user_id || undefined,
        to: amb.user_id ? undefined : amb.email,
        subject: `✅ Segnalazione registrata: ${full_name}`,
        html: `
          <h2 style="margin:0 0 12px;color:#14161a;font-size:20px">Segnalazione registrata</h2>
          <p style="color:#374151;font-size:15px;line-height:1.7">
            Ciao ${escapeHtml(amb.full_name.split(' ')[0])}, abbiamo ricevuto la richiesta di
            <strong>${escapeHtml(full_name)}</strong>${service ? ` per <strong>${escapeHtml(service.name)}</strong>` : ''}.
          </p>
          <p style="color:#374151;font-size:15px;line-height:1.7">
            La contattiamo noi per la consulenza. Se diventa cliente ricevi una email con la commissione maturata:
            trovi tutto aggiornato nella tua area riservata.
          </p>
          <p style="text-align:center;margin-top:26px">
            <a href="${AMBASSADOR_LOGIN_URL}" style="background:#47ee74;color:#14161a;padding:12px 28px;
               border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">Apri la tua area</a>
          </p>`,
        event_type: 'ambassador_referral_ack',
        entity_id: referral.id,
        entity_type: 'ambassador_referral',
      });
    }

    // 5. Conferma alla lead
    await sendEmail({
      to: email,
      subject: 'Richiesta ricevuta — prenota la tua call con InDubai',
      html: leadAckEmail({
        firstName: full_name.split(' ')[0],
        serviceName: service?.name || null,
      }),
      event_type: 'ambassador_lead_ack',
      entity_id: referral.id,
      entity_type: 'ambassador_referral',
    });

    return res.status(200).json({ ok: true, referral_id: referral.id, client_id: client?.id || null });
  } catch (e) {
    console.error('[ambassador-lead]', e);
    return res.status(500).json({ error: e.message || 'Errore interno' });
  }
}
