// ============================================================
// Regia SMM — l'interfaccia
// ============================================================
// Tutto in italiano e senza gergo: chi usa questa pagina e' un social media
// manager, non un amministratore di sistema. Non si parla di prompt, token,
// modelli, coda o record.
//
// La vista a lista non e' un ripiego: e' la base. Il 3D si appoggia sopra,
// mostra gli stessi dati e si puo' spegnere. Chi preferisce meno movimento,
// chi ha un dispositivo lento e chi usa uno screen reader lavora sulla
// lista, con le stesse informazioni e le stesse azioni.
// ============================================================

(function () {
  const D = window.regiaDati;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.ui.escapeHtml(s ?? '');

  // ── Stato dell'interfaccia ────────────────────────────────
  const ui = {
    vista: 'sala',
    zona: 'tutto',
    tridi: null,          // la scena, se accesa
    modulo3d: null,
    usaTridi: true,
    pannello: null,       // {tipo, id}
    cervelloContatoriPrec: null,
    slideScelta: 0,
    roundA: null, roundB: null,
    mediaScelto: null,
  };

  const ZONE_ETICHETTE = [
    ['tutto', 'Tutto'],
    ['direzione', 'Direzione'],
    ['studio', 'Studio'],
    ['montaggio', 'Montaggio'],
    ['uscita', 'Uscita'],
    ['revisione', 'Revisione'],
  ];

  // ── Il 3D si accende solo se ha senso ─────────────────────
  function movimentoRidotto() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  function dispositivoDebole() {
    // Pochi core o poca memoria: il 3D girerebbe a scatti e non servirebbe
    // a niente. navigator.deviceMemory non esiste su tutti i browser, e
    // quando manca non si presume il peggio.
    const core = navigator.hardwareConcurrency;
    const ram = navigator.deviceMemory;
    if (typeof core === 'number' && core <= 2) return true;
    if (typeof ram === 'number' && ram <= 2) return true;
    return false;
  }

  function webglDisponibile() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }

  function preferenzaSalvata() {
    try { return localStorage.getItem('regia_vista'); } catch { return null; }
  }
  function salvaPreferenza(v) {
    try { localStorage.setItem('regia_vista', v); } catch { /* niente */ }
  }

  // ── Riga di stato e saluto ────────────────────────────────
  function salutoDelGiorno() {
    const ora = Number(new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Asia/Dubai', hour: 'numeric', hour12: false,
    }).format(new Date()));
    if (ora < 5)  return 'Buonanotte';
    if (ora < 13) return 'Buongiorno';
    if (ora < 18) return 'Buon pomeriggio';
    return 'Buonasera';
  }

  function primoNome() {
    const p = window.sb?.getCurrentProfile?.();
    const n = (p?.full_name || '').trim();
    return n ? n.split(/\s+/)[0] : null;
  }

  function disegnaTesta() {
    const nome = primoNome();
    $('rg-saluto').textContent = nome
      ? `${salutoDelGiorno()}, ${nome}`
      : `${salutoDelGiorno()}`;

    const r = D.riepilogo();
    const pezzi = [];
    if (r.daGuardare) pezzi.push(`<b>${r.daGuardare}</b> ${r.daGuardare === 1 ? 'ti aspetta' : 'ti aspettano'}`);
    if (r.domande)    pezzi.push(`<b>${r.domande}</b> ${r.domande === 1 ? 'ha fatto una domanda' : 'hanno fatto una domanda'}`);
    if (r.lavorano)   pezzi.push(`<b>${r.lavorano}</b> ${r.lavorano === 1 ? 'sta lavorando' : 'stanno lavorando'}`);
    if (r.inCoda)     pezzi.push(`<b>${r.inCoda}</b> in attesa di partire`);
    if (r.liberi)     pezzi.push(`<b>${r.liberi}</b> ${r.liberi === 1 ? 'è libero' : 'sono liberi'}`);
    $('rg-stato').innerHTML = pezzi.length
      ? pezzi.join(', ') + '.'
      : 'La sala è tranquilla: nessun lavoro aperto.';

    const spento = D.stato.impostazioni?.stop_tutto;
    if (spento) {
      $('rg-stato').innerHTML =
        '<span class="rg-pillola rossa">tutto fermo</span> ' +
        'Gli agenti sono in pausa: nessun lavoro parte finché non si riaccende.';
    }

    const ora = new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit',
    }).format(new Date());
    $('rg-ora').textContent = `Dubai ${ora}`;
  }

  // ── Il filtro per zona ────────────────────────────────────
  function disegnaFiltro() {
    const c = $('rg-filtro');
    if (c.childElementCount) return;
    c.innerHTML = ZONE_ETICHETTE.map(([k, et]) =>
      `<button class="rg-zona" data-zona="${k}" aria-pressed="${k === 'tutto'}">${et}</button>`
    ).join('');
    c.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-zona]');
      if (!b) return;
      ui.zona = b.dataset.zona;
      for (const x of c.querySelectorAll('[data-zona]')) {
        x.setAttribute('aria-pressed', String(x.dataset.zona === ui.zona));
      }
      ui.tridi?.filtraZona(ui.zona);
      disegnaLista();
    });
  }

  // ── La scena ──────────────────────────────────────────────
  async function accendiTridi() {
    // La guardia non basta su ui.tridi: due chiamate ravvicinate entrano
    // entrambe prima che l'import finisca, e si costruirebbero due scene.
    if (ui.tridi || ui.accensione || !ui.usaTridi) return;
    ui.accensione = true;
    const palco = $('rg-scena');
    const fatica = $('rg-fatica');
    try {
      if (!ui.modulo3d) ui.modulo3d = await import('/js/regia-3d.js');
      ui.tridi = ui.modulo3d.creaScena(palco, {
        movimentoRidotto: movimentoRidotto(),
        onClickAgente: (id) => apriAgente(id),
        onClickCervello: () => apriCervello(),
      });
      fatica.hidden = true;
      sincronizzaTridi(true);
    } catch (e) {
      console.warn('[regia] la scena non si apre:', e);
      if (ui.tridi) { ui.accensione = false; return; }   // c'e' gia' una scena viva
      // Non si lascia un buco: si spiega e si passa alla lista, che fa tutto.
      fatica.hidden = false;
      fatica.innerHTML =
        '<div>La scena in tre dimensioni non si è aperta su questo dispositivo.<br>' +
        'La vista a lista ha le stesse informazioni e le stesse azioni.</div>' +
        '<button class="btn btn-accent btn-sm" id="rg-vai-lista">Passa alla lista</button>';
      $('rg-vai-lista')?.addEventListener('click', () => cambiaVistaSala('lista'));
      ui.usaTridi = false;
    } finally {
      ui.accensione = false;
    }
  }

  function spegniTridi() {
    ui.tridi?.distruggi();
    ui.tridi = null;
  }

  function cambiaVistaSala(quale) {
    const lista = quale === 'lista';
    ui.usaTridi = !lista;
    $('rg-palco').classList.toggle('nascosto', lista);
    $('rg-lista').classList.toggle('nascosto', !lista);
    $('rg-btn-vista').textContent = lista ? 'Vista 3D' : 'Vista a lista';
    $('rg-btn-vista').setAttribute('aria-pressed', String(lista));
    salvaPreferenza(lista ? 'lista' : '3d');
    if (lista) spegniTridi(); else accendiTridi();
    disegnaLista();
  }

  function sincronizzaTridi(riposiziona = false) {
    if (!ui.tridi) return;
    if (riposiziona) {
      ui.tridi.disponiAgenti(D.stato.agenti);
      ui.tridi.filtraZona(ui.zona);
    }
    const mappa = new Map();
    for (const a of D.stato.agenti) {
      const lavoro = D.lavoroVivoDi(a.id);
      const contenuto = lavoro?.content_id
        ? D.stato.contenuti.find(c => c.id === lavoro.content_id)
        : null;
      mappa.set(a.id, { posa: D.posaDi(a.id), lavoro, contenuto });
    }
    ui.tridi.aggiornaStato(D.stato.agenti, mappa);
    ui.tridi.aggiornaCollaborazioni(D.collaborazioni());

    // I fumetti: solo chi ha qualcosa da dire.
    const voci = [];
    for (const a of D.stato.agenti) {
      const d = mappa.get(a.id);
      if (!d?.lavoro) continue;
      const urgente = d.posa === 'mano_alzata';
      voci.push({
        agentId: a.id, nome: a.nome, urgente,
        testo: urgente
          ? (d.lavoro.domanda || 'Ha bisogno di una risposta')
          : (d.lavoro.attivita || testoAttivita(d.lavoro)),
        azione: urgente ? 'Rispondi' : (d.contenuto?.stato === 'da_approvare' ? 'Guarda' : null),
        onAzione: urgente
          ? () => apriRisposta(d.lavoro.id)
          : () => apriContenuto(d.contenuto.id),
      });
    }
    ui.tridi.aggiornaFumetti(voci);
  }

  function testoAttivita(lavoro) {
    if (lavoro.stato === 'in_coda') return 'sta per cominciare';
    return 'sta lavorando';
  }

  // ── Vista a lista ─────────────────────────────────────────
  function disegnaLista() {
    const c = $('rg-lista');
    const agenti = D.stato.agenti.filter(a =>
      ui.zona === 'tutto' || !ui.zona || a.zona === ui.zona);

    if (!agenti.length) {
      c.innerHTML = '<div class="rg-vuoto-tocca">Nessun agente in questa zona.</div>';
      return;
    }

    c.innerHTML = agenti.map(a => {
      const lavoro = D.lavoroVivoDi(a.id);
      const posa = D.posaDi(a.id);
      const colore = { libero: '#9ca3af', attende: '#d97706', lavora: '#16a34a', mano_alzata: '#dc2626' }[posa];
      const contenuto = lavoro?.content_id
        ? D.stato.contenuti.find(x => x.id === lavoro.content_id) : null;
      const cosa = posa === 'mano_alzata'
        ? (lavoro.domanda || 'Ha una domanda per te')
        : posa === 'libero'
          ? 'Libero, in attesa di un lavoro'
          : `${lavoro.attivita || testoAttivita(lavoro)}${contenuto ? ' · ' + esc(contenuto.titolo) : ''}`;

      return `<article class="rg-posto">
        <div class="rg-posto-testa">
          <span class="rg-pallino" style="background:${colore}"></span>
          <div style="flex:1">
            <div class="rg-posto-nome">${esc(a.nome)}</div>
            <div class="rg-posto-ruolo">${esc(a.ruolo)}</div>
          </div>
          <span class="rg-posto-zona">${esc(a.zona)}</span>
        </div>
        <div class="rg-posto-cosa">${cosa}</div>
        <div class="rg-posto-azioni">
          ${posa === 'mano_alzata'
            ? `<button class="btn btn-accent btn-sm" data-rispondi="${lavoro.id}">Rispondi</button>` : ''}
          ${contenuto && contenuto.stato === 'da_approvare'
            ? `<button class="btn btn-accent btn-sm" data-contenuto="${contenuto.id}">Guarda</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-agente="${a.id}">Scrivi</button>
        </div>
      </article>`;
    }).join('');
  }

  // ── Tocca a te ────────────────────────────────────────────
  function disegnaTocca() {
    const c = $('rg-tocca');
    const voci = D.toccaATe();
    if (!voci.length) {
      c.innerHTML = '<div class="rg-vuoto-tocca">Niente in attesa di te. Buon momento per lanciare qualcosa di nuovo.</div>';
      return;
    }
    c.innerHTML = voci.map(v => {
      const classe = v.tipo === 'domanda' || v.tipo === 'respinto' ? 'urgente'
                   : v.tipo === 'cervello' ? 'cervello' : '';
      const attr = v.tipo === 'domanda'      ? `data-rispondi="${v.id}"`
                 : v.tipo === 'cervello'     ? 'data-cervello="1"'
                 : `data-contenuto="${v.id}"`;
      return `<div class="rg-tessera ${classe}">
        <div class="rg-tessera-titolo">${esc(v.titolo)}</div>
        <div class="rg-tessera-testo">${esc(v.testo)}</div>
        <button class="btn btn-accent btn-sm" ${attr}>${esc(v.azione)}</button>
      </div>`;
    }).join('');
  }

  // ── Il pannello laterale ──────────────────────────────────
  function apriPannello(titolo, sotto, html, { conPiede = false, placeholder = 'Scrivi…' } = {}) {
    $('rg-pan-titolo').textContent = titolo;
    $('rg-pan-sotto').textContent = sotto || '';
    $('rg-pan-corpo').innerHTML = html;
    $('rg-pan-piede').hidden = !conPiede;
    $('rg-pan-testo').placeholder = placeholder;
    $('rg-pan-testo').value = '';
    $('rg-pannello').classList.add('aperto');
    $('rg-velo').classList.add('aperto');
    $('rg-pannello').setAttribute('aria-modal', 'true');
  }

  function chiudiPannello() {
    $('rg-pannello').classList.remove('aperto');
    $('rg-velo').classList.remove('aperto');
    $('rg-pannello').setAttribute('aria-modal', 'false');
    ui.pannello = null;
    ui.tridi?.torna();
  }

  function corpoPannello() { return $('rg-pan-corpo'); }

  // ── Pannello di un agente: la chat ────────────────────────
  async function apriAgente(agentId) {
    const a = D.stato.agenti.find(x => x.id === agentId);
    if (!a) return;
    ui.pannello = { tipo: 'agente', id: agentId };
    ui.tridi?.inquadraAgente(agentId);

    apriPannello(a.nome, `${a.ruolo} · ${a.descrizione || ''}`,
      '<div class="rg-vuoto-tocca">Carico…</div>',
      { conPiede: true, placeholder: `Scrivi a ${a.nome}…` });

    const [messaggi, lavori] = await Promise.all([D.messaggiDi(agentId), D.lavoriDi(agentId)]);
    if (ui.pannello?.id !== agentId) return;

    const lavoro = D.lavoroVivoDi(agentId);
    const adesso = lavoro
      ? (lavoro.stato === 'attesa_risposta'
          ? `<div class="rg-nota"><div class="rg-nota-ancora">ti sta aspettando</div>${esc(lavoro.domanda || '')}</div>`
          : `<div class="rg-voce">${esc(lavoro.attivita || testoAttivita(lavoro))}: ${esc(lavoro.titolo)}</div>`)
      : '<div class="rg-vuoto-tocca">Adesso è libero.</div>';

    const fatti = (lavori || []).filter(j => j.stato === 'fatto').slice(0, 6);
    const fattiHtml = fatti.length
      ? fatti.map(j => `<div class="rg-fatto">
            <span class="rg-fatto-stato">fatto</span>
            <span style="flex:1">${esc(j.titolo)}</span>
          </div>`).join('')
      : '<div class="rg-vuoto-tocca">Ancora niente.</div>';

    const chat = (messaggi || []).length
      ? messaggi.map(m => `<div class="rg-bolla ${m.autore === 'utente' ? 'utente' : 'agente'}">${esc(m.testo)}<div class="rg-bolla-ora">${oraBreve(m.created_at)}</div></div>`).join('')
      : '<div class="rg-vuoto-tocca">Non vi siete ancora parlati.</div>';

    corpoPannello().innerHTML = `
      <div class="rg-sez">Cosa fa adesso</div>${adesso}
      <div class="rg-sez">Ultime cose fatte</div>${fattiHtml}
      <div class="rg-sez">Conversazione</div>${chat}`;
    corpoPannello().scrollTop = corpoPannello().scrollHeight;

    $('rg-pan-invia').onclick = async () => {
      const t = $('rg-pan-testo').value.trim();
      if (!t) return;
      $('rg-pan-invia').disabled = true;
      try {
        if (lavoro?.stato === 'attesa_risposta') await D.rispondiAlLavoro(lavoro.id, t);
        else await D.scriviAdAgente(agentId, t);
        window.ui.showToast('Mandato.', 'success');
        await apriAgente(agentId);
      } catch (e) {
        window.ui.showToast('Non è partito: ' + e.message, 'error');
      } finally { $('rg-pan-invia').disabled = false; }
    };
  }

  function oraBreve(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const oggi = new Date().toDateString() === d.toDateString();
    return oggi
      ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' +
        d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Rispondere alla domanda di un agente ──────────────────
  function apriRisposta(jobId) {
    const j = D.stato.lavori.find(x => x.id === jobId);
    if (!j) return;
    const a = D.stato.agenti.find(x => x.id === j.agent_id);
    if (a) return apriAgente(a.id);
  }

  // ══════════════════════════════════════════════════════════
  // La revisione di un contenuto
  // ══════════════════════════════════════════════════════════
  async function apriContenuto(contentId) {
    ui.pannello = { tipo: 'contenuto', id: contentId };
    ui.slideScelta = 0;
    apriPannello('Contenuto', '', '<div class="rg-vuoto-tocca">Carico…</div>');

    const [c, versioni, note, media] = await Promise.all([
      D.contenuto(contentId), D.versioni(contentId), D.note(contentId), D.mediaDi(contentId),
    ]);
    if (!c || ui.pannello?.id !== contentId) return;

    ui.roundB = versioni?.length ? versioni[versioni.length - 1].round : null;
    ui.roundA = versioni?.length > 1 ? versioni[0].round : null;

    disegnaContenuto(c, versioni || [], note || [], media || []);
  }

  const ETICHETTE_STATO = {
    idea: ['Idea', 'blu'], in_lavorazione: ['In lavorazione', 'blu'],
    da_revisione: ['In revisione', 'gialla'], respinto: ['Fermato dal Revisore', 'rossa'],
    da_approvare: ['Da approvare', 'gialla'], approvato: ['Approvato', 'verde'],
    in_calendario: ['In calendario', 'verde'], programmato: ['Programmato', 'verde'],
    pubblicato: ['Pubblicato', 'verde'],
  };

  function disegnaContenuto(c, versioni, note, media) {
    const [et, cls] = ETICHETTE_STATO[c.stato] || [c.stato, ''];
    $('rg-pan-titolo').textContent = c.titolo;
    $('rg-pan-sotto').innerHTML =
      `<span class="rg-pillola ${cls}">${esc(et)}</span> ` +
      `<span class="rg-pillola">${esc(c.tipo)}</span>` +
      (c.pillar ? ` <span class="rg-pillola">${esc(c.pillar)}</span>` : '');

    const violazioni = c.revisore_note?.violazioni || [];
    const html = [];

    // ── il verdetto del Revisore, se ha qualcosa da dire ──
    if (violazioni.length) {
      html.push('<div class="rg-sez">Il Revisore ha segnalato</div>');
      for (const v of violazioni) {
        const avv = v.gravita === 'avvertimento';
        html.push(`<div class="rg-violazione ${avv ? 'avvertimento' : ''}">
          <div class="rg-viol-regola">${esc(v.regola || '')} · ${avv ? 'da sistemare' : 'blocca la pubblicazione'}</div>
          <div style="margin:3px 0"><b>${esc(v.testo)}</b></div>
          <div>→ ${esc(v.correzione)}</div>
        </div>`);
      }
      if (c.revisore_note?.commento) {
        html.push(`<div class="rg-voce">${esc(c.revisore_note.commento)}</div>`);
      }
    }
    if (c.revisore_note?.bloccato_dal_database) {
      html.push(`<div class="rg-violazione">
        <div class="rg-viol-regola">fermato dal portale</div>
        <div>${esc(c.revisore_note.bloccato_dal_database)}</div></div>`);
    }

    // ── il lettore ──
    html.push('<div class="rg-sez">Anteprima</div>');
    html.push(lettore(c, media));

    // ── le note, agganciate ──
    html.push('<div class="rg-sez">Note</div>');
    html.push(`<div style="display:flex;gap:7px;margin-bottom:9px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="rg-aggiungi-nota">Aggiungi la nota</button>
      ${c.stato === 'da_approvare'
        ? '<button class="btn btn-accent btn-sm" id="rg-a-posto">È a posto così</button>' : ''}
      ${c.stato === 'respinto'
        ? '<button class="btn btn-ghost btn-sm" id="rg-rimanda">Rimanda a chi l\'ha scritto</button>' : ''}
    </div>`);
    html.push(note.length
      ? note.map(n => `<div class="rg-nota ${n.risolta ? 'risolta' : ''}">
            <div class="rg-nota-ancora">${esc(descriviAncora(n.ancora))}</div>
            ${esc(n.testo)}
            ${n.risolta ? '' : `<div style="margin-top:6px"><button class="btn btn-ghost btn-sm" data-risolvi="${n.id}">Sistemata</button></div>`}
          </div>`).join('')
      : '<div class="rg-vuoto-tocca">Nessuna nota.</div>');

    // ── confronto dei round ──
    if (versioni.length > 1) {
      html.push('<div class="rg-sez">Confronta i round</div>');
      const opzioni = (sel) => versioni.map(v =>
        `<option value="${v.round}" ${v.round === sel ? 'selected' : ''}>Round ${v.round}</option>`).join('');
      html.push(`<div style="display:flex;gap:8px;align-items:center;margin-bottom:9px">
        <select id="rg-round-a" class="form-input" style="flex:1">${opzioni(ui.roundA)}</select>
        <span style="color:var(--text-muted);font-size:12px">contro</span>
        <select id="rg-round-b" class="form-input" style="flex:1">${opzioni(ui.roundB)}</select>
      </div>`);
      html.push(`<div class="rg-confronto" id="rg-confronto"></div>`);
    }

    // ── caption e hashtag ──
    if (c.caption) {
      html.push('<div class="rg-sez">Testo</div>');
      html.push(`<div class="rg-colonna" style="max-height:none">${esc(c.caption)}</div>`);
    }
    if (c.hashtags?.length) {
      html.push(`<div class="rg-voce-fonte" style="margin-top:7px">${esc(c.hashtags.join(' '))}</div>`);
    }

    // ── dopo l'approvazione: cosa aspetta ──
    if (c.stato === 'approvato' || c.stato === 'in_calendario' || c.stato === 'programmato') {
      html.push(dopoAprovazione(c));
    }

    if (c.errore_pubblicazione) {
      html.push(`<div class="rg-violazione" style="margin-top:12px">
        <div class="rg-viol-regola">la pubblicazione non è andata</div>
        <div>${esc(c.errore_pubblicazione)}</div></div>`);
    }

    corpoPannello().innerHTML = html.join('');
    $('rg-pan-piede').hidden = true;

    // ── agganci ──
    $('rg-aggiungi-nota')?.addEventListener('click', () => chiediNota(c, media));
    $('rg-a-posto')?.addEventListener('click', () => approvaContenuto(c));
    $('rg-rimanda')?.addEventListener('click', () => {
      // Un contenuto fermato dal Revisore non si approva scavalcandolo: si
      // rimanda indietro con l'indicazione di cosa cambiare.
      modale('Rimanda indietro', `
        <div class="form-group">
          <label class="form-label" for="rg-rim-testo">Cosa deve cambiare</label>
          <textarea class="form-input" id="rg-rim-testo" rows="4"
            placeholder="Riprendi le segnalazioni del Revisore e aggiungi cosa vuoi tu."></textarea>
        </div>`,
        [{ etichetta: 'Rimanda', primaria: true, azione: async () => {
            const t = $('rg-rim-testo').value.trim();
            if (!t) return window.ui.showToast('Scrivi cosa deve cambiare.', 'error');
            await D.rimandaIndietro(c.id, t);
            chiudiModale();
            window.ui.showToast('Rimandato indietro.', 'success');
            apriContenuto(c.id);
          } }]);
    });
    corpoPannello().querySelectorAll('[data-risolvi]').forEach(b =>
      b.addEventListener('click', async () => {
        await D.risolviNota(b.dataset.risolvi);
        apriContenuto(c.id);
      }));
    corpoPannello().querySelectorAll('[data-slide]').forEach(b =>
      b.addEventListener('click', () => {
        ui.slideScelta = Number(b.dataset.slide);
        disegnaContenuto(c, versioni, note, media);
      }));
    const selA = $('rg-round-a'), selB = $('rg-round-b');
    if (selA && selB) {
      const aggiorna = () => {
        ui.roundA = Number(selA.value); ui.roundB = Number(selB.value);
        disegnaConfronto(versioni);
      };
      selA.addEventListener('change', aggiorna);
      selB.addEventListener('change', aggiorna);
      disegnaConfronto(versioni);
    }
    // I media privati si aprono con un link firmato, mai pubblico.
    corpoPannello().querySelectorAll('[data-media-path]').forEach(el => {
      D.linkFirmato(el.dataset.mediaPath).then(url => { el.src = url; })
        .catch(() => { el.replaceWith(document.createTextNode('Anteprima non disponibile.')); });
    });
  }

  function descriviAncora(a) {
    if (!a || a.tipo === 'generale') return 'sul contenuto';
    if (a.tipo === 'video') {
      const s = Number(a.secondo || 0);
      const m = Math.floor(s / 60), r = Math.floor(s % 60);
      return `al minuto ${m}:${String(r).padStart(2, '0')}`;
    }
    if (a.tipo === 'slide') return `sulla slide ${Number(a.slide) + 1}`;
    if (a.tipo === 'testo')  return 'su un pezzo di testo';
    return 'sul contenuto';
  }

  function lettore(c, media) {
    const video = media.find(m => (m.mime || '').startsWith('video') && m.ruolo !== 'reference');
    const anteprima = media.find(m => m.ruolo === 'anteprima');
    const immagini = media.filter(m => (m.mime || '').startsWith('image') && m.ruolo !== 'reference');

    if (video || anteprima) {
      const m = anteprima || video;
      return `<div class="rg-lettore">
        <video id="rg-video" controls preload="metadata" data-media-path="${esc(m.path)}"></video>
      </div>
      <div class="rg-voce-fonte">L'anteprima si apre con un indirizzo che scade: i file non sono pubblici.</div>`;
    }

    const slides = Array.isArray(c.slides) ? c.slides : [];
    if (slides.length) {
      const i = Math.min(ui.slideScelta, slides.length - 1);
      const s = slides[i] || {};
      const strip = slides.map((sl, k) =>
        `<button class="rg-slide-min" data-slide="${k}" aria-current="${k === i}">
           ${esc((sl.title || sl.titolo || ('Slide ' + (k + 1))).slice(0, 26))}
         </button>`).join('');
      const corpo = s.body || s.testo || '';
      const stats = Array.isArray(s.stats) ? s.stats : null;
      return `<div class="rg-lettore">
        <div class="rg-anteprima-slide">
          ${s.badge ? `<div class="rg-as-badge">${esc(s.badge)}</div>` : ''}
          <div class="rg-as-titolo">${esc(s.title || s.titolo || '')}</div>
          ${stats
            ? stats.map(x => `<div class="rg-as-corpo"><b style="color:#b5ff00">${esc(x.value)}</b> ${esc(x.label)} — ${esc(x.desc || '')}</div>`).join('')
            : `<div class="rg-as-corpo">${esc(corpo)}</div>`}
        </div>
        <div class="rg-slide-strip">${strip}</div>
      </div>`;
    }

    if (immagini.length) {
      return `<div class="rg-lettore">
        <img alt="Anteprima del contenuto" data-media-path="${esc(immagini[0].path)}">
      </div>`;
    }

    return '<div class="rg-vuoto-tocca">Non c\'è ancora niente da guardare: il contenuto è solo un\'idea.</div>';
  }

  /** Confronto fra due round: le differenze parola per parola. */
  function disegnaConfronto(versioni) {
    const box = $('rg-confronto');
    if (!box) return;
    const a = versioni.find(v => v.round === ui.roundA);
    const b = versioni.find(v => v.round === ui.roundB);
    if (!a || !b) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div><div class="rg-voce-codice">Round ${a.round}</div>
        <div class="rg-colonna">${diffParole(a.caption || '', b.caption || '', 'via')}</div>
        ${a.sintesi ? `<div class="rg-voce-fonte">${esc(a.sintesi)}</div>` : ''}</div>
      <div><div class="rg-voce-codice">Round ${b.round}</div>
        <div class="rg-colonna">${diffParole(b.caption || '', a.caption || '', 'nuovo')}</div>
        ${b.sintesi ? `<div class="rg-voce-fonte">${esc(b.sintesi)}</div>` : ''}</div>`;
  }

  /**
   * Differenze parola per parola, con la sottosequenza comune piu' lunga.
   * Serve a far vedere cosa e' cambiato fra due round, non a essere un
   * motore di diff: i testi sono caption, non file.
   */
  function diffParole(mio, altro, modo) {
    const A = mio.split(/(\s+)/), B = altro.split(/(\s+)/);
    const n = A.length, m = B.length;
    if (n * m > 400000) return esc(mio);   // testi lunghi: niente diff
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    let i = 0, j = 0, out = '';
    while (i < n) {
      if (j < m && A[i] === B[j]) { out += esc(A[i]); i++; j++; }
      else if (j < m && L[i + 1][j] >= L[i][j + 1]) {
        out += modo === 'nuovo' ? `<ins>${esc(A[i])}</ins>` : `<del>${esc(A[i])}</del>`;
        i++;
      } else if (j < m) { j++; }
      else {
        out += modo === 'nuovo' ? `<ins>${esc(A[i])}</ins>` : `<del>${esc(A[i])}</del>`;
        i++;
      }
    }
    return out;
  }

  /** Dopo l'approvazione: i passaggi che restano. */
  function dopoAprovazione(c) {
    const passi = [];
    if (!c.slot_at) passi.push('Trascinalo su un giorno nel Calendario per decidere quando esce.');
    else passi.push(`Esce il ${window.ui.formatDate(c.slot_at)} alle ${new Date(c.slot_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}, ora di Dubai.`);
    const doppia = D.stato.impostazioni?.doppia_approvazione;
    const sensibile = c.sensibile ||
      (D.stato.impostazioni?.categorie_sensibili || []).includes(c.categoria);
    if (doppia && sensibile && !c.approvato_admin_da) {
      passi.push('Questa categoria è sensibile: serve anche la conferma dell\'amministratore prima dell\'uscita.');
    }
    passi.push('Il Pubblicatore lo manda su GoHighLevel quando arriva l\'ora.');
    return `<div class="rg-dopo">
      <div class="rg-sez" style="margin-top:0">Dopo ti aspettano</div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6">
        ${passi.map(p => `<li>${esc(p)}</li>`).join('')}
      </ul>
      ${doppia && sensibile && !c.approvato_admin_da && window.sb?.isAdmin?.()
        ? `<button class="btn btn-accent btn-sm" style="margin-top:9px" id="rg-approva-admin">Confermo come amministratore</button>` : ''}
    </div>`;
  }

  async function approvaContenuto(c) {
    try {
      await D.approva(c.id);
      window.ui.showToast('Approvato.', 'success');
      apriContenuto(c.id);
    } catch (e) {
      // Il messaggio del database e' scritto per una persona: si mostra.
      window.ui.showToast(pulisciErrore(e.message), 'error');
    }
  }

  function pulisciErrore(m) {
    return String(m || '')
      .replace(/^ERROR:\s*/i, '')
      .replace(/\s*CONTEXT:[\s\S]*$/i, '')
      .trim() || 'Non è andata.';
  }

  /** La nota si aggancia a dove sta guardando il manager. */
  function chiediNota(c, media) {
    const video = $('rg-video');
    const slides = Array.isArray(c.slides) ? c.slides : [];
    // La nota si aggancia a dove sta guardando: il secondo del video se c'e'
    // un video aperto, la slide scelta se e' un carosello.
    let ancora = { tipo: 'generale' };
    let dove = 'su tutto il contenuto';
    if (video && video.currentTime > 0) {
      ancora = { tipo: 'video', secondo: Number(video.currentTime.toFixed(2)) };
      dove = descriviAncora(ancora);
    } else if (slides.length) {
      ancora = { tipo: 'slide', slide: Math.min(ui.slideScelta, slides.length - 1) };
      dove = descriviAncora(ancora);
    }

    modale('Aggiungi la nota', `
      <div class="form-group">
        <label class="form-label">Dove</label>
        <div class="rg-voce">${esc(dove)}</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="rg-nota-testo">Cosa va cambiato</label>
        <textarea class="form-input" id="rg-nota-testo" rows="4"
          placeholder="Scrivilo come lo diresti a voce. Diventa anche una nota nel Cervello, così non si ripete."></textarea>
      </div>`,
      [{ etichetta: 'Salva la nota', primaria: true, azione: async () => {
          const t = $('rg-nota-testo').value.trim();
          if (!t) return window.ui.showToast('Scrivi cosa va cambiato.', 'error');
          await D.aggiungiNota(c.id, t, ancora);
          chiudiModale();
          window.ui.showToast('Nota salvata. Finisce anche nel Cervello.', 'success');
          apriContenuto(c.id);
        } }]);
    setTimeout(() => $('rg-nota-testo')?.focus(), 60);
  }

  // ══════════════════════════════════════════════════════════
  // Il Cervello
  // ══════════════════════════════════════════════════════════
  async function apriCervello() {
    ui.pannello = { tipo: 'cervello', id: 'cervello' };
    const c = D.stato.cervelloContatori;
    apriPannello('Cervello condiviso',
      'La memoria del brand: ogni agente la legge prima di lavorare.',
      `<div class="rg-contatori">
        <div class="rg-contatore"><div class="rg-cont-num">${c.regola}</div><div class="rg-cont-et">regole e istruzioni</div></div>
        <div class="rg-contatore"><div class="rg-cont-num">${c.nota}</div><div class="rg-cont-et">note dalle revisioni</div></div>
        <div class="rg-contatore"><div class="rg-cont-num">${c.studio}</div><div class="rg-cont-et">studi di reference</div></div>
        <div class="rg-contatore"><div class="rg-cont-num">${c.design}</div><div class="rg-cont-et">design in libreria</div></div>
      </div>
      <div class="rg-sez">Cerca</div>
      <input class="form-input" id="rg-cervello-q" placeholder="Per esempio: tono delle caption, soglia Corporate Tax, formato carosello">
      <div id="rg-cervello-conferme"></div>
      <div class="rg-sez">Voci</div>
      <div id="rg-cervello-esiti"><div class="rg-vuoto-tocca">Carico…</div></div>`);

    const input = $('rg-cervello-q');
    let attesa = null;
    input.addEventListener('input', () => {
      clearTimeout(attesa);
      attesa = setTimeout(() => cercaNelCervello(input.value), 260);
    });
    await disegnaConferme();
    await cercaNelCervello('');
  }

  async function disegnaConferme() {
    const box = $('rg-cervello-conferme');
    if (!box) return;
    const da = await D.cervelloDaConfermare().catch(() => []);
    if (!da?.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="rg-sez">Da confermare</div>
      <div class="rg-vuoto-tocca" style="margin-bottom:8px">
        Nate dalle tue correzioni. Entrano in vigore quando le confermi.
      </div>` +
      da.map(v => `<div class="rg-voce" style="border-left:3px solid var(--warning)">
        ${esc(v.testo)}
        <div class="rg-voce-fonte">${esc(v.fonte || '')}</div>
        <div class="rg-voce-azioni">
          <button class="btn btn-accent btn-sm" data-conferma="${v.id}">Confermo</button>
          <button class="btn btn-ghost btn-sm" data-scarta="${v.id}">Lascia perdere</button>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-conferma]').forEach(b => b.addEventListener('click', async () => {
      await D.cervelloConferma(b.dataset.conferma);
      ui.tridi?.pulsaCervello();
      window.ui.showToast('Confermata: da adesso gli agenti la seguono.', 'success');
      apriCervello();
    }));
    box.querySelectorAll('[data-scarta]').forEach(b => b.addEventListener('click', async () => {
      await D.cervelloScarta(b.dataset.scarta);
      apriCervello();
    }));
  }

  async function cercaNelCervello(q) {
    const box = $('rg-cervello-esiti');
    if (!box) return;
    try {
      const righe = await D.cervelloCerca(q, null, 60);
      box.innerHTML = (righe || []).length
        ? righe.map(v => `<div class="rg-voce ${v.vincolante ? 'vincolante' : ''}">
            <div class="rg-voce-codice">${esc(v.codice || v.tipo)}${v.vincolante ? ' · non si discute' : ''}</div>
            ${esc(v.testo)}
            ${v.fonte ? `<div class="rg-voce-fonte">${esc(v.fonte)}</div>` : ''}
          </div>`).join('')
        : '<div class="rg-vuoto-tocca">Niente su questo.</div>';
    } catch (e) {
      box.innerHTML = `<div class="rg-vuoto-tocca">La ricerca non ha funzionato: ${esc(e.message)}</div>`;
    }
  }

  // ══════════════════════════════════════════════════════════
  // Calendario
  // ══════════════════════════════════════════════════════════
  function disegnaCalendario() {
    const contenuti = D.stato.contenuti;
    const pezzo = (c) => `<div class="rg-pezzo" draggable="true" data-pezzo="${c.id}">
        <div class="rg-pezzo-tit">${esc(c.titolo)}</div>
        <div class="rg-pezzo-meta">${esc((ETICHETTE_STATO[c.stato] || [c.stato])[0])} · ${esc(c.tipo)}</div>
      </div>`;

    const liberi = contenuti.filter(c => c.stato === 'approvato' && !c.slot_at);
    const inCal  = contenuti.filter(c => ['in_calendario', 'programmato'].includes(c.stato));
    const inLav  = contenuti.filter(c => ['idea', 'in_lavorazione', 'da_revisione', 'respinto', 'da_approvare'].includes(c.stato));

    const vuoto = (t) => `<div class="rg-vuoto-tocca">${t}</div>`;
    $('rg-mucchio-liberi').innerHTML = liberi.length
      ? liberi.map(pezzo).join('') : vuoto('Niente di approvato in attesa di una data.');
    $('rg-mucchio-calendario').innerHTML = inCal.length
      ? inCal.map(pezzo).join('') : vuoto('Nessuna uscita fissata.');
    $('rg-mucchio-lavorazione').innerHTML = inLav.length
      ? inLav.map(pezzo).join('') : vuoto('Niente in lavorazione.');

    // Due settimane a partire dal lunedi' di questa.
    const oggi = new Date();
    const lunedi = new Date(oggi);
    const g = (lunedi.getDay() + 6) % 7;
    lunedi.setDate(lunedi.getDate() - g);
    lunedi.setHours(0, 0, 0, 0);

    const giorni = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(lunedi);
      d.setDate(d.getDate() + i);
      giorni.push(d);
    }

    const NOMI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    $('rg-griglia').innerHTML = giorni.map(d => {
      const chiave = d.toISOString().slice(0, 10);
      const dentro = contenuti.filter(c =>
        c.slot_at && new Date(c.slot_at).toISOString().slice(0, 10) === chiave);
      const eOggi = d.toDateString() === oggi.toDateString();
      return `<div class="rg-giorno ${eOggi ? 'oggi' : ''}" data-giorno="${chiave}">
        <div class="rg-giorno-et">${NOMI[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}</div>
        ${dentro.map(pezzo).join('')}
      </div>`;
    }).join('');

    agganciaTrascinamento();
  }

  function agganciaTrascinamento() {
    let preso = null;

    for (const p of document.querySelectorAll('[data-pezzo]')) {
      p.addEventListener('dragstart', (ev) => {
        preso = p.dataset.pezzo;
        p.classList.add('trascina');
        ev.dataTransfer.setData('text/plain', preso);
        ev.dataTransfer.effectAllowed = 'move';
      });
      p.addEventListener('dragend', () => { p.classList.remove('trascina'); preso = null; });
      p.addEventListener('click', () => apriContenuto(p.dataset.pezzo));
    }

    const lascia = async (contentId, quando) => {
      try {
        await D.spostaInCalendario(contentId, quando);
        window.ui.showToast(quando ? 'Messo in calendario.' : 'Tolto dal calendario.', 'success');
      } catch (e) {
        window.ui.showToast(pulisciErrore(e.message), 'error');
      }
      disegnaCalendario();
    };

    for (const g of document.querySelectorAll('[data-giorno]')) {
      g.addEventListener('dragover', (ev) => { ev.preventDefault(); g.classList.add('sopra'); });
      g.addEventListener('dragleave', () => g.classList.remove('sopra'));
      g.addEventListener('drop', (ev) => {
        ev.preventDefault();
        g.classList.remove('sopra');
        const id = ev.dataTransfer.getData('text/plain') || preso;
        if (!id) return;
        // Ore 18 di Dubai: l'ora buona per i social, e si puo' cambiare
        // aprendo il contenuto.
        lascia(id, `${g.dataset.giorno}T18:00:00+04:00`);
      });
    }

    // Trascinare su "Da mettere in un giorno" toglie la data.
    const mucchio = $('rg-mucchio-liberi');
    mucchio.addEventListener('dragover', (ev) => ev.preventDefault());
    mucchio.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer.getData('text/plain') || preso;
      if (id) lascia(id, null);
    });
  }

  // ══════════════════════════════════════════════════════════
  // Risultati
  // ══════════════════════════════════════════════════════════
  async function disegnaRisultati() {
    const box = $('rg-risultati');
    box.innerHTML = '<div class="rg-vuoto-tocca">Carico…</div>';
    let righe = [];
    try { righe = await D.risultati(); } catch (e) {
      box.innerHTML = `<div class="rg-vuoto-tocca">Non riesco a leggere i risultati: ${esc(e.message)}</div>`;
      return;
    }

    const pubblicati = D.stato.contenuti.filter(c => c.stato === 'pubblicato');

    if (!righe.length) {
      box.innerHTML = `
        <div class="rg-conclusione">
          <b>Qui non ci sono ancora numeri, e vale la pena dire perché.</b><br>
          Le metriche di Instagram non arrivano da sole: GoHighLevel pubblica,
          ma non restituisce reach, salvataggi e click dei post pubblicati.
          Per averli servono le credenziali del profilo Instagram Business
          collegato, cioè un passaggio che devi autorizzare tu una volta.<br>
          Nel frattempo i numeri si possono inserire a mano su ogni contenuto
          pubblicato: due minuti a settimana, e i confronti qui sotto cominciano
          a funzionare.
        </div>
        ${pubblicati.length ? `
          <div class="rg-sez">Contenuti pubblicati, in attesa di numeri</div>
          ${pubblicati.map(c => `<div class="rg-voce">
            <b>${esc(c.titolo)}</b>
            <div class="rg-voce-fonte">${esc(c.tipo)} · uscito il ${window.ui.formatDate(c.pubblicato_at || c.slot_at)}</div>
            <div class="rg-voce-azioni">
              <button class="btn btn-ghost btn-sm" data-numeri="${c.id}">Inserisci i numeri</button>
            </div>
          </div>`).join('')}`
          : '<div class="rg-vuoto-tocca">Nessun contenuto pubblicato per ora.</div>'}`;
      agganciaNumeri();
      return;
    }

    // ── aggregati ──
    const somma = (k) => righe.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const kpi = [
      ['Reach', somma('reach')], ['Salvataggi', somma('saves')],
      ['Click', somma('clicks')], ['Nuovi follower', somma('follower_delta')],
      ['Commenti', somma('comments')], ['Contenuti misurati', new Set(righe.map(r => r.content_id)).size],
    ];

    // ── il confronto che alimenta il Cervello ──
    const perPillar = new Map();
    for (const r of righe) {
      const p = r.smm_contents?.pillar || 'senza pillar';
      const t = r.smm_contents?.tipo || '—';
      const k = `${t} · ${p}`;
      if (!perPillar.has(k)) perPillar.set(k, { n: 0, reach: 0, saves: 0 });
      const v = perPillar.get(k);
      v.n++; v.reach += Number(r.reach) || 0; v.saves += Number(r.saves) || 0;
    }
    const classifica = [...perPillar.entries()]
      .map(([k, v]) => ({ k, n: v.n, mediaSaves: v.saves / v.n, mediaReach: v.reach / v.n }))
      .filter(x => x.n >= 2)
      .sort((a, b) => b.mediaSaves - a.mediaSaves);

    let conclusione = '';
    if (classifica.length >= 2) {
      const su = classifica[0], giu = classifica[classifica.length - 1];
      if (giu.mediaSaves > 0) {
        const volte = su.mediaSaves / giu.mediaSaves;
        if (volte >= 1.4) {
          conclusione = `I contenuti <b>${esc(su.k)}</b> si salvano ${volte.toFixed(1)} volte più di <b>${esc(giu.k)}</b> (${su.n} e ${giu.n} contenuti misurati).`;
        }
      }
    }

    box.innerHTML = `
      <div class="rg-kpi">
        ${kpi.map(([et, n]) => `<div class="rg-kpi-card">
          <div class="rg-kpi-num">${Number(n).toLocaleString('it-IT')}</div>
          <div class="rg-kpi-et">${esc(et)}</div></div>`).join('')}
      </div>
      ${conclusione ? `<div class="rg-conclusione">
          ${conclusione}
          <div style="margin-top:9px">
            <button class="btn btn-accent btn-sm" id="rg-al-cervello">Mandalo al Cervello</button>
          </div>
        </div>` : ''}
      <div class="rg-sez">Per contenuto</div>
      ${righe.map(r => `<div class="rg-voce">
        <b>${esc(r.smm_contents?.titolo || '—')}</b>
        <div class="rg-voce-fonte">
          ${esc(r.smm_contents?.tipo || '')} · ${window.ui.formatDate(r.data)} ·
          reach ${Number(r.reach || 0).toLocaleString('it-IT')} ·
          salvataggi ${Number(r.saves || 0).toLocaleString('it-IT')} ·
          click ${Number(r.clicks || 0).toLocaleString('it-IT')}
          ${r.fonte === 'manuale' ? ' · inseriti a mano' : ''}
        </div>
        <div class="rg-voce-azioni">
          <button class="btn btn-ghost btn-sm" data-numeri="${r.content_id}">Correggi i numeri</button>
        </div>
      </div>`).join('')}
      ${pubblicati.filter(c => !righe.some(r => r.content_id === c.id)).length ? `
        <div class="rg-sez">Pubblicati senza numeri</div>
        ${pubblicati.filter(c => !righe.some(r => r.content_id === c.id)).map(c =>
          `<div class="rg-voce"><b>${esc(c.titolo)}</b>
            <div class="rg-voce-azioni">
              <button class="btn btn-ghost btn-sm" data-numeri="${c.id}">Inserisci i numeri</button>
            </div></div>`).join('')}` : ''}`;

    agganciaNumeri();
    $('rg-al-cervello')?.addEventListener('click', async () => {
      const testo = conclusione.replace(/<[^>]+>/g, '');
      await D.cervelloAggiungi('nota', testo, `Risultati al ${window.ui.formatDate(new Date())}`, ['risultati']);
      ui.tridi?.pulsaCervello();
      window.ui.showToast('Finito nel Cervello: gli agenti ne terranno conto.', 'success');
    });
  }

  function agganciaNumeri() {
    document.querySelectorAll('[data-numeri]').forEach(b =>
      b.addEventListener('click', () => chiediNumeri(b.dataset.numeri)));
  }

  function chiediNumeri(contentId) {
    const c = D.stato.contenuti.find(x => x.id === contentId);
    const campo = (id, et) =>
      `<div class="form-group" style="flex:1;min-width:116px">
        <label class="form-label" for="rg-n-${id}">${et}</label>
        <input class="form-input" id="rg-n-${id}" type="number" min="0" inputmode="numeric">
      </div>`;
    modale(`Numeri di "${c?.titolo || 'questo contenuto'}"`, `
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        ${campo('reach', 'Reach')}${campo('saves', 'Salvataggi')}${campo('clicks', 'Click')}
      </div>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        ${campo('likes', 'Like')}${campo('comments', 'Commenti')}${campo('follower_delta', 'Nuovi follower')}
      </div>
      <div class="rg-voce-fonte">Si prendono dalle statistiche del profilo. Si possono correggere quando si vuole.</div>`,
      [{ etichetta: 'Salva', primaria: true, azione: async () => {
          const n = (k) => {
            const v = $('rg-n-' + k).value;
            return v === '' ? null : Number(v);
          };
          await D.salvaRisultato(contentId, {
            reach: n('reach'), saves: n('saves'), clicks: n('clicks'),
            likes: n('likes'), comments: n('comments'), follower_delta: n('follower_delta'),
          });
          chiudiModale();
          window.ui.showToast('Salvati.', 'success');
          disegnaRisultati();
        } }]);
  }

  // ══════════════════════════════════════════════════════════
  // Modali
  // ══════════════════════════════════════════════════════════
  function modale(titolo, corpo, azioni) {
    $('rg-modale-titolo').textContent = titolo;
    $('rg-modale-corpo').innerHTML = corpo;
    $('rg-modale-azioni').innerHTML = '';
    for (const a of azioni || []) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.primaria ? 'btn-accent' : 'btn-ghost');
      b.textContent = a.etichetta;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await a.azione(); }
        catch (e) { window.ui.showToast(pulisciErrore(e.message), 'error'); }
        finally { b.disabled = false; }
      });
      $('rg-modale-azioni').appendChild(b);
    }
    const annulla = document.createElement('button');
    annulla.className = 'btn btn-ghost';
    annulla.textContent = 'Annulla';
    annulla.addEventListener('click', chiudiModale);
    $('rg-modale-azioni').appendChild(annulla);
    $('rg-modale').style.display = 'flex';
  }
  function chiudiModale() { $('rg-modale').style.display = 'none'; }

  function nuovoLavoro() {
    modale('Nuovo lavoro', `
      <div class="form-group">
        <label class="form-label" for="rg-nl-testo">Cosa facciamo?</label>
        <textarea class="form-input" id="rg-nl-testo" rows="4"
          placeholder="Scrivilo come lo diresti al telefono. Per esempio: un carosello sulla soglia dei 375.000 AED, che spieghi perché registrarsi serve anche sotto soglia."></textarea>
      </div>
      <div class="rg-voce-fonte">Lo legge il Direttore: sceglie lui l'agente giusto e gli passa il lavoro.</div>`,
      [{ etichetta: 'Manda al Direttore', primaria: true, azione: async () => {
          const t = $('rg-nl-testo').value.trim();
          if (!t) return window.ui.showToast('Scrivi cosa ti serve.', 'error');
          await D.scriviAlDirettore(t);
          chiudiModale();
          window.ui.showToast('Il Direttore ci sta già pensando.', 'success');
        } }]);
    setTimeout(() => $('rg-nl-testo')?.focus(), 60);
  }

  function nuovaReference() {
    const agenti = D.stato.agenti.filter(a =>
      ['stratega', 'copywriter', 'grafico', 'video'].includes(a.slug));
    modale('Reference', `
      <div class="form-group">
        <label class="form-label" for="rg-rf-url">Un link che ti piace</label>
        <input class="form-input" id="rg-rf-url" type="url" placeholder="https://…">
      </div>
      <div class="form-group">
        <label class="form-label" for="rg-rf-testo">Oppure incollalo qui, o scrivi cosa ti piace</label>
        <textarea class="form-input" id="rg-rf-testo" rows="3"
          placeholder="Il ritmo delle frasi, il modo di aprire, il taglio delle immagini…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="rg-rf-file">Oppure carica un'immagine o un video</label>
        <input class="form-input" id="rg-rf-file" type="file" accept="image/*,video/*">
        <div class="rg-avanzamento" id="rg-rf-barra" hidden><i></i></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="rg-rf-agente">Chi lo studia</label>
        <select class="form-input" id="rg-rf-agente">
          ${agenti.map(a => `<option value="${a.slug}">${esc(a.nome)} — ${esc(a.ruolo)}</option>`).join('')}
        </select>
      </div>
      <div class="rg-voce-fonte">Lo studio che ne ricava finisce nel Cervello, e da lì lo leggono tutti.</div>`,
      [{ etichetta: 'Studia questo stile', primaria: true, azione: async () => {
          const url = $('rg-rf-url').value.trim();
          const testo = $('rg-rf-testo').value.trim();
          const file = $('rg-rf-file').files?.[0];
          if (!url && !testo && !file) {
            return window.ui.showToast('Serve almeno un link, un testo o un file.', 'error');
          }
          let mediaId = null;
          if (file) {
            const barra = $('rg-rf-barra');
            barra.hidden = false;
            const m = await D.caricaFile(file, {
              ruolo: 'reference',
              onProgress: (p) => { barra.firstElementChild.style.width = (p * 100).toFixed(0) + '%'; },
            });
            mediaId = m?.id || null;
          }
          await D.nuovaReference({ url, testo, mediaId, agenteSlug: $('rg-rf-agente').value });
          chiudiModale();
          window.ui.showToast('Passato. Lo studio arriva nel Cervello.', 'success');
        } }]);
  }

  // ══════════════════════════════════════════════════════════
  // Viste
  // ══════════════════════════════════════════════════════════
  function cambiaVista(quale) {
    ui.vista = quale;
    for (const b of document.querySelectorAll('[data-vista]')) {
      b.setAttribute('aria-selected', String(b.dataset.vista === quale));
    }
    $('rg-vista-sala').hidden = quale !== 'sala';
    $('rg-vista-calendario').hidden = quale !== 'calendario';
    $('rg-vista-risultati').hidden = quale !== 'risultati';
    $('rg-filtro').style.display = quale === 'sala' ? '' : 'none';
    $('rg-btn-vista').style.display = quale === 'sala' ? '' : 'none';
    if (quale === 'calendario') disegnaCalendario();
    if (quale === 'risultati') disegnaRisultati();
    if (quale === 'sala' && ui.usaTridi) accendiTridi();
  }

  // ══════════════════════════════════════════════════════════
  // Avvio
  // ══════════════════════════════════════════════════════════
  function reagisci() {
    disegnaTesta();
    disegnaTocca();
    if (ui.vista === 'sala') {
      disegnaLista();
      sincronizzaTridi(cambiatiGliAgenti());
    }
    if (ui.vista === 'calendario') disegnaCalendario();

    // Il Cervello pulsa quando entra qualcosa di nuovo.
    const c = D.stato.cervelloContatori;
    const prec = ui.cervelloContatoriPrec;
    if (prec) {
      const prima = prec.regola + prec.nota + prec.studio + prec.design + prec.daConfermare;
      const dopo  = c.regola + c.nota + c.studio + c.design + c.daConfermare;
      if (dopo > prima) ui.tridi?.pulsaCervello();
    }
    ui.cervelloContatoriPrec = { ...c };

    // Il pannello aperto si aggiorna da sé, senza perdere il posto.
    if (ui.pannello?.tipo === 'contenuto') {
      const c2 = D.stato.contenuti.find(x => x.id === ui.pannello.id);
      if (c2 && c2.updated_at !== ui.ultimoContenutoVisto) {
        ui.ultimoContenutoVisto = c2.updated_at;
        apriContenuto(ui.pannello.id);
      }
    }
  }

  let firmaAgenti = '';
  function cambiatiGliAgenti() {
    const f = D.stato.agenti.map(a => a.id + ':' + a.zona).join('|');
    if (f !== firmaAgenti) { firmaAgenti = f; return true; }
    return false;
  }

  async function avvia() {
    // app.js ha già rimandato altrove chi non ha la pagina. Qui si controlla
    // comunque: una pagina che si fida del menu non è protetta.
    if (window.canSeePage && !window.canSeePage('regia')) {
      document.querySelector('.page-content').innerHTML =
        '<div class="alert alert-danger" style="max-width:520px">Questa sezione non è abilitata per il tuo ruolo.</div>';
      return;
    }

    disegnaFiltro();

    // Che vista aprire. La preferenza salvata vince; poi il buon senso.
    const pref = preferenzaSalvata();
    const lista = pref === 'lista' ||
      (pref !== '3d' && (movimentoRidotto() || dispositivoDebole() || !webglDisponibile()));

    try {
      await D.carica();
    } catch (e) {
      document.querySelector('.page-content').innerHTML =
        `<div class="alert alert-danger" style="max-width:560px">
           Non riesco a leggere i dati della Regia: ${esc(e.message)}.<br>
           Se è la prima volta, la migrazione della sezione va eseguita su Supabase.
         </div>`;
      return;
    }

    if (!D.stato.brand) {
      document.querySelector('.page-content').innerHTML =
        `<div class="alert alert-warning" style="max-width:560px">
           La Regia non ha ancora nessun brand configurato.
           Esegui il seed <code>20261110_smm_seed.sql</code> su Supabase.
         </div>`;
      return;
    }

    D.ascolta(reagisci);
    reagisci();
    cambiaVistaSala(lista ? 'lista' : '3d');
    D.avvia();

    // L'orologio di Dubai in alto a sinistra della scena.
    setInterval(disegnaTesta, 30000);
  }

  // ── Agganci globali ───────────────────────────────────────
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const a = t.closest?.('[data-agente]');
    if (a) return apriAgente(a.dataset.agente);
    const c = t.closest?.('[data-contenuto]');
    if (c) return apriContenuto(c.dataset.contenuto);
    const r = t.closest?.('[data-rispondi]');
    if (r) return apriRisposta(r.dataset.rispondi);
    if (t.closest?.('[data-cervello]')) return apriCervello();
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('rg-btn-nuovo').addEventListener('click', nuovoLavoro);
    $('rg-btn-reference').addEventListener('click', nuovaReference);
    $('rg-btn-cervello').addEventListener('click', apriCervello);
    $('rg-pan-chiudi').addEventListener('click', chiudiPannello);
    $('rg-velo').addEventListener('click', chiudiPannello);
    $('rg-modale-chiudi').addEventListener('click', chiudiModale);
    $('rg-cam-reset').addEventListener('click', () => ui.tridi?.torna());
    $('rg-btn-vista').addEventListener('click', () =>
      cambiaVistaSala(ui.usaTridi ? 'lista' : '3d'));
    for (const b of document.querySelectorAll('[data-vista]')) {
      b.addEventListener('click', () => cambiaVista(b.dataset.vista));
    }
    $('rg-pan-testo').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('rg-pan-invia').click(); }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if ($('rg-modale').style.display !== 'none') chiudiModale();
      else if ($('rg-pannello').classList.contains('aperto')) chiudiPannello();
    });
    // Il pannello si aggancia anche al tasto Guarda dentro un fumetto 3D.
    avvia();
  });

  window.addEventListener('beforeunload', () => { D.fermati(); spegniTridi(); });
})();
