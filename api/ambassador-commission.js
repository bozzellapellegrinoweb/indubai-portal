/**
 * /api/ambassador-commission   (solo staff loggato)
 *
 *  POST { client_id, deal_amount? }        -> matura la commissione del referral
 *                                             ("Cliente ha pagato" in pipeline)
 *  POST { action:'pay',    commission_id } -> segna la commissione come pagata
 *  POST { action:'cancel', commission_id } -> annulla la commissione
 *
 * Idempotente: ambassador_commissions.referral_id è UNIQUE, quindi spostare
 * due volte lo stesso cliente nella fase vinta non duplica il guadagno.
 */

import {
  sbSelect, sbInsert, sbUpdate, sendEmail, requireStaff,
  computeCommission, formatAED, escapeHtml, AMBASSADOR_LOGIN_URL,
} from './_ambassador-lib.js';

function commissionEmail({ amb, serviceName, amount, clientName, paid }) {
  const title = paid ? 'Commissione pagata' : 'Hai guadagnato una commissione';
  const intro = paid
    ? 'Abbiamo appena liquidato la commissione qui sotto.'
    : `<strong>${escapeHtml(clientName)}</strong>, che hai segnalato tu, è diventato cliente InDubai.`;
  return `
    <div style="display:inline-block;background:#e5fbec;color:#16a34a;font-weight:700;font-size:11px;
                letter-spacing:1px;text-transform:uppercase;padding:5px 10px;border-radius:6px;margin-bottom:14px">
      ${paid ? 'Pagamento effettuato' : 'Nuova commissione'}
    </div>
    <h2 style="margin:0 0 10px;color:#14161a;font-size:22px">${title} 🎉</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px">
      Ciao ${escapeHtml((amb.full_name || '').split(' ')[0])}, ${intro}
    </p>
    <div style="background:#14161a;border-radius:12px;padding:24px;text-align:center;margin:0 0 20px">
      <p style="color:rgba(255,255,255,.55);margin:0 0 6px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase">
        ${escapeHtml(serviceName)}
      </p>
      <p style="color:#47ee74;margin:0;font-size:34px;font-weight:900;letter-spacing:-1px">
        ${formatAED(amount)}
      </p>
    </div>
    <p style="color:#374151;font-size:15px;line-height:1.7">
      Nella tua area riservata trovi il dettaglio: per quale servizio, su quale contatto e lo stato del pagamento.
    </p>
    <p style="text-align:center;margin-top:26px">
      <a href="${AMBASSADOR_LOGIN_URL}" style="background:#47ee74;color:#14161a;padding:12px 28px;
         border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">Vedi le tue commissioni</a>
    </p>`;
}

