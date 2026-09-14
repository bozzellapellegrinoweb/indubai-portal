/**
 * /api/ambassador-delete   (solo staff loggato)
 *
 * POST { ambassador_id, force? }
 *
 * Cancella un ambassador inserito per sbaglio: la riga in anagrafica, l'utente
 * di accesso e il suo profilo.
 *
 * Attenzione al vincolo di cascata: ambassador_referrals e
 * ambassador_commissions hanno "on delete cascade" sull'ambassador, quindi
 * cancellarlo porta via anche lo storico dei guadagni. Per questo:
 *   - con commissioni registrate la cancellazione è SEMPRE rifiutata: si
 *     disattiva l'ambassador, non lo si fa sparire dai conti;
 *   - con segnalazioni ma nessuna commissione serve force:true, così la
 *     conferma in interfaccia può dire esattamente cosa va perso.
 * I clienti non vengono toccati (clients.ambassador_id è "on delete set null").
 */

import {
  SUPABASE_URL, SB_HEADERS, sbSelect, requireStaff,
} from './_ambassador-lib.js';

async function countRows(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}&select=id`, {
    headers: { ...SB_HEADERS, Prefer: 'count=exact', Range: '0-0' },
  });
  const range = res.headers.get('content-range') || '';   // es. "0-0/12"
  return Number(range.split('/')[1]) || 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireStaff(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { ambassador_id, force } = req.body || {};
  if (!ambassador_id) return res.status(400).json({ error: 'ambassador_id mancante' });

  try {
    const rows = await sbSelect('ambassadors', `id=eq.${ambassador_id}&select=id,full_name,user_id`);
    const amb = rows?.[0];
    if (!amb) return res.status(404).json({ error: 'Ambassador non trovato' });

    const [commissions, referrals] = await Promise.all([
      countRows('ambassador_commissions', `ambassador_id=eq.${ambassador_id}`),
      countRows('ambassador_referrals', `ambassador_id=eq.${ambassador_id}`),
    ]);

    if (commissions > 0) {
      return res.status(409).json({
        error: `${amb.full_name} ha ${commissions} ${commissions === 1 ? 'commissione registrata' : 'commissioni registrate'}. `
             + 'Cancellarlo cancellerebbe anche quelle: mettilo in stato "Disattivato" invece di eliminarlo.',
        commissions, referrals, blocked: true,
      });
    }

    if (referrals > 0 && !force) {
      return res.status(409).json({
        error: `${amb.full_name} ha ${referrals} ${referrals === 1 ? 'segnalazione' : 'segnalazioni'} che verranno cancellate. `
             + 'I clienti collegati restano, perdono solo il riferimento all\'ambassador.',
        commissions, referrals, needs_force: true,
      });
    }

    // 1. Utente di accesso (il profilo sparisce a cascata da auth.users)
    if (amb.user_id) {
      const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${amb.user_id}`, {
        method: 'DELETE', headers: SB_HEADERS,
      });
      if (!del.ok && del.status !== 404) {
        const detail = await del.text();
        return res.status(400).json({ error: 'Cancellazione utente non riuscita: ' + detail });
      }
    }

    // 2. Anagrafica (porta via le segnalazioni collegate)
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/ambassadors?id=eq.${ambassador_id}`, {
      method: 'DELETE', headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    });
    if (!delRes.ok) {
      return res.status(400).json({ error: 'Cancellazione anagrafica non riuscita: ' + await delRes.text() });
    }

    return res.status(200).json({ ok: true, deleted: amb.full_name, referrals });
  } catch (e) {
    console.error('[ambassador-delete]', e);
    return res.status(500).json({ error: e.message || 'Errore interno' });
  }
}
