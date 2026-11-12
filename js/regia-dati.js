// ============================================================
// Regia SMM — i dati
// ============================================================
// Tutto il dialogo col database sta qui, cosi' la scena 3D e i pannelli non
// sanno niente di tabelle e si occupano solo di mostrare.
//
// Sugli aggiornamenti dal vivo: il portale non ha mai usato Supabase
// Realtime, e la publication era vuota. Ora le tabelle della Regia ci sono,
// ma il websocket non e' la via garantita: una rete aziendale, un proxy o una
// CSP possono chiuderlo. Quindi la via garantita resta il ricarico
// periodico, e il websocket serve a renderlo raro: quando arriva un evento
// si ricarica subito e si rallenta il giro; quando non arriva niente, il giro
// resta vivace. In nessuno dei due casi il manager deve premere F5.
// ============================================================

(function () {
  const SB = window.ENV_SUPABASE_URL;
  const AK = window.ENV_SUPABASE_ANON_KEY;

  const stato = {
    brand: null,
    agenti: [],
    lavori: [],
    contenuti: [],
    impostazioni: null,
    piano: [],
    cervelloContatori: { regola: 0, nota: 0, studio: 0, design: 0, daConfermare: 0 },
    profilo: null,
    caricato: false,
  };

  const ascoltatori = new Set();
  function avvisa() { for (const f of ascoltatori) { try { f(stato); } catch (e) { console.error(e); } } }

  function token() {
    return (window.sb && sb.getSession && sb.getSession()?.access_token) || AK;
  }

  async function rest(percorso, opzioni = {}) {
    const r = await fetch(`${SB}/rest/v1/${percorso}`, {
      ...opzioni,
      cache: 'no-store',
      headers: {
        apikey: AK,
        Authorization: 'Bearer ' + token(),
        'Content-Type': 'application/json',
        ...(opzioni.prefer ? { Prefer: opzioni.prefer } : {}),
        ...(opzioni.headers || {}),
      },
    });
    const testo = await r.text();
    let dati = null;
    try { dati = testo ? JSON.parse(testo) : null; } catch { dati = testo; }
    if (!r.ok) throw new Error(dati?.message || dati?.error || dati?.hint || `HTTP ${r.status}`);
    return dati;
  }

  const sel = (t, q) => rest(`${t}?${q}`);
  const ins = (t, righe) => rest(t, {
    method: 'POST', prefer: 'return=representation',
    body: JSON.stringify(Array.isArray(righe) ? righe : [righe]),
  });
  const upd = (t, filtro, patch) => rest(`${t}?${filtro}`, {
    method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(patch),
  });
  const del = (t, filtro) => rest(`${t}?${filtro}`, { method: 'DELETE', prefer: 'return=minimal' });
  const rpc = (f, args) => rest(`rpc/${f}`, { method: 'POST', body: JSON.stringify(args) });

  // ── Caricamento ───────────────────────────────────────────
  async function carica() {
    const brands = await sel('smm_brands', 'attivo=eq.true&select=*&order=created_at&limit=1');
    stato.brand = brands?.[0] || null;
    if (!stato.brand) { stato.caricato = true; avvisa(); return stato; }
    const b = stato.brand.id;

    const [agenti, lavori, contenuti, impostazioni, cervello, pianoSett] = await Promise.all([
      // Anche quelli spenti: uno spento deve restare alla sua scrivania,
      // buio, altrimenti sparisce dalla stanza e non lo riaccendi piu'.
      sel('smm_agents', `brand_id=eq.${b}&select=*&order=ordine`),
      // I lavori chiusi da piu' di un giorno non servono alla scena
      sel('smm_jobs', `brand_id=eq.${b}&or=(stato.in.(in_coda,in_corso,attesa_risposta),updated_at.gte.${ieri()})&select=*&order=created_at.desc&limit=200`),
      // Quelli buttati non si caricano nemmeno: non servono a nessuna
      // vista e occuperebbero posti dentro il limite, spingendo fuori
      // quelli veri man mano che la lista cresce.
      sel('smm_contents', `brand_id=eq.${b}&stato=neq.scartato&select=*&order=updated_at.desc&limit=300`),
      sel('smm_settings', `brand_id=eq.${b}&select=*`),
      sel('smm_brain', `brand_id=eq.${b}&attivo=eq.true&select=tipo,confermata`),
      // Il piano con quanto manca: lo guarda la testata, non solo il
      // pannello Direzione, quindi viene su col resto.
      rpc('smm_piano_settimana', { p_brand: b, p_offset: 0 }).catch(() => []),
    ]);

    stato.agenti = agenti || [];
    stato.lavori = lavori || [];
    stato.contenuti = contenuti || [];
    stato.impostazioni = impostazioni?.[0] || null;
    stato.piano = pianoSett || [];

    const c = { regola: 0, nota: 0, studio: 0, design: 0, daConfermare: 0 };
    for (const v of cervello || []) {
      if (v.tipo in c) c[v.tipo]++;
      if (!v.confermata) c.daConfermare++;
    }
    stato.cervelloContatori = c;
    stato.profilo = window.sb?.getCurrentProfile?.() || null;
    stato.caricato = true;
    avvisa();
    return stato;
  }

  function ieri() { return new Date(Date.now() - 86400000).toISOString(); }

  // ── Cosa sta facendo ogni agente ──────────────────────────
  // Un agente ha al massimo un lavoro "vivo": quello piu' recente fra i non
  // chiusi. E' da qui che escono il fumetto e la posa dell'avatar.
  function lavoroVivoDi(agentId) {
    return stato.lavori.find(j =>
      j.agent_id === agentId && ['in_corso', 'attesa_risposta'].includes(j.stato))
      || stato.lavori.find(j => j.agent_id === agentId && j.stato === 'in_coda')
      || null;
  }

  function posaDi(agentId) {
    const a = stato.agenti.find(x => x.id === agentId);
    if (a && a.attivo === false) return 'spento';
    const j = lavoroVivoDi(agentId);
    if (!j) return 'libero';
    if (j.stato === 'attesa_risposta') return 'mano_alzata';
    if (j.stato === 'in_corso') return 'lavora';
    return 'attende';
  }

  /** Le coppie di scrivanie fra cui tirare una linea: padre e figlio al lavoro. */
  function collaborazioni() {
    const vivi = stato.lavori.filter(j => ['in_coda', 'in_corso'].includes(j.stato) && j.parent_job_id);
    const coppie = [];
    for (const figlio of vivi) {
      const padre = stato.lavori.find(j => j.id === figlio.parent_job_id);
      if (padre?.agent_id && figlio.agent_id && padre.agent_id !== figlio.agent_id) {
        coppie.push({ da: padre.agent_id, a: figlio.agent_id });
      }
    }
    return coppie;
  }

  /**
   * La riga di stato in cima.
   *
   * I numeri devono tornare. Prima non tornavano: domande, lavorano e
   * inCoda contavano LAVORI, daGuardare contava CONTENUTI e liberi
   * contava AGENTI, tutti nella stessa frase. Con otto agenti in sala la
   * riga diceva "1 ti aspetta, 1 ha fatto una domanda, 1 sta lavorando, 1
   * in attesa di partire, 6 sono liberi" — dieci soggetti — mentre la
   * fascia accanto diceva "IN SALA (8)". E chi aveva la mano alzata era
   * contato due volte, perche' liberi escludeva solo in_corso e in_coda.
   *
   * Adesso le persone si contano una volta sola, in cassetti che non si
   * sovrappongono e che sommati fanno il totale; le cose da fare si
   * contano a parte, perche' sono cose e non persone.
   */
  function riepilogo() {
    const accesi = stato.agenti.filter(a => a.attivo !== false);
    const spenti = stato.agenti.length - accesi.length;
    const conLavoro = (st) => new Set(stato.lavori
      .filter(j => j.stato === st).map(j => j.agent_id));
    const chiedono   = conLavoro('attesa_risposta');
    const inCorso    = conLavoro('in_corso');
    const inPartenza = conLavoro('in_coda');

    // Un ordine di precedenza, perche' lo stesso agente puo' avere piu'
    // lavori: chi ha fatto una domanda e' fermo e aspetta te, e questo
    // viene prima di tutto il resto.
    let domande = 0, lavorano = 0, inCoda = 0, liberi = 0;
    for (const a of accesi) {
      if (chiedono.has(a.id)) domande++;
      else if (inCorso.has(a.id)) lavorano++;
      else if (inPartenza.has(a.id)) inCoda++;
      else liberi++;
    }

    return {
      domande, lavorano, inCoda, liberi, spenti,
      totale: stato.agenti.length,
      // Cose, non persone: non entrano nella somma degli agenti.
      daGuardare: stato.contenuti.filter(c => c.stato === 'da_approvare').length,
      lavoriInCoda: stato.lavori.filter(j => j.stato === 'in_coda').length,
    };
  }

  /** La striscia "Tocca a te". */
  /** Caroselli, non caroselloe. Reel e post non cambiano. */
  const PLURALI = { carosello: 'caroselli', reel: 'reel', storia: 'storie', post: 'post' };
  function plurale(tipo, quanti) {
    return quanti === 1 ? tipo : (PLURALI[tipo] || tipo);
  }

  function toccaATe() {
    const voci = [];
    for (const j of stato.lavori.filter(x => x.stato === 'attesa_risposta')) {
      const a = stato.agenti.find(x => x.id === j.agent_id);
      voci.push({
        tipo: 'domanda', id: j.id, agente: a,
        titolo: `${a?.nome || 'Un agente'} ha una domanda`,
        testo: j.domanda || j.titolo, azione: 'Rispondi',
      });
    }
    for (const c of stato.contenuti.filter(x => x.stato === 'da_approvare')) {
      voci.push({
        tipo: 'approvazione', id: c.id,
        titolo: c.titolo, testo: 'Pronto da approvare', azione: 'Guarda',
      });
    }
    for (const c of stato.contenuti.filter(x => x.stato === 'respinto')) {
      const n = c.revisore_note?.violazioni?.length || 0;
      voci.push({
        tipo: 'respinto', id: c.id, titolo: c.titolo,
        testo: n ? `Il Revisore ha trovato ${n} ${n === 1 ? 'problema' : 'problemi'}` : 'Fermato dal Revisore',
        azione: 'Leggi',
      });
    }
    // Il piano in arretrato e' una cosa che tocca a te: nessun agente parte
    // da solo a coprirlo, glielo devi dire.
    const manca = (stato.piano || [])
      .filter(r => r.attivo && r.mancanti > 0)
      .map(r => `${r.mancanti} ${plurale(r.tipo, r.mancanti)}`);
    if (manca.length) {
      voci.push({
        tipo: 'piano', id: 'piano',
        titolo: 'La settimana non è coperta',
        testo: `Mancano ${manca.join(', ')}`, azione: 'Lancia',
      });
    }
    if (stato.cervelloContatori.daConfermare > 0) {
      voci.push({
        tipo: 'cervello', id: 'cervello',
        titolo: 'Note nuove nel Cervello',
        testo: `${stato.cervelloContatori.daConfermare} da confermare`, azione: 'Apri',
      });
    }
    return voci;
  }

  // ── Azioni ────────────────────────────────────────────────

  /** Sveglia il worker senza attendere: la scena deve muoversi subito. */
  function svegliaWorker() {
    fetch(`${SB}/functions/v1/smm-worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ origine: 'browser' }),
    }).catch(() => { /* ci pensa il cron */ });
  }

  /** Si parla solo col Direttore: lui smista. */
  async function scriviAlDirettore(testo, contentId = null) {
    const d = stato.agenti.find(a => a.slug === 'direttore') || stato.agenti[0];
    if (!d) throw new Error('Non c\'e\' nessun agente configurato.');
    const utente = window.sb?.getCurrentUser?.()?.id || null;
    await ins('smm_messages', {
      brand_id: stato.brand.id, agent_id: d.id, content_id: contentId,
      autore: 'utente', user_id: utente, testo,
    });
    const righe = await ins('smm_jobs', {
      brand_id: stato.brand.id, agent_id: d.id, content_id: contentId,
      tipo: 'agente',
      titolo: testo.length > 60 ? testo.slice(0, 57) + '…' : testo,
      richiesta: testo, priorita: 70, richiesto_da: utente,
    });
    svegliaWorker();
    await carica();
    return righe?.[0];
  }

  /** Scrive a un agente specifico dal suo pannello. */
  async function scriviAdAgente(agentId, testo, contentId = null) {
    const utente = window.sb?.getCurrentUser?.()?.id || null;
    await ins('smm_messages', {
      brand_id: stato.brand.id, agent_id: agentId, content_id: contentId,
      autore: 'utente', user_id: utente, testo,
    });
    await ins('smm_jobs', {
      brand_id: stato.brand.id, agent_id: agentId, content_id: contentId,
      tipo: 'agente', titolo: testo.length > 60 ? testo.slice(0, 57) + '…' : testo,
      richiesta: testo, priorita: 70, richiesto_da: utente,
    });
    svegliaWorker();
    await carica();
  }

  /** Risponde alla domanda di un agente: il lavoro riparte da dove era. */
  async function rispondiAlLavoro(jobId, testo) {
    await upd('smm_jobs', `id=eq.${jobId}`, {
      risposta: testo, stato: 'in_coda', domanda: null, attivita: null,
    });
    const j = stato.lavori.find(x => x.id === jobId);
    if (j?.agent_id) {
      await ins('smm_messages', {
        brand_id: stato.brand.id, agent_id: j.agent_id, job_id: jobId,
        autore: 'utente', user_id: window.sb?.getCurrentUser?.()?.id || null, testo,
      });
    }
    svegliaWorker();
    await carica();
  }

  const messaggiDi = (agentId) =>
    sel('smm_messages', `agent_id=eq.${agentId}&select=*&order=created_at.desc&limit=60`)
      .then(r => (r || []).reverse());

  const lavoriDi = (agentId) =>
    sel('smm_jobs', `agent_id=eq.${agentId}&select=id,titolo,stato,finished_at,risultato&order=created_at.desc&limit=12`);

  // ── Contenuti, versioni, note ─────────────────────────────
  const contenuto = (id) => sel('smm_contents', `id=eq.${id}&select=*`).then(r => r?.[0] || null);
  const versioni = (id) =>
    sel('smm_content_versions', `content_id=eq.${id}&select=*&order=round`);
  const note = (id) =>
    sel('smm_notes', `content_id=eq.${id}&select=*&order=created_at`);
  const mediaDi = (id) =>
    sel('smm_media', `content_id=eq.${id}&select=*&order=created_at`);

  /**
   * Aggiunge una nota agganciata a un punto preciso. Il trigger del database
   * la porta nel Cervello come proposta e mette in coda il lavoro che la
   * generalizza: qui non c'e' niente da fare in piu'.
   */
  async function aggiungiNota(contentId, testo, ancora, versionId = null) {
    const righe = await ins('smm_notes', {
      content_id: contentId, version_id: versionId,
      autore: window.sb?.getCurrentUser?.()?.id || null,
      ancora: ancora || { tipo: 'generale' }, testo,
    });
    svegliaWorker();
    return righe?.[0];
  }

  const risolviNota = (id) => upd('smm_notes', `id=eq.${id}`, { risolta: true });

  /** "E' a posto cosi'": la firma la mette chi sta premendo il tasto. */
  async function approva(contentId) {
    const uid = window.sb?.getCurrentUser?.()?.id;
    if (!uid) throw new Error('Sessione scaduta: rientra nel portale.');
    await upd('smm_contents', `id=eq.${contentId}`, {
      approvato_da: uid, approvato_at: new Date().toISOString(), stato: 'approvato',
    });
    await carica();
  }

  /** La seconda firma, quando la doppia approvazione e' accesa. */
  async function approvaComeAdmin(contentId) {
    const uid = window.sb?.getCurrentUser?.()?.id;
    await upd('smm_contents', `id=eq.${contentId}`, {
      approvato_admin_da: uid, approvato_admin_at: new Date().toISOString(),
    });
    await carica();
  }

  async function rimandaIndietro(contentId, motivo) {
    await aggiungiNota(contentId, motivo, { tipo: 'generale' });
    await upd('smm_contents', `id=eq.${contentId}`, { stato: 'in_lavorazione' });
    await carica();
  }

  /** Trascinato su un giorno del calendario. */
  async function spostaInCalendario(contentId, quando) {
    const c = stato.contenuti.find(x => x.id === contentId);
    const patch = { slot_at: quando ? new Date(quando).toISOString() : null };
    if (quando && c && ['approvato', 'idea', 'in_lavorazione'].includes(c.stato)) {
      patch.stato = 'in_calendario';
    }
    if (!quando && c?.stato === 'in_calendario') patch.stato = 'approvato';
    await upd('smm_contents', `id=eq.${contentId}`, patch);
    await carica();
  }

  async function pubblicaOra(contentId, piattaforme, formato, prova = false) {
    const r = await fetch(`${SB}/functions/v1/smm-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ content_id: contentId, piattaforme, formato, prova }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || `HTTP ${r.status}`);
    await carica();
    return d;
  }

  /**
   * Quali social sono davvero collegati su GoHighLevel.
   *
   * Prima non c'era modo di saperlo dalla Regia: si scopriva solo
   * tentando una pubblicazione, cioe' avendo gia' un contenuto approvato e
   * rischiando di farlo uscire. Questa chiamata non tocca nessun
   * contenuto e non manda niente.
   *
   * Si tiene in memoria per la sessione: gli account collegati cambiano
   * quando qualcuno va su GoHighLevel a collegarne uno, non ogni minuto, e
   * la chiamata costa un viaggio a GHL.
   */
  let accountRicordati = null;
  async function accountCollegati(rifai = false) {
    if (accountRicordati && !rifai) return accountRicordati;
    const r = await fetch(`${SB}/functions/v1/smm-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ azione: 'account' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || `HTTP ${r.status}`);
    accountRicordati = d;
    return d;
  }

  /** Dove deve uscire un contenuto. Lo decide il manager, non il codice. */
  async function piattaformeImposta(contentId, piattaforme) {
    const r = await rpc('smm_piattaforme_imposta',
      { p_content: contentId, p_piattaforme: piattaforme });
    await carica();
    return r;
  }

  // ── Il Cervello ───────────────────────────────────────────
  const cervelloCerca = (q, tipi = null, limite = 40) =>
    rpc('smm_cervello_cerca', {
      p_brand: stato.brand.id, p_query: q || null, p_tipi: tipi, p_limite: limite,
    });

  const cervelloDaConfermare = () =>
    sel('smm_brain', `brand_id=eq.${stato.brand.id}&confermata=eq.false&attivo=eq.true&select=*&order=created_at.desc`);

  /**
   * Fa rendere il contenuto dal generatore: immagini del carosello, video
   * del reel, slide della storia. Puo' metterci un minuto, perche' di la'
   * apre un browser vero e monta i file.
   */
  async function rendi(contentId, formato = null) {
    const r = await fetch(`${SB}/functions/v1/smm-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({
        content_id: contentId,
        ...(formato ? { formato } : {}),
        chi: window.sb?.getCurrentUser?.()?.id || null,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.ok === false) throw new Error(d?.error || `Il motore non ha risposto (${r.status}).`);
    await carica();
    return d;
  }

  async function cervelloConferma(id) {
    await upd('smm_brain', `id=eq.${id}`, { confermata: true });
    await carica();
  }
  async function cervelloScarta(id) {
    await upd('smm_brain', `id=eq.${id}`, { attivo: false, confermata: false });
    await carica();
  }
  async function cervelloAggiungi(tipo, testo, fonte, tags) {
    await ins('smm_brain', {
      brand_id: stato.brand.id, tipo, testo, fonte: fonte || 'Aggiunta a mano',
      tags: tags || [], confermata: true,
      created_by: window.sb?.getCurrentUser?.()?.id || null,
    });
    await carica();
  }

  // ── Reference: "studia questo stile" ──────────────────────
  async function nuovaReference({ url, testo, mediaId, agenteSlug }) {
    const utente = window.sb?.getCurrentUser?.()?.id || null;
    const ag = stato.agenti.find(a => a.slug === (agenteSlug || 'stratega'))
            || stato.agenti.find(a => a.slug === 'copywriter');
    const descrizione = [
      'Studia questo riferimento e ricavane uno studio di stile da mettere nel Cervello.',
      url ? `Indirizzo: ${url}` : '',
      testo ? `Testo o note:\n${testo}` : '',
      mediaId ? '(E\' allegata anche un\'immagine o un video caricato dal manager.)' : '',
      '',
      'Lo studio deve dire cosa rende riconoscibile questo stile e cosa se ne puo\' portare nel nostro,',
      'senza copiarlo. Usa cervello_proponi per registrarlo.',
    ].filter(Boolean).join('\n');
    await ins('smm_jobs', {
      brand_id: stato.brand.id, agent_id: ag?.id || null, tipo: 'agente',
      titolo: 'Studia questo stile',
      richiesta: descrizione,
      payload: { reference: { url: url || null, media_id: mediaId || null } },
      priorita: 40, richiesto_da: utente,
    });
    svegliaWorker();
    await carica();
  }

  // ── Risultati ─────────────────────────────────────────────
  const risultati = () =>
    sel('smm_results', `brand_id=eq.${stato.brand.id}&select=*,smm_contents(titolo,tipo,pillar,slot_at)&order=data.desc&limit=400`);

  async function salvaRisultato(contentId, dati) {
    await rest('smm_results?on_conflict=content_id,data,fonte', {
      method: 'POST', prefer: 'return=representation, resolution=merge-duplicates',
      body: JSON.stringify([{
        brand_id: stato.brand.id, content_id: contentId,
        data: dati.data || new Date().toISOString().slice(0, 10),
        fonte: 'manuale', ...dati,
      }]),
    });
  }

  // ── Impostazioni (solo admin le scrive: la RLS filtra in silenzio) ──
  // ── Il piano della settimana ──────────────────────────────

  function piano(offset = 0) {
    return rpc('smm_piano_settimana', { p_brand: stato.brand.id, p_offset: offset });
  }

  async function nuovaRigaPiano(riga) {
    const r = await ins('smm_piano', {
      brand_id: stato.brand.id,
      created_by: window.sb?.getCurrentUser?.()?.id || null,
      ...riga,
    });
    await carica();
    return r?.[0];
  }

  async function salvaRigaPiano(id, patch) {
    await upd('smm_piano', `id=eq.${id}`, patch);
    await carica();
  }

  async function eliminaRigaPiano(id) {
    await del('smm_piano', `id=eq.${id}`);
    await carica();
  }

  /** Dice al Direttore di coprire quello che manca. Il piano lo legge lui dal
   *  suo prompt: non gli passo numeri che potrebbero essere vecchi. */
  async function lanciaQuelloCheManca() {
    return scriviAlDirettore(
      'Guarda la direzione di questa settimana e lancia quello che manca, ' +
      'una cosa per volta, assegnando a chi tocca secondo il piano. ' +
      'Se è già coperta dillo e non produrre niente in più.');
  }

  // ── Interruttori ──────────────────────────────────────────

  /** Il fermo generale. Passa da una funzione del database perche'
   *  smm_settings la scrive solo l'admin, e il fermo deve poterlo alzare chi
   *  guarda la stanza. */
  async function interruttore(fermo) {
    await rpc('smm_interruttore', { p_brand: stato.brand.id, p_stato: !!fermo });
    await carica();
    if (!fermo) svegliaWorker();
    return !!fermo;
  }

  /** Il piano che si copre da solo ogni mattina. Lo scrive solo l'admin,
   *  come tutte le impostazioni di spesa: a un manager senza i permessi la
   *  riga non cambia e il messaggio lo dice. */
  async function pianoAutomatico(acceso) {
    await upd('smm_settings', `brand_id=eq.${stato.brand.id}`, { piano_automatico: !!acceso });
    const dopo = await sel('smm_settings', `brand_id=eq.${stato.brand.id}&select=piano_automatico`);
    if (dopo?.[0]?.piano_automatico !== !!acceso) {
      throw new Error('Questa impostazione la cambia solo un amministratore.');
    }
    await carica();
  }

  async function accendiAgente(agentId, acceso) {
    await upd('smm_agents', `id=eq.${agentId}`, { attivo: !!acceso });
    await carica();
    if (acceso) svegliaWorker();
  }

  async function salvaImpostazioni(patch) {
    const righe = await upd('smm_settings', `brand_id=eq.${stato.brand.id}`, patch);
    // La RLS su UPDATE non solleva errori: filtra. Zero righe = non permesso.
    if (!righe || !righe.length) {
      throw new Error('Queste impostazioni le cambia solo un amministratore.');
    }
    await carica();
    return righe[0];
  }

  // ── Media ─────────────────────────────────────────────────
  // L'upload va diretto allo Storage con il JWT dell'utente, non piu' da
  // /api/upload, che manda il file in base64 con un tetto di 10 MB: per un
  // video non basta nemmeno per cominciare.
  //
  // Per i file grandi si usa il protocollo riprendibile (TUS), che spezza il
  // file in pezzi: se la rete cade si riparte dal pezzo giusto invece che da
  // capo. Sotto i 6 MB non vale la pena e si manda in un colpo.
  const SOGLIA_RIPRENDIBILE = 6 * 1024 * 1024;

  async function caricaFile(file, { contentId = null, ruolo = 'originale', onProgress } = {}) {
    const utente = window.sb?.getCurrentUser?.()?.id || 'anonimo';
    const nome = file.name.replace(/[^\w.\-]+/g, '_');
    const percorso = `${stato.brand.id}/${utente}/${Date.now()}_${nome}`;

    if (file.size > SOGLIA_RIPRENDIBILE) {
      await caricaRiprendibile(file, percorso, onProgress);
    } else {
      await caricaDiretto(file, percorso, onProgress);
    }

    const righe = await ins('smm_media', {
      brand_id: stato.brand.id, content_id: contentId, ruolo,
      bucket: 'smm-media', path: percorso, nome_file: file.name,
      mime: file.type || 'application/octet-stream', bytes: file.size,
      caricato_da: window.sb?.getCurrentUser?.()?.id || null,
      usato: !!contentId,
    });
    return righe?.[0];
  }

  function caricaDiretto(file, percorso, onProgress) {
    return new Promise((risolvi, rifiuta) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SB}/storage/v1/object/smm-media/${encodeURI(percorso)}`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token());
      xhr.setRequestHeader('apikey', AK);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => (xhr.status < 300 ? risolvi() : rifiuta(new Error(leggiErrore(xhr))));
      xhr.onerror = () => rifiuta(new Error('La rete ha interrotto il caricamento.'));
      xhr.send(file);
    });
  }

  function leggiErrore(xhr) {
    try { return JSON.parse(xhr.responseText)?.message || `HTTP ${xhr.status}`; }
    catch { return `HTTP ${xhr.status}`; }
  }

  /**
   * Caricamento riprendibile, protocollo TUS, a pezzi da 6 MB.
   * Lo Storage di Supabase lo parla su /upload/resumable.
   */
  async function caricaRiprendibile(file, percorso, onProgress) {
    const PEZZO = 6 * 1024 * 1024;
    const base = `${SB}/storage/v1/upload/resumable`;
    const meta = [
      `bucketName ${btoa('smm-media')}`,
      `objectName ${btoa(unescape(encodeURIComponent(percorso)))}`,
      `contentType ${btoa(file.type || 'application/octet-stream')}`,
      `cacheControl ${btoa('3600')}`,
    ].join(',');

    const crea = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token(), apikey: AK,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(file.size),
        'Upload-Metadata': meta,
        'x-upsert': 'true',
      },
    });
    if (!crea.ok) throw new Error(`Non riesco ad aprire il caricamento: HTTP ${crea.status}`);
    const posizione = crea.headers.get('Location');
    if (!posizione) throw new Error('Il server non ha indicato dove caricare.');
    const indirizzo = posizione.startsWith('http') ? posizione : `${SB}${posizione}`;

    let inviati = 0;
    let tentativi = 0;
    while (inviati < file.size) {
      const fine = Math.min(inviati + PEZZO, file.size);
      try {
        const r = await fetch(indirizzo, {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer ' + token(), apikey: AK,
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(inviati),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: file.slice(inviati, fine),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        inviati = Number(r.headers.get('Upload-Offset') || fine);
        tentativi = 0;
        if (onProgress) onProgress(inviati / file.size);
      } catch (e) {
        // La rete e' caduta: si richiede al server a che punto era e si
        // riprende da li'. E' il motivo per cui si usa questo protocollo.
        if (++tentativi > 5) throw new Error(`Caricamento interrotto: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000 * tentativi));
        try {
          const testa = await fetch(indirizzo, {
            method: 'HEAD',
            headers: { Authorization: 'Bearer ' + token(), apikey: AK, 'Tus-Resumable': '1.0.0' },
          });
          const off = Number(testa.headers.get('Upload-Offset'));
          if (!Number.isNaN(off)) inviati = off;
        } catch { /* si riprova dallo stesso punto */ }
      }
    }
  }

  /**
   * Link firmato a scadenza. I media non sono mai pubblici: il bucket e'
   * privato e ogni anteprima si apre con un indirizzo che scade.
   */
  async function linkFirmato(path, secondi = 3600) {
    const r = await fetch(`${SB}/storage/v1/object/sign/smm-media/${encodeURI(path)}`, {
      method: 'POST',
      headers: {
        apikey: AK, Authorization: 'Bearer ' + token(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: secondi }),
    });
    if (!r.ok) throw new Error(`Non riesco a firmare il link: HTTP ${r.status}`);
    const d = await r.json();
    const url = d.signedURL || d.signedUrl || d.url;
    if (!url) throw new Error('Il server non ha restituito un indirizzo firmato.');
    return url.startsWith('http') ? url : `${SB}/storage/v1${url}`;
  }

  // ── Aggiornamenti dal vivo ────────────────────────────────
  let ws = null, battito = null, riferimento = 0, vivo = false, giro = null;
  let intervallo = 6000;

  let ultimoRisveglio = 0;

  /**
   * Finche' c'e' qualcosa in coda, il worker va richiamato.
   *
   * Un giro del worker dura al massimo cinquanta secondi: se il primo
   * lavoro se li prende quasi tutti, i lavori figli restano fermi. Il
   * worker adesso si richiama da solo, ma questa e' la seconda rete: se
   * quella chiamata si perde, finche' la pagina e' aperta la coda riparte
   * comunque.
   *
   * Non piu' di una volta ogni venti secondi: un giro a vuoto non fa danni,
   * ma nemmeno serve a qualcosa.
   */
  function risvegliaSeServe() {
    if (!stato.lavori.some(j => j.stato === 'in_coda')) return;
    if (stato.impostazioni?.stop_tutto) return;
    const adesso = Date.now();
    if (adesso - ultimoRisveglio < 20000) return;
    ultimoRisveglio = adesso;
    svegliaWorker();
  }

  function ricaricaPresto() {
    clearTimeout(giro);
    giro = setTimeout(async () => {
      try { await carica(); risvegliaSeServe(); }
      catch (e) { console.warn('[regia] ricarico:', e.message); }
      // Col websocket vivo il giro periodico serve solo da rete di sicurezza.
      // Ma se c'e' lavoro in coda si guarda piu' spesso: e' il momento in
      // cui la scena deve muoversi.
      const inCoda = stato.lavori.some(j => ['in_coda', 'in_corso'].includes(j.stato));
      intervallo = inCoda ? 6000 : (vivo ? 45000 : 6000);
      ricaricaPresto();
    }, intervallo);
  }

  function apriWebsocket() {
    if (!SB.startsWith('https://')) return;
    try {
      const host = SB.replace('https://', '');
      ws = new WebSocket(`wss://${host}/realtime/v1/websocket?apikey=${AK}&vsn=1.0.0`);
    } catch { return; }

    ws.onopen = () => {
      const tabelle = ['smm_jobs', 'smm_contents', 'smm_messages', 'smm_brain'];
      ws.send(JSON.stringify({
        topic: 'realtime:regia', event: 'phx_join',
        payload: {
          config: {
            postgres_changes: tabelle.map(t => ({ event: '*', schema: 'public', table: t })),
          },
          access_token: token(),
        },
        ref: String(++riferimento),
      }));
      battito = setInterval(() => {
        try {
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++riferimento) }));
        } catch { /* la chiusura la gestisce onclose */ }
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'phx_reply' && m.payload?.status === 'ok' && m.topic === 'realtime:regia') {
        vivo = true;   // confermata l'iscrizione: ora il giro puo' rallentare
        intervallo = 45000;
      }
      if (m.event === 'postgres_changes' || m.event === 'INSERT' || m.event === 'UPDATE') {
        clearTimeout(giro);
        giro = setTimeout(async () => {
          try { await carica(); } catch { /* il giro periodico recupera */ }
          ricaricaPresto();
        }, 350);   // un attimo, cosi' piu' eventi insieme fanno un ricarico
      }
    };

    const chiudi = () => {
      clearInterval(battito);
      vivo = false;
      intervallo = 6000;
      // Un tentativo ogni mezzo minuto: se il websocket non si apre, il
      // ricarico periodico sta comunque facendo il suo lavoro.
      setTimeout(apriWebsocket, 30000);
    };
    ws.onclose = chiudi;
    ws.onerror = () => { try { ws.close(); } catch { chiudi(); } };
  }

  function avvia() {
    ricaricaPresto();
    apriWebsocket();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { clearTimeout(giro); carica().catch(() => {}); ricaricaPresto(); }
    });
  }

  function fermati() {
    clearTimeout(giro); clearInterval(battito);
    try { ws?.close(); } catch { /* niente */ }
  }

  /**
   * Le foto del manager.
   *
   * Non stanno qui: vivono nel database del generatore, che e' il pool da
   * cui le storie pescano da sempre. Tenerne una copia nel portale
   * vorrebbe dire avere due elenchi che divergono, e la storia uscirebbe
   * con una foto che qui risulta scartata.
   *
   * Generare costa, quindi la funzione lato server controlla che chi
   * chiede abbia la Regia fra le pagine concesse: non basta essere
   * entrati nel portale.
   */
  /**
   * Una chiamata a una funzione del portale, con una scadenza.
   *
   * Senza, se la catena si impunta il pannello resta su "Carico…" finche'
   * l'utente non rinuncia: fra il limite della funzione Supabase e i
   * quattrocentocinquanta secondi della rotta di rendering su Vercel, puo'
   * voler dire minuti. Una girandola infinita non e' un'informazione; una
   * frase che nomina chi non ha risposto si'.
   */
  async function chiama(funzione, corpo, secondi, cosa) {
    const taglio = new AbortController();
    const sveglia = setTimeout(() => taglio.abort(), secondi * 1000);
    let r;
    try {
      r = await fetch(`${SB}/functions/v1/${funzione}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify(corpo),
        signal: taglio.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`${cosa}: nessuna risposta dopo ${secondi} secondi. `
          + 'Riprova fra un minuto.');
      }
      throw e;
    } finally {
      clearTimeout(sveglia);
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.ok === false) throw new Error(d?.error || `${cosa} (${r.status}).`);
    return d;
  }

  async function avatar(azione = 'elenco', extra = {}) {
    // Generare le foto chiama OpenAI: puo' metterci un minuto buono.
    const quanto = azione === 'genera' ? 180 : 30;
    return chiama('smm-avatar', { azione, ...extra }, quanto, 'Le foto non rispondono');
  }

  /**
   * La newsletter.
   *
   * Lo stato vive nel motore, come le foto. L'invio lo puo' chiedere solo
   * una persona con la Regia fra le pagine concesse: una mail partita a
   * centinaia di contatti non si annulla.
   */
  async function newsletter(azione = 'elenco', extra = {}) {
    // Scrivere una newsletter sono fonti piu' due modelli: venti-cinquanta
    // secondi, e adesso ci sta dentro anche il conteggio dei destinatari.
    // Spedire sono una chiamata a GoHighLevel per persona.
    const quanto = azione === 'elenco' ? 30 : azione === 'invia' ? 300 : 180;
    return chiama('smm-newsletter', { azione, ...extra }, quanto,
                  'La newsletter non risponde');
  }

  /**
   * Butta un contenuto.
   *
   * Lo fa il database con una funzione sola, perche' tre cose vanno
   * insieme: sparisce dalle liste, i lavori aperti si fermano e perde la
   * data di uscita. Farle da qui, una per una, vuol dire che se la pagina
   * si chiude a meta' resta un montaggio in coda su una cosa buttata.
   */
  async function scarta(contentId, perche = null) {
    const r = await rpc('smm_scarta', { p_content: contentId, p_perche: perche });
    await carica();
    return r;
  }

  window.regiaDati = {
    stato, carica, avvia, fermati,
    ascolta: (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); },
    lavoroVivoDi, posaDi, collaborazioni, riepilogo, toccaATe,
    scriviAlDirettore, scriviAdAgente, rispondiAlLavoro, messaggiDi, lavoriDi,
    contenuto, versioni, note, mediaDi, aggiungiNota, risolviNota,
    approva, approvaComeAdmin, rimandaIndietro, spostaInCalendario, pubblicaOra,
    cervelloCerca, cervelloDaConfermare, cervelloConferma, cervelloScarta, cervelloAggiungi,
    nuovaReference, risultati, salvaRisultato, salvaImpostazioni,
    plurale, piano, nuovaRigaPiano, salvaRigaPiano, eliminaRigaPiano, lanciaQuelloCheManca,
    interruttore, accendiAgente, pianoAutomatico,
    caricaFile, linkFirmato, svegliaWorker, rendi, avatar, newsletter, scarta,
    accountCollegati, piattaformeImposta,
  };
})();