async function notifyAmbassador(ambId, { serviceName, amount, clientName, paid, commissionId }) {
  const rows = await sbSelect('ambassadors', `id=eq.${ambId}&select=full_name,email,user_id`);
  const amb = rows?.[0];
  if (!amb) return;
  await sendEmail({
    user_id: amb.user_id || undefined,
    to: amb.user_id ? undefined : amb.email,
    subject: paid
      ? `💸 Commissione pagata — ${formatAED(amount)}`
      : `🎉 Commissione maturata — ${formatAED(amount)}`,
    html: commissionEmail({ amb, serviceName, amount, clientName, paid }),
    event_type: paid ? 'ambassador_commission_paid' : 'ambassador_commission',
    entity_id: commissionId,
    entity_type: 'ambassador_commission',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireStaff(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action = 'accrue', client_id, commission_id, deal_amount } = req.body || {};

  try {
    // ── Pagamento / annullamento ──────────────────────────────────────────
    if (action === 'pay' || action === 'cancel') {
      if (!commission_id) return res.status(400).json({ error: 'commission_id mancante' });
      const patch = action === 'pay'
        ? { status: 'pagata', paid_at: new Date().toISOString() }
        : { status: 'annullata' };
      const updated = await sbUpdate('ambassador_commissions', `id=eq.${commission_id}`, patch);
      if (!updated) return res.status(404).json({ error: 'Commissione non trovata' });
      if (action === 'pay') {
        await notifyAmbassador(updated.ambassador_id, {
          serviceName: updated.service_name,
          amount: updated.commission_amount_aed,
          clientName: '',
          paid: true,
          commissionId: updated.id,
        });
      }
      return res.status(200).json({ ok: true, commission: updated });
    }

    // ── Maturazione commissione ───────────────────────────────────────────
    if (!client_id) return res.status(400).json({ error: 'client_id mancante' });

    const clients = await sbSelect('clients',
      `id=eq.${client_id}&select=id,company_name,contact_name,service_cost,ambassador_id,ambassador_referral_id`);
    const client = clients?.[0];
    if (!client) return res.status(404).json({ error: 'Cliente non trovato' });
    if (!client.ambassador_id) return res.status(200).json({ ok: true, skipped: 'no_ambassador' });

    // Gia' maturata? (idempotenza sul referral)
    if (client.ambassador_referral_id) {
      const existing = await sbSelect('ambassador_commissions',
        `referral_id=eq.${client.ambassador_referral_id}&select=*`);
      if (existing?.[0]) {
        return res.status(200).json({ ok: true, already: true, commission: existing[0] });
      }
    }

    // Servizio richiesto nella segnalazione
    let referral = null;
    if (client.ambassador_referral_id) {
      const rows = await sbSelect('ambassador_referrals',
        `id=eq.${client.ambassador_referral_id}&select=id,service_id,full_name`);
      referral = rows?.[0] || null;
    }

    let service = null;
    if (referral?.service_id) {
      const rows = await sbSelect('ambassador_services', `id=eq.${referral.service_id}&select=*`);
      service = rows?.[0] || null;
    }
    if (!service) {
      // Nessun servizio selezionato nel form: usa il primo attivo del catalogo.
      const rows = await sbSelect('ambassador_services',
        'active=eq.true&select=*&order=position.asc&limit=1');
      service = rows?.[0] || null;
    }

    const ambRows = await sbSelect('ambassadors',
      `id=eq.${client.ambassador_id}&select=id,full_name,commission_multiplier`);
    const amb = ambRows?.[0];
    if (!amb) return res.status(404).json({ error: 'Ambassador non trovato' });

    const deal = Number(deal_amount) || Number(client.service_cost) || Number(service?.price_aed) || 0;
    const amount = computeCommission(service, deal, amb.commission_multiplier);

    let commission;
    try {
      commission = await sbInsert('ambassador_commissions', {
        ambassador_id: amb.id,
        referral_id: client.ambassador_referral_id || null,
        client_id: client.id,
        service_id: service?.id || null,
        service_name: service?.name || 'Servizio InDubai',
        deal_amount_aed: deal || null,
        commission_amount_aed: amount,
        status: 'maturata',
      });
    } catch (e) {
      // Corsa fra due spostamenti simultanei: la UNIQUE ha già fatto il lavoro.
      if (/duplicate key|23505/i.test(e.message) && client.ambassador_referral_id) {
        const rows = await sbSelect('ambassador_commissions',
          `referral_id=eq.${client.ambassador_referral_id}&select=*`);
        return res.status(200).json({ ok: true, already: true, commission: rows?.[0] || null });
      }
      throw e;
    }

    if (referral) {
      await sbUpdate('ambassador_referrals', `id=eq.${referral.id}`,
        { status: 'cliente', converted_at: new Date().toISOString() });
    }

    await notifyAmbassador(amb.id, {
      serviceName: commission.service_name,
      amount,
      clientName: client.contact_name || client.company_name || referral?.full_name || 'Il tuo contatto',
      paid: false,
      commissionId: commission.id,
    });

    return res.status(200).json({ ok: true, commission });
  } catch (e) {
    console.error('[ambassador-commission]', e);
    return res.status(500).json({ error: e.message || 'Errore interno' });
  }
}
