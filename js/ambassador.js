// ============================================================
// InDubai Portal — Attribuzione manuale cliente ↔ ambassador
// ============================================================
// Un cliente inserito a mano si collega a un ambassador creando comunque una
// riga in ambassador_referrals (source 'manuale'). In questo modo commissioni,
// idempotenza e area riservata dell'ambassador funzionano esattamente come per
// le segnalazioni arrivate dal link pubblico, senza un secondo percorso da
// mantenere.
// Richiede /js/supabase.js.

const ambRef = {

  /** Ambassador selezionabili (solo attivi), in ordine alfabetico. */
  async listActive() {
    return sb.db.select('ambassadors', {
      filter: 'status=eq.active', columns: 'id,full_name,ref_code', order: 'full_name.asc',
    });
  },

  /** Servizi a catalogo, per attribuire la commissione giusta. */
  async listServices() {
    return sb.db.select('ambassador_services', {
      filter: 'active=eq.true', columns: 'id,name', order: 'position.asc',
    });
  },

  /** Commissioni già registrate su un cliente (blocca le modifiche distruttive). */
  async commissionsOf(clientId) {
    return sb.db.select('ambassador_commissions', {
      filter: `client_id=eq.${clientId}`, columns: 'id,status,commission_amount_aed,service_name',
    });
  },

  /**
   * Collega (o ricollega) un cliente a un ambassador.
   * @returns {Promise<{referral_id:string}>}
   * @throws se sul cliente esiste già una commissione: cambiarla a posteriori
   *         falserebbe i conti, prima va annullata dalla pagina Ambassador.
   */
  async assign({ client, ambassadorId, serviceId }) {
    const existing = await this.commissionsOf(client.id);
    const live = (existing || []).filter(c => c.status !== 'annullata');
    if (live.length) {
      throw new Error(
        `Su questo cliente c'è già una commissione (${ui.formatAED(live[0].commission_amount_aed)}, ${live[0].status}). ` +
        'Annullala dalla pagina Ambassador prima di cambiare attribuzione.'
      );
    }

    // Attribuzione precedente: se era manuale la sostituisco, se arrivava dal
    // modulo pubblico la conservo (è la traccia di una lead vera) e la scollego.
    if (client.ambassador_referral_id) {
      await this._detachReferral(client.ambassador_referral_id);
    }

    const rows = await sb.db.insert('ambassador_referrals', {
      ambassador_id: ambassadorId,
      service_id: serviceId || null,
      client_id: client.id,
      full_name: client.contact_name || client.company_name,
      email: client.email || null,
      phone: client.phone_uae || null,
      status: 'in_trattativa',
      source: 'manuale',
    });
    const referral = Array.isArray(rows) ? rows[0] : rows;

    await sb.db.update('clients', `id=eq.${client.id}`, {
      ambassador_id: ambassadorId,
      ambassador_referral_id: referral.id,
    });

    try { await sb.db.log('ambassador_assigned', client.id, { ambassador_id: ambassadorId }); } catch (_) {}
    return { referral_id: referral.id };
  },

  /** Toglie l'attribuzione da un cliente. */
  async unassign(client) {
    const existing = await this.commissionsOf(client.id);
    const live = (existing || []).filter(c => c.status !== 'annullata');
    if (live.length) {
      throw new Error(
        `Su questo cliente c'è una commissione (${ui.formatAED(live[0].commission_amount_aed)}, ${live[0].status}). ` +
        'Annullala dalla pagina Ambassador prima di togliere l\'attribuzione.'
      );
    }
    if (client.ambassador_referral_id) {
      await this._detachReferral(client.ambassador_referral_id);
    }
    await sb.db.update('clients', `id=eq.${client.id}`, {
      ambassador_id: null, ambassador_referral_id: null,
    });
    try { await sb.db.log('ambassador_unassigned', client.id, {}); } catch (_) {}
  },

  /**
   * Un'attribuzione manuale si cancella: esiste solo per collegare il cliente.
   * Una segnalazione arrivata dal modulo resta invece negli archivi — è la
   * traccia di un contatto reale — e viene solo scollegata dal cliente.
   */
  async _detachReferral(referralId) {
    const rows = await sb.db.select('ambassador_referrals', {
      filter: `id=eq.${referralId}`, columns: 'id,source',
    });
    const ref = rows && rows[0];
    if (!ref) return;
    if (ref.source === 'manuale') {
      await sb.db.delete('ambassador_referrals', `id=eq.${referralId}`);
    } else {
      await sb.db.update('ambassador_referrals', `id=eq.${referralId}`, { client_id: null });
    }
  },
};

window.ambRef = ambRef;
