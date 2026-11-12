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
    if (r.spenti)     pezzi.push(`<b>${r.spenti}</b> ${r.spenti === 1 ? 'è spento' : 'sono spenti'}`);
    $('rg-stato').innerHTML = pezzi.length
      ? pezzi.join(', ') + '.'
      : 'La sala è tranquilla: nessun lavoro aperto.';

    // La sala ferma non e' un guasto: e' il piano gia' coperto, o
    // l'interruttore alzato. Da fuori sono identici a "non funziona".
    const calma = $('rg-calma');
    if (calma) {
      const niente = !r.lavorano && !r.inCoda && !r.domande;
      calma.hidden = !niente;
    }

    const spento = !!D.stato.impostazioni?.stop_tutto;
    if (spento) {
      $('rg-stato').innerHTML =
        '<span class="rg-pillola rossa">tutto fermo</span> ' +
        'Gli agenti sono in pausa: nessun lavoro parte finché non si riaccende.';
    }

    // L'interruttore dice sempre lo stato in cui si trova, non l'azione che
    // fa: un tasto che dice "Spegni" mentre e' gia' spento e' il modo
    // migliore per spegnere due volte e riaccendere senza accorgersene.
    const sw = $('rg-interruttore');
    if (sw) {
      sw.setAttribute('aria-pressed', String(spento));
      $('rg-int-testo').textContent = spento ? 'Agenti fermi' : 'Agenti attivi';
      sw.title = spento
        ? 'Gli agenti sono fermi. Premi per farli ripartire.'
        : 'Gli agenti lavorano. Premi per fermarli tutti.';
    }
    const fascia = $('rg-fermo');
    if (fascia) fascia.hidden = !spento;

    // Quanto manca per chiudere la settimana, accanto al saluto: e' la
    // domanda che un direttore si fa per prima.
    const manca = (D.stato.piano || []).filter(x => x.attivo)
      .reduce((s, x) => s + Number(x.mancanti || 0), 0);
    const previsti = (D.stato.piano || []).filter(x => x.attivo)
      .reduce((s, x) => s + Number(x.quanti_a_settimana || 0), 0);
    if (previsti) {
      $('rg-stato').innerHTML += ` <span class="rg-pillola ${manca ? 'rossa' : ''}">`
        + `settimana: ${previsti - manca} su ${previsti}</span>`;
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
    $('rg-comandi').style.display = lista ? 'none' : '';
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
      const colore = { libero: '#9ca3af', attende: '#d97706', lavora: '#16a34a',
                       mano_alzata: '#dc2626', spento: '#4b5563' }[posa];
      const contenuto = lavoro?.content_id
        ? D.stato.contenuti.find(x => x.id === lavoro.content_id) : null;
      const cosa = posa === 'spento'
        ? 'Spento: non prende lavori'
        : posa === 'mano_alzata'
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

    // Il numero si vede in tre posti perche' la domanda "devo fare
    // qualcosa?" non deve costare uno scorrimento: sulla striscia, sulla
    // scheda Sala (cosi' si vede anche dal Calendario e dai Risultati) e
    // nella riga di stato in cima.
    const conta = $('rg-tocca-conta'), contaScheda = $('rg-scheda-conta');
    for (const el of [conta, contaScheda]) {
      if (!el) continue;
      el.textContent = String(voci.length);
      el.hidden = voci.length === 0;
    }
    $('rg-tocca-guscio')?.classList.toggle('piena', voci.length > 0);

    if (!voci.length) {
      c.innerHTML = '<div class="rg-vuoto-tocca">Niente in attesa di te. '
        + 'Se la settimana e&#768; coperta va bene cosi&#768;: il piano lo vedi in <b>Direzione</b>.</div>';
      return;
    }
    c.innerHTML = voci.map(v => {
      const classe = v.tipo === 'domanda' || v.tipo === 'respinto' ? 'urgente'
                   : v.tipo === 'cervello' ? 'cervello' : '';
      const attr = v.tipo === 'domanda'      ? `data-rispondi="${v.id}"`
                 : v.tipo === 'cervello'     ? 'data-cervello="1"'
                 : v.tipo === 'piano'        ? 'data-piano="1"'
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
    sfondoInerte(true);
    // Il primo elemento su cui si puo' agire prende il fuoco, cosi' chi usa
    // la tastiera non resta indietro nella pagina.
    setTimeout(() => {
      ($('rg-pan-corpo').querySelector('button, a, input, textarea, select')
        || $('rg-pan-chiudi'))?.focus();
    }, 220);
  }

  /**
   * Mentre il pannello e' aperto, la pagina dietro non e' solo coperta: e'
   * disattivata davvero.
   *
   * Senza questo i comandi dietro restavano a fuoco e sembravano cliccabili.
   * Premendo "Nuovo lavoro" si colpiva il velo, che chiudeva il pannello: il
   * tasto sembrava rotto. Con inert il browser li toglie dal giro, dal
   * puntatore, dalla tastiera e dagli screen reader.
   */
  function sfondoInerte(attivo) {
    for (const sel of ['.app-layout', '.sidebar', '.ios-bottom-nav', '.ios-admin-bar']) {
      for (const el of document.querySelectorAll(sel)) {
        if (attivo) el.setAttribute('inert', '');
        else el.removeAttribute('inert');
      }
    }
  }

  function chiudiPannello() {
    chiudiRiquadro();
    $('rg-pannello').classList.remove('aperto');
    $('rg-velo').classList.remove('aperto');
    $('rg-pannello').setAttribute('aria-modal', 'false');
    sfondoInerte(false);
    ui.pannello = null;
    ui.tridi?.torna();
  }

  function corpoPannello() { return $('rg-pan-corpo'); }

  /**
   * Un riquadro che si apre DENTRO il pannello, non come finestra sopra.
   *
   * Prima "Aggiungi la nota" e "Carica un file" aprivano un modale: il
   * modale del portale sta a z-index 200 e il pannello a 600, quindi la
   * finestra finiva dietro al pannello e sembrava che si accavallassero.
   * Si poteva alzare il numero, ma il problema vero era un altro: una
   * finestra sopra un pannello gia' aperto e' una cosa di troppo. Qui il
   * form compare dove stai guardando, spinge il contenuto in giu' e si
   * chiude da solo quando hai finito.
   */
  function riquadroNelPannello(titolo, html, azioni) {
    chiudiRiquadro();
    const box = document.createElement('div');
    box.className = 'rg-riquadro';
    box.id = 'rg-riquadro';
    box.innerHTML = `<div class="rg-riquadro-testa">${esc(titolo)}</div>${html}
      <div class="rg-riquadro-azioni"></div>`;
    const piede = box.querySelector('.rg-riquadro-azioni');
    for (const a of azioni || []) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm ' + (a.primaria ? 'btn-accent' : 'btn-ghost');
      b.type = 'button';
      b.textContent = a.etichetta;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await a.azione(); }
        catch (e) { window.ui.showToast(pulisciErrore(e.message), 'error'); }
        finally { b.disabled = false; }
      });
      piede.appendChild(b);
    }
    const annulla = document.createElement('button');
    annulla.className = 'btn btn-ghost btn-sm';
    annulla.type = 'button';
    annulla.textContent = 'Annulla';
    annulla.addEventListener('click', chiudiRiquadro);
    piede.appendChild(annulla);

    corpoPannello().prepend(box);
    corpoPannello().scrollTop = 0;
    box.querySelector('textarea, input, select')?.focus();
    return box;
  }

  function chiudiRiquadro() { $('rg-riquadro')?.remove(); }

  // ── Pannello di un agente: la chat ────────────────────────
  async function apriAgente(agentId) {
    const a = D.stato.agenti.find(x => x.id === agentId);
    if (!a) return;
    ui.pannello = { tipo: 'agente', id: agentId };
    ui.tridi?.inquadraAgente(agentId);

    apriPannello(a.nome,
      `${a.ruolo}${a.attivo === false ? ' · spento' : ''} · ${a.descrizione || ''}`,
      '<div class="rg-vuoto-tocca">Carico…</div>',
      { conPiede: a.attivo !== false, placeholder: `Scrivi a ${a.nome}…` });

    const [messaggi, lavori] = await Promise.all([D.messaggiDi(agentId), D.lavoriDi(agentId)]);
    if (ui.pannello?.id !== agentId) return;

    const lavoro = D.lavoroVivoDi(agentId);
    const acceso = a.attivo !== false;
    const adesso = !acceso
      ? '<div class="rg-vuoto-tocca">È spento: non prende lavori finché non lo riaccendi. '
        + 'Quelli già in coda per lui restano in coda.</div>'
      : lavoro
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

    // Il modello e gli strumenti non si mostrano: il manager non e' un
    // amministratore di sistema. L'interruttore si', perche' e' una
    // decisione sua.
    corpoPannello().innerHTML = `
      <div class="rg-sez">Cosa fa adesso</div>${adesso}
      <div class="rg-piano-azioni">
        <button class="btn ${acceso ? 'btn-ghost' : 'btn-accent'} btn-sm" data-agente-acceso="${acceso ? '0' : '1'}">
          ${acceso ? 'Spegni questo agente' : 'Riaccendi questo agente'}</button>
      </div>
      <div class="rg-sez">Ultime cose fatte</div>${fattiHtml}
      <div class="rg-sez">Conversazione</div>${chat}`;
    corpoPannello().scrollTop = corpoPannello().scrollHeight;

    corpoPannello().querySelector('[data-agente-acceso]')?.addEventListener('click', async (ev) => {
      const verso = ev.currentTarget.dataset.agenteAcceso === '1';
      ev.currentTarget.disabled = true;
      try {
        await D.accendiAgente(agentId, verso);
        window.ui.showToast(verso ? `${a.nome} riaccesso.` : `${a.nome} spento.`, 'success');
        await apriAgente(agentId);
      } catch (e) {
        window.ui.showToast(pulisciErrore(e.message), 'error');
        ev.currentTarget.disabled = false;
      }
    });

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
      <button class="btn btn-ghost btn-sm" id="rg-carica-media">Carica un file</button>
      ${['carosello', 'reel', 'storia', 'post'].includes(c.tipo)
        ? `<button class="btn btn-ghost btn-sm" id="rg-rendi">${media.length ? 'Rifai le immagini' : 'Prepara le immagini'}</button>` : ''}
      ${c.stato === 'da_approvare'
        ? '<button class="btn btn-accent btn-sm" id="rg-a-posto">È a posto così</button>' : ''}
      ${c.stato === 'respinto'
        ? '<button class="btn btn-ghost btn-sm" id="rg-rimanda">Rimanda a chi l\'ha scritto</button>' : ''}
      ${c.stato !== 'pubblicato' && c.stato !== 'scartato'
        ? '<button class="btn btn-ghost btn-sm rg-butta" id="rg-butta">Butta</button>' : ''}
    </div>`);
    html.push(note.length
      ? note.map(n => `<div class="rg-nota ${n.risolta ? 'risolta' : ''}">
            <div class="rg-nota-ancora">${esc(descriviAncora(n.ancora))}</div>
            ${esc(n.testo)}
            ${n.risolta ? '' : `<div style="margin-top:6px"><button class="btn btn-ghost btn-sm" data-risolvi="${n.id}">Sistemata</button></div>`}
          </div>`).join('')
      : '<div class="rg-vuoto-tocca">Nessuna nota.</div>');

    // ── i file caricati ──
    if (media.length) {
      html.push('<div class="rg-sez">File</div>');
      html.push(media.map(m => `<div class="rg-voce">
        <b>${esc(m.nome_file || m.path.split('/').pop())}</b>
        <div class="rg-voce-fonte">${esc(m.ruolo)} · ${esc(m.mime || '')}${
          Number(m.bytes) > 0 ? ' · ' + pesoLeggibile(m.bytes) : ''}</div>
      </div>`).join(''));
    }

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
    $('rg-carica-media')?.addEventListener('click', () => caricaSuContenuto(c));
    $('rg-rendi')?.addEventListener('click', () => rendiContenuto(c));
    $('rg-a-posto')?.addEventListener('click', () => approvaContenuto(c));
    $('rg-rimanda')?.addEventListener('click', () => {
      // Un contenuto fermato dal Revisore non si approva scavalcandolo: si
      // rimanda indietro con l'indicazione di cosa cambiare.
      riquadroNelPannello('Rimanda indietro', `
        <textarea class="form-input" id="rg-rim-testo" rows="3"
          placeholder="Riprendi le segnalazioni del Revisore e aggiungi cosa vuoi tu."></textarea>`,
        [{ etichetta: 'Rimanda', primaria: true, azione: async () => {
            const t = $('rg-rim-testo').value.trim();
            if (!t) return window.ui.showToast('Scrivi cosa deve cambiare.', 'error');
            await D.rimandaIndietro(c.id, t);
            window.ui.showToast('Rimandato indietro.', 'success');
            apriContenuto(c.id);
          } }]);
    });
    corpoPannello().querySelectorAll('[data-risolvi]').forEach(b =>
      b.addEventListener('click', async () => {
        await D.risolviNota(b.dataset.risolvi);
        apriContenuto(c.id);
      }));
    for (const quale of ['data-slide', 'data-video']) {
      corpoPannello().querySelectorAll(`[${quale}]`).forEach(b =>
        b.addEventListener('click', () => {
          ui.slideScelta = Number(b.dataset.slide ?? b.dataset.video);
          disegnaContenuto(c, versioni, note, media);
        }));
    }
    // Buttare e' definitivo abbastanza da chiedere conferma, e la conferma
    // dice il titolo: "sei sicuro?" su una lista di dieci non informa.
    $('rg-butta')?.addEventListener('click', async () => {
      if (!window.confirm(`Buttare "${c.titolo}"?\n\n`
          + 'Sparisce dalle liste, i lavori aperti su di lui si fermano e perde la data di uscita.')) return;
      try {
        await D.scarta(c.id);
        window.ui.showToast('Buttato.', 'success');
        chiudiPannello();
      } catch (e) { window.ui.showToast(pulisciErrore(e.message), 'error'); }
    });

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

  /** Le linguette per sfogliare piu' video: una storia ne ha uno per slide. */
  /**
   * I video in ordine di pagina.
   *
   * L'elenco arriva ordinato per created_at, ma i file di un rendering
   * nascono nello stesso secondo: l'ordine era quello del caso. Il numero
   * di pagina sta in fondo al nome del file, ed e' l'unico dato che lo dice
   * davvero.
   */
  function videoInOrdine(media) {
    const numero = (m) => {
      const n = String(m.nome_file || m.path || '').match(/_(\d+)$/);
      return n ? Number(n[1]) : Number.MAX_SAFE_INTEGER;
    };
    return media
      .filter(x => (x.mime || '').startsWith('video') && x.ruolo !== 'reference')
      .sort((a, b) => numero(a) - numero(b));
  }

  function linguetteVideo(media, c) {
    const v = videoInOrdine(media);
    const slides = Array.isArray(c.slides) ? c.slides : [];
    const i = Math.min(ui.slideScelta, v.length - 1);
    return `<div class="rg-slide-strip">${v.map((m, k) =>
      `<button class="rg-slide-min" data-video="${k}" aria-current="${k === i}">
         ${esc(String((slides[k]?.titolo || slides[k]?.title) || ('Slide ' + (k + 1))).slice(0, 22))}
       </button>`).join('')}</div>`;
  }

  function lettore(c, media) {
    // Le linguette cambiavano solo l'evidenziazione: il lettore prendeva
    // sempre il primo video dell'elenco, quindi si vedeva sempre la stessa
    // pagina e le altre no.
    const video = videoInOrdine(media);
    const anteprima = media.find(m => m.ruolo === 'anteprima');
    const immagini = media.filter(m => (m.mime || '').startsWith('image') && m.ruolo !== 'reference');

    if (video.length || anteprima) {
      const scelto = Math.min(Math.max(ui.slideScelta || 0, 0), Math.max(video.length - 1, 0));
      const m = anteprima || video[scelto];
      // Stesso difetto che avevo sistemato per le immagini e non qui: i
      // file del generatore stanno su Cloudinary con un indirizzo
      // pubblico, e il link firmato sa costruire solo indirizzi del
      // deposito privato. Falliva in silenzio, e restava scritto
      // "Anteprima non disponibile" sopra tre file che c'erano.
      const sorgente = m.cloudinary_url
        ? `src="${esc(m.cloudinary_url)}"`
        : `data-media-path="${esc(m.path)}"`;
      const quanti = video.length;
      return `<div class="rg-lettore">
        <video id="rg-video" controls preload="metadata" playsinline ${sorgente}></video>
      </div>
      ${quanti > 1 ? linguetteVideo(media, c) : ''}
      <div class="rg-voce-fonte">${m.cloudinary_url
        ? `${quanti} ${quanti === 1 ? 'video pronto' : 'video pronti'} per la pubblicazione.`
        : 'L\'anteprima si apre con un indirizzo che scade: i file non sono pubblici.'}</div>`;
    }

    const slides = Array.isArray(c.slides) ? c.slides : [];

    // La linguetta sotto l'anteprima: il titolo della slide se c'e', il
    // numero altrimenti. La stessa per il testo e per le immagini, cosi'
    // si naviga allo stesso modo prima e dopo il rendering.
    // Un titolo tagliato a meta' parola ("La domanda vera viene prim") fa
    // sembrare rotto quello che c'e' sotto. Si taglia allo spazio, e si
    // mette il segno che continua.
    const accorcia = (s, max) => {
      const x = String(s || '').trim();
      if (x.length <= max) return x;
      const t = x.slice(0, max);
      const spazio = t.lastIndexOf(' ');
      return (spazio > max * 0.5 ? t.slice(0, spazio) : t).trimEnd() + '…';
    };

    const linguette = (quante, scelta) =>
      `<div class="rg-slide-strip">${Array.from({ length: quante }, (_, k) =>
        `<button class="rg-slide-min" data-slide="${k}" aria-current="${k === scelta}"
                 title="${esc(String((slides[k]?.title || slides[k]?.titolo) || ('Slide ' + (k + 1))))}">
           ${esc(accorcia((slides[k]?.title || slides[k]?.titolo) || ('Slide ' + (k + 1)), 24))}
         </button>`).join('')}</div>`;

    // Le immagini rese vengono prima del testo: quando esistono sono il
    // contenuto vero, e il testo l'ha gia' letto chi le ha fatte fare.
    // Prima il testo vinceva sempre e le immagini non si vedevano mai.
    if (immagini.length) {
      const i = Math.min(ui.slideScelta, immagini.length - 1);
      const m = immagini[i];
      // Le immagini del generatore stanno su Cloudinary con un indirizzo
      // pubblico, perche' da li' le scarica GoHighLevel. Quelle caricate a
      // mano stanno nel deposito privato e vogliono un link che scade: il
      // link firmato non sa niente di Cloudinary e falliva in silenzio.
      const tag = m.cloudinary_url
        ? `<img alt="Anteprima del contenuto" src="${esc(m.cloudinary_url)}">`
        : `<img alt="Anteprima del contenuto" data-media-path="${esc(m.path)}">`;
      return `<div class="rg-lettore">${tag}</div>
        ${immagini.length > 1 ? linguette(immagini.length, i) : ''}
        <div class="rg-voce-fonte">${immagini.length} ${immagini.length === 1 ? 'immagine pronta' : 'immagini pronte'} per la pubblicazione.</div>`;
    }

    if (slides.length) {
      const i = Math.min(ui.slideScelta, slides.length - 1);
      const s = slides[i] || {};
      // Gli agenti scrivono in italiano e non sempre con le stesse chiavi:
      // qui si legge tutto quello che può esserci, altrimenti la scheda
      // resta un riquadro nero con il solo titolo e sembra rotta.
      const corpo = s.body || s.testo || s.sottotitolo || s.subtitle || '';
      const punti = Array.isArray(s.bullets) ? s.bullets : null;
      const stats = Array.isArray(s.stats) ? s.stats : null;
      const invito = s.ctaLine || s.cta || '';
      return `<div class="rg-lettore">
        <div class="rg-anteprima-slide">
          ${s.badge ? `<div class="rg-as-badge">${esc(s.badge)}</div>` : ''}
          <div class="rg-as-titolo">${esc(s.title || s.titolo || '')}</div>
          ${stats
            ? stats.map(x => `<div class="rg-as-corpo"><b style="color:#b5ff00">${esc(x.value)}</b> ${esc(x.label)} — ${esc(x.desc || '')}</div>`).join('')
            : punti
              ? punti.map(x => `<div class="rg-as-corpo">• ${esc(x)}</div>`).join('')
              : `<div class="rg-as-corpo">${esc(corpo)}</div>`}
          ${invito ? `<div class="rg-as-corpo" style="margin-top:9px;color:#b5ff00;font-weight:800">${esc(invito)}</div>` : ''}
        </div>
      </div>
      ${linguette(slides.length, i)}
      <div class="rg-voce-fonte">
        Questo è <b>il testo</b>, non la grafica: serve a rileggere cosa ha scritto l'agente.
        Le immagini vere le fa il generatore con «Prepara le immagini», con misure, colori e
        impaginazione del marchio.
      </div>`;
    }

    // Niente slide e niente file: e' il caso di un contenuto appena aperto
    // dal Direttore, che aspetta che il Copywriter lo scriva. Dirlo e'
    // meglio che lasciare un riquadro vuoto da interpretare.
    return `<div class="rg-vuoto-tocca">
      ${c.caption
        ? esc(c.caption)
        : 'Qui non c\'è ancora niente perché nessuno l\'ha ancora scritto: il Direttore ha aperto il contenuto e l\'ha passato a chi lo scrive. Quando il Copywriter avrà finito, il testo compare qui.'}
    </div>`;
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
    if (video && video.currentTime > 0) {
      ancora = { tipo: 'video', secondo: Number(video.currentTime.toFixed(2)) };
    } else if (slides.length) {
      ancora = { tipo: 'slide', slide: Math.min(ui.slideScelta, slides.length - 1) };
    }

    riquadroNelPannello('Aggiungi la nota', `
      <div class="rg-riquadro-dove">${esc(descriviAncora(ancora))}</div>
      <textarea class="form-input" id="rg-nota-testo" rows="3"
        placeholder="Scrivilo come lo diresti a voce. Diventa anche una nota nel Cervello, così non si ripete."></textarea>`,
      [{ etichetta: 'Salva la nota', primaria: true, azione: async () => {
          const t = $('rg-nota-testo').value.trim();
          if (!t) return window.ui.showToast('Scrivi cosa va cambiato.', 'error');
          await D.aggiungiNota(c.id, t, ancora);
          window.ui.showToast('Nota salvata. Finisce anche nel Cervello.', 'success');
          apriContenuto(c.id);
        } }]);
  }

  function pesoLeggibile(b) {
    const n = Number(b) || 0;
    if (n < 1024) return n + ' byte';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  /**
   * Carica un file e lo aggancia al contenuto: e' il "dallo in pasta ai
   * contenuti". Il file va diritto nello Storage privato, con la barra di
   * avanzamento, e sopra i 6 MB a pezzi, cosi' se la rete cade si riprende
   * invece di ricominciare. Gli agenti girano lato server e lo leggono da
   * li': non resta sul computer del manager.
   */
  function caricaSuContenuto(c) {
    riquadroNelPannello('Carica un file', `
      <input class="form-input" id="rg-up-file" type="file">
      <select class="form-input" id="rg-up-ruolo" style="margin-top:8px">
        <option value="originale">Il materiale di partenza</option>
        <option value="derivato">Una versione già pronta da pubblicare</option>
        <option value="reference">Un esempio a cui ispirarsi</option>
      </select>
      <div class="rg-avanzamento" id="rg-up-barra" hidden><i></i></div>
      <div id="rg-up-stato" class="rg-riquadro-dove" style="margin-top:6px">
        I file grandi si caricano a pezzi: se la rete cade, riprende da dove era.
      </div>`,
      [{ etichetta: 'Carica', primaria: true, azione: async () => {
          const f = $('rg-up-file').files?.[0];
          if (!f) return window.ui.showToast('Scegli un file.', 'error');
          const barra = $('rg-up-barra'), stato = $('rg-up-stato');
          barra.hidden = false;
          await D.caricaFile(f, {
            contentId: c.id, ruolo: $('rg-up-ruolo').value,
            onProgress: (p) => {
              barra.firstElementChild.style.width = (p * 100).toFixed(0) + '%';
              stato.textContent = `${(p * 100).toFixed(0)}% di ${pesoLeggibile(f.size)}`;
            },
          });
          window.ui.showToast('Caricato. Gli agenti ce l\'hanno.', 'success');
          apriContenuto(c.id);
        } }]);
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
    // L'ora di uscita sul pezzo: una casella che dice solo "c'e' qualcosa"
    // non serve a programmare. E se e' gia' uscito va detto li', non
    // aprendo il contenuto.
    const oraDi = (c) => {
      if (!c.slot_at) return '';
      const q = new Date(c.slot_at).toLocaleTimeString('it-IT',
        { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
      const uscito = Boolean(c.pubblicato_at);
      return `<div class="rg-pezzo-ora ${uscito ? 'uscito' : ''}">${uscito ? 'uscito alle ' : ''}${q}</div>`;
    };
    const pezzo = (c) => `<div class="rg-pezzo" draggable="true" data-pezzo="${c.id}">
        <div class="rg-pezzo-tit">${esc(c.titolo)}</div>
        ${oraDi(c)}
        <div class="rg-pezzo-meta">${esc((ETICHETTE_STATO[c.stato] || [c.stato])[0])} · ${esc(c.tipo)}</div>
      </div>`;

    const liberi = contenuti.filter(c => c.stato === 'approvato' && !c.slot_at);
    const inCal  = contenuti.filter(c => ['in_calendario', 'programmato'].includes(c.stato));
    const inLav  = contenuti.filter(c => ['idea', 'in_lavorazione', 'da_revisione', 'respinto', 'da_approvare'].includes(c.stato));

    const vuoto = (t) => `<div class="rg-vuoto-tocca">${t}</div>`;
    $('rg-mucchio-liberi').innerHTML = liberi.length
      ? liberi.map(pezzo).join('') : vuoto('Niente di approvato in attesa di una data.');
    // Una riga che dice come sta la settimana, invece di farla contare a
    // occhio sulle caselle.
    const prossima = inCal
      .filter(c => c.slot_at && !c.pubblicato_at && new Date(c.slot_at) > new Date())
      .sort((a, b) => new Date(a.slot_at) - new Date(b.slot_at))[0];
    const usciti = contenuti.filter(c => c.pubblicato_at).length;
    const riass = $('rg-cal-riassunto');
    if (riass) {
      const voci = [];
      voci.push(`<b>${liberi.length}</b> ${liberi.length === 1 ? 'pronto' : 'pronti'} da programmare`);
      voci.push(`<b>${inCal.length}</b> in calendario`);
      if (usciti) voci.push(`<b>${usciti}</b> ${usciti === 1 ? 'uscito' : 'usciti'}`);
      riass.innerHTML = voci.join(' · ') + (prossima
        ? `. Prossima uscita: <b>${esc(prossima.titolo)}</b>, ${window.ui.formatDate(prossima.slot_at)} alle `
          + new Date(prossima.slot_at).toLocaleTimeString('it-IT',
              { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) + '.'
        : '.');
    }

    $('rg-mucchio-lavorazione').innerHTML = inLav.length
      ? inLav.map(pezzo).join('') : vuoto('Niente in lavorazione.');

    // Due settimane a partire dal lunedi' di questa, in ORA DI DUBAI.
    //
    // Prima la chiave del giorno si ricavava con toISOString() da una
    // mezzanotte locale: in un fuso a est di Greenwich quella mezzanotte
    // cade nel giorno prima, quindi la casella che diceva "12/11" portava
    // scritto 11/11, e un contenuto lasciato su "oggi" finiva programmato
    // a ieri. Essendo nel passato usciva subito, oppure non usciva proprio.
    //
    // Qui il calendario e' fatto di date pure, senza fusi, e il giorno di
    // un contenuto si legge in ora di Dubai: cosi' resta lo stesso anche
    // se il manager apre il portale da un altro paese.
    const giornoDubai = (quando) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(quando);

    const oggiDubai = giornoDubai(new Date());
    const [annoOggi, meseOggi, giornoOggi] = oggiDubai.split('-').map(Number);
    const lunedi = new Date(Date.UTC(annoOggi, meseOggi - 1, giornoOggi));
    lunedi.setUTCDate(lunedi.getUTCDate() - ((lunedi.getUTCDay() + 6) % 7));

    const giorni = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(lunedi);
      d.setUTCDate(lunedi.getUTCDate() + i);
      giorni.push(d);
    }

    const NOMI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    $('rg-griglia').innerHTML = giorni.map(d => {
      const chiave = d.toISOString().slice(0, 10);   // costruita in UTC puro: sicura
      const dentro = contenuti.filter(c => c.slot_at && giornoDubai(new Date(c.slot_at)) === chiave);
      const eOggi = chiave === oggiDubai;
      const passato = chiave < oggiDubai;
      return `<div class="rg-giorno ${eOggi ? 'oggi' : ''} ${passato ? 'passato' : ''}" data-giorno="${chiave}">
        <div class="rg-giorno-et">${NOMI[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}</div>
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
        //
        // Su un giorno passato l'ora di uscita e' gia' trascorsa, quindi il
        // contenuto parte al primo giro invece di aspettare: e' legittimo
        // - e' il modo per dire "esci adesso" - ma va detto, altrimenti
        // sembra che il calendario non abbia funzionato.
        if (g.classList.contains('passato')) {
          window.ui.showToast('E\' un giorno gia\' passato: esce entro pochi minuti.', 'success');
        }
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


  /**
   * Manda il contenuto al motore che lo rende.
   *
   * Ci mette da venti secondi a un minuto e mezzo, perche' di la' apre un
   * browser vero, fa le pagine una per una e per i video le monta. Il tasto
   * lo dice, invece di restare li' a far pensare che non abbia funzionato.
   */
  async function rendiContenuto(c) {
    const b = $('rg-rendi');
    if (!b) return;
    const prima = b.textContent;
    b.disabled = true;
    b.textContent = c.tipo === 'reel' || c.tipo === 'storia'
      ? 'Sto montando… anche un minuto'
      : 'Sto preparando… una ventina di secondi';
    try {
      const d = await D.rendi(c.id);
      window.ui.showToast(d.messaggio || 'Fatto.', 'success');
      await apriContenuto(c.id);
    } catch (e) {
      window.ui.showToast(pulisciErrore(e.message), 'error');
      b.disabled = false;
      b.textContent = prima;
    }
  }

  // ══════════════════════════════════════════════════════════
  // Direzione: il piano della settimana
  // ══════════════════════════════════════════════════════════
  // Qui il manager dice quanto deve uscire, di che tipo, chi lo fa e come.
  // Non e' un modulo decorativo: quello che scrive qui finisce nel prompt di
  // ogni agente insieme a quanto manca, e il Direttore ci si regola.

  const GIORNI = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Gio'], [5, 'Ven'], [6, 'Sab'], [7, 'Dom']];
  const TIPI = [['carosello', 'Carosello'], ['reel', 'Reel'], ['storia', 'Storia'], ['post', 'Post']];

  // ── Le fasce della sala ───────────────────────────────────────────────
  //
  // A sinistra chi c'e' e cosa sta facendo, a destra come sta andando la
  // settimana. La scena in mezzo resta quello che e': un omino che si
  // muove non dice chi e' ne' a che punto sta, e per saperlo bisognava
  // avvicinarsi a leggere un fumetto.

  /** Un mezzobusto, tinto del colore dell'agente. */
  function ritratto(colore) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${esc(colore || '#6b7280')}">
      <circle cx="12" cy="8" r="4.2"/>
      <path d="M3.6 21c0-4.3 3.8-6.6 8.4-6.6s8.4 2.3 8.4 6.6z"/>
    </svg>`;
  }

  const CHE_FA = {
    lavora:      'sta lavorando',
    mano_alzata: 'ha una domanda',
    attende:     'ha un lavoro in attesa',
    libero:      'libero',
    spento:      'spento',
  };
  const CLASSE_POSA = {
    lavora: 'lavora', mano_alzata: 'domanda', attende: 'attende',
    libero: '', spento: 'spento',
  };

  function disegnaFasciaAgenti() {
    const dove = $('rg-fascia-agenti');
    if (!dove) return;
    const agenti = D.stato.agenti || [];
    dove.innerHTML = `<div class="rg-fascia-testa">In sala (${agenti.length})</div>` +
      agenti.map(a => {
        const posa = D.posaDi(a.id);
        const lavoro = D.lavoroVivoDi(a.id);
        const che = posa === 'mano_alzata'
          ? (lavoro?.domanda || CHE_FA.mano_alzata)
          : (lavoro?.attivita || CHE_FA[posa] || '');
        return `<button class="rg-tess ${CLASSE_POSA[posa] || ''}" data-tess="${esc(a.id)}"
                        title="${esc(a.descrizione || a.ruolo || '')}">
          <span class="rg-tess-foto" style="background:${esc((a.colore || '#6b7280') + '1f')}">
            ${ritratto(a.colore)}
          </span>
          <span class="rg-tess-corpo">
            <span class="rg-tess-nome">${esc(a.nome)}</span>
            <span class="rg-tess-che">${esc(che)}</span>
          </span>
        </button>`;
      }).join('');

    dove.querySelectorAll('[data-tess]').forEach(b =>
      b.addEventListener('click', () => apriAgente(b.dataset.tess)));
  }

  /**
   * L'avanzamento della settimana.
   *
   * Il piano e' una chiamata al database, non un dato che gira col resto:
   * si rilegge ogni due minuti e quando si chiude la Direzione, non a ogni
   * battito.
   */
  async function disegnaFasciaSettimana(forza = false) {
    const dove = $('rg-fascia-settimana');
    if (!dove) return;
    const adesso = Date.now();
    if (forza || !ui.pianoFascia || adesso - (ui.pianoFasciaQuando || 0) > 120000) {
      ui.pianoFasciaQuando = adesso;
      try { ui.pianoFascia = await D.piano(0) || []; }
      catch { ui.pianoFascia = ui.pianoFascia || []; }
    }
    const righe = (ui.pianoFascia || []).filter(r => r.attivo);
    const s = D.stato.impostazioni || {};
    const speso = Number(s.speso_oggi_usd || 0);
    const tetto = Number(s.budget_giorno_usd || 0);

    dove.innerHTML = `<div class="rg-fascia-testa">La settimana</div>` +
      (righe.length ? righe.map(r => {
        const fatti = Number(r.usciti || 0) + Number(r.in_calendario || 0) + Number(r.in_lavorazione || 0);
        const quanti = Number(r.quanti_a_settimana || 0) || 1;
        const perc = Math.min(100, Math.round((fatti / quanti) * 100));
        return `<div class="rg-barra-riga">
          <div class="rg-barra-et"><span>${esc(r.nome)}</span><span>${fatti}/${quanti}</span></div>
          <div class="rg-barra-sfondo">
            <div class="rg-barra-dentro ${perc >= 100 ? 'piena' : ''}" style="width:${perc}%"></div>
          </div>
          <div class="rg-barra-fonte">${r.mancanti > 0
            ? `Mancano ${r.mancanti}.`
            : 'Coperta.'}${r.usciti ? ` ${r.usciti} gia&#768; ${r.usciti === 1 ? 'uscito' : 'usciti'}.` : ''}</div>
        </div>`;
      }).join('')
      : `<div class="rg-barra-riga"><div class="rg-barra-fonte">
           Il piano e&#768; vuoto: dalla Direzione dici quanto deve uscire.</div></div>`) +
      `<div class="rg-barra-riga">
        <div class="rg-barra-et"><span>Spesa di oggi</span><span>${speso.toFixed(2)} $</span></div>
        ${tetto ? `<div class="rg-barra-sfondo">
          <div class="rg-barra-dentro" style="width:${Math.min(100, Math.round(speso / tetto * 100))}%"></div>
        </div><div class="rg-barra-fonte">Tetto ${tetto.toFixed(2)} $. Oltre, la coda si ferma da sola.</div>` : ''}
      </div>`;
  }

  // ── La newsletter ─────────────────────────────────────────────────────
  //
  // Era l'ultima cosa che esisteva solo nel pannello. Il flusso resta
  // quello: si sceglie il taglio, si genera, si rilegge, e solo allora si
  // invia. L'invio va a tutti i contatti con i tag della newsletter e non
  // si annulla: per questo il numero di destinatari sta scritto sul tasto,
  // non in una nota sotto.

  const TAGLI = {
    news:       ['Dalle notizie', 'Parte dall&#39;attualit&agrave; della settimana.'],
    originale:  ['Da esperto', 'Posizionamento: dice una cosa che gli altri non dicono.'],
    conversion: ['Per convertire', 'Rassicurante: smonta le obiezioni di chi ci sta pensando.'],
  };

  function newsletterHtml(dati, bozza) {
    const destinatari = dati?.destinatari;
    const cfg = dati?.configurazione || {};
    const manca = [];
    if (cfg.anthropic === false) manca.push('ANTHROPIC_API_KEY');
    if (cfg.ghl === false) manca.push('GHL_API_KEY');

    const storico = (dati?.storico || []).slice(0, 6);
    const c = bozza?.contenuto;
    const controllo = bozza?.controllo;

    return `
      ${manca.length ? `<div class="rg-voce"><b>Non si pu&ograve; lavorare:</b> al motore
         ${manca.length === 1 ? 'manca' : 'mancano'} ${manca.map(x => `<code>${esc(x)}</code>`).join(' e ')}.</div>` : ''}

      <div class="rg-sez">Scrivine una</div>
      <div class="rg-voce">
        ${Object.entries(TAGLI).map(([k, [et, spieg]]) => `
          <div class="rg-nl-taglio">
            <button class="btn btn-ghost btn-sm" data-nl-genera="${k}" ${manca.length ? 'disabled' : ''}>${et}</button>
            <span class="rg-voce-fonte">${spieg}</span>
          </div>`).join('')}
        <div class="rg-voce-fonte">Nasce come bozza: non parte niente finch&eacute; non lo decidi tu.</div>
      </div>

      ${c ? `
        <div class="rg-sez">La bozza</div>
        <div class="rg-voce">
          <div class="rg-nl-oggetto">${esc(c.subject || '')}</div>
          <div class="rg-voce-fonte">${esc(c.previewText || '')}</div>
          ${c.hook ? `<p class="rg-nl-hook">${esc(c.hook)}</p>` : ''}
          ${c.answer ? `<p>${esc(c.answer)}</p>` : ''}
          ${Array.isArray(c.bullets) && c.bullets.length
            ? `<ul class="rg-nl-punti">${c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          ${c.ps ? `<div class="rg-voce-fonte">PS: ${esc(c.ps)}</div>` : ''}
        </div>

        ${controllo && controllo.approved === false ? `
          <div class="rg-voce rg-nl-allarme">
            <b>Il controllo dei fatti ha trovato qualcosa.</b>
            ${Array.isArray(controllo.errors) && controllo.errors.length
              ? `<ul class="rg-nl-punti">${controllo.errors.slice(0, 5).map(e =>
                  `<li>${esc(typeof e === 'string' ? e : (e.message || e.issue || JSON.stringify(e)))}</li>`).join('')}</ul>`
              : ''}
            <div class="rg-voce-fonte">Rigenerala o correggila dal pannello completo prima di spedire.</div>
          </div>` : ''}

        <div class="rg-sez">Spedire</div>
        <div class="rg-voce">
          ${destinatari === null || destinatari === undefined
            ? 'Non riesco a contare i destinatari: controlla la chiave di GoHighLevel.'
            : `Va a <b>${destinatari}</b> ${destinatari === 1 ? 'persona' : 'persone'}, quelle con i tag della newsletter.`}
          <b> Non si annulla.</b>
          <div class="rg-voce-azioni">
            <button class="btn btn-accent btn-sm" data-nl-invia="1"
              ${manca.length || !destinatari ? 'disabled' : ''}>
              Spedisci a ${destinatari ?? '—'}</button>
            <button class="btn btn-ghost btn-sm" data-nl-scarta="1">Butta la bozza</button>
          </div>
        </div>` : ''}

      <div class="rg-sez">Ultime partite</div>
      ${storico.length
        ? storico.map(n => `<div class="rg-voce">
             <div>${esc(n.oggetto || '(senza oggetto)')}</div>
             <div class="rg-voce-fonte">${n.inviata ? window.ui.formatDate(n.inviata) : ''}${
               n.quanti ? ' · ' + n.quanti + ' destinatari' : ''}</div>
           </div>`).join('')
        : '<div class="rg-vuoto-tocca">Non ne &egrave; ancora partita nessuna da qui.</div>'}
    `;
  }

  async function apriNewsletter(dati = null, bozza = null) {
    ui.pannello = { tipo: 'newsletter', bozza };
    if (!dati) {
      apriPannello('Newsletter', 'Si scrive, si rilegge, si spedisce',
        '<div class="rg-vuoto-tocca">Carico…</div>');
      try { dati = await D.newsletter('elenco'); }
      catch (e) {
        corpoPannello().innerHTML =
          `<div class="rg-vuoto-tocca">Non riesco a leggere: ${esc(pulisciErrore(e.message))}</div>`;
        return;
      }
      if (ui.pannello?.tipo !== 'newsletter') return;
    }

    apriPannello('Newsletter', 'Si scrive, si rilegge, si spedisce', newsletterHtml(dati, bozza));
    const corpo = corpoPannello();

    corpo.querySelectorAll('[data-nl-genera]').forEach(b =>
      b.addEventListener('click', async (ev) => {
        const quale = ev.currentTarget.dataset.nlGenera;
        corpo.querySelectorAll('[data-nl-genera]').forEach(x => { x.disabled = true; });
        ev.currentTarget.textContent = 'La sto scrivendo…';
        try {
          const nuova = await D.newsletter('genera', { tipo: quale });
          await apriNewsletter(dati, nuova);
        } catch (e) {
          window.ui.showToast(pulisciErrore(e.message), 'error');
          await apriNewsletter(dati, bozza);
        }
      }));

    corpo.querySelector('[data-nl-scarta]')?.addEventListener('click', () => apriNewsletter(dati, null));

    corpo.querySelector('[data-nl-invia]')?.addEventListener('click', async (ev) => {
      const quanti = dati?.destinatari;
      // Una conferma che dice il numero e l'oggetto: "sei sicuro?" non
      // informa nessuno.
      if (!window.confirm(
        `Spedire "${bozza?.contenuto?.subject || ''}" a ${quanti} persone?\n\n` +
        `Parte subito e non si annulla.`)) return;
      ev.currentTarget.disabled = true;
      ev.currentTarget.textContent = 'Sto spedendo…';
      try {
        const esito = await D.newsletter('invia', { contenuto: bozza.contenuto });
        window.ui.showToast(esito.messaggio || 'Partita.', 'success');
        await apriNewsletter({ ...dati, storico: esito.storico || dati.storico }, null);
      } catch (e) {
        window.ui.showToast(pulisciErrore(e.message), 'error');
        await apriNewsletter(dati, bozza);
      }
    });
  }

  // ── Le foto del manager ───────────────────────────────────────────────
  //
  // La sezione c'era nel pannello del generatore e si e' persa quando quel
  // progetto e' diventato un motore senza voce di menu. Il flusso resta
  // quello: si generano, si guardano, si approvano, e solo allora
  // diventano sorgenti per le storie.

  const STATO_FOTO = {
    PENDING:  { et: 'Da vedere', classe: 'rg-foto-attesa' },
    APPROVED: { et: 'Approvata', classe: 'rg-foto-ok' },
    REJECTED: { et: 'Scartata',  classe: 'rg-foto-no' },
  };

  function fotoHtml(f) {
    const s = STATO_FOTO[f.stato] || STATO_FOTO.PENDING;
    return `
      <figure class="rg-foto ${s.classe}${f.attiva ? ' rg-foto-viva' : ''}">
        <img src="${esc(f.url)}" alt="Foto avatar" loading="lazy">
        <figcaption>
          <span class="rg-foto-et">${s.et}${f.attiva ? ' · in uso' : ''}</span>
          <span class="rg-foto-azioni">
            ${f.stato !== 'APPROVED'
              ? `<button class="btn btn-accent btn-sm" data-foto="APPROVED" data-id="${esc(f.id)}">Approva</button>` : ''}
            ${f.stato !== 'REJECTED'
              ? `<button class="btn btn-ghost btn-sm" data-foto="REJECTED" data-id="${esc(f.id)}">Scarta</button>` : ''}
            ${f.stato === 'REJECTED'
              ? `<button class="btn btn-ghost btn-sm" data-foto-elimina="${esc(f.id)}">Elimina</button>` : ''}
          </span>
        </figcaption>
      </figure>`;
  }

  async function apriAvatar(dati = null) {
    ui.pannello = { tipo: 'avatar' };
    if (!dati) {
      apriPannello('Le tue foto', 'Quelle che aprono le storie',
        '<div class="rg-vuoto-tocca">Carico…</div>');
      try { dati = await D.avatar('elenco'); }
      catch (e) {
        corpoPannello().innerHTML =
          `<div class="rg-vuoto-tocca">Non riesco a leggere le foto: ${esc(pulisciErrore(e.message))}</div>`;
        return;
      }
      if (ui.pannello?.tipo !== 'avatar') return;
    }

    const foto = dati.foto || [];
    const attive = Number(dati.attive || 0);
    const daVedere = Number(dati.da_vedere || 0);
    const max = Number(dati.massimo_per_volta || 8);
    // Chi e' approvata ma non ancora in uso: e' il motivo per cui il tasto
    // "Mettile in uso" esiste, quindi si dice quante sono.
    const inAttesaDiUso = foto.filter(f => f.stato === 'APPROVED' && !f.attiva).length;
    // Il motore dice quali chiavi ha, per nome: meglio dirlo prima che far
    // fallire la generazione dopo aver premuto.
    const cfg = dati.configurazione || {};
    const manca = [];
    if (cfg.openai === false) manca.push('OPENAI_API_KEY');
    if (cfg.cloudinary === false) manca.push('CLOUDINARY_API_KEY');
    // "foto" non cambia al plurale: a cambiare e' il verbo intorno.
    const una = (n, singolare, plurale) => (n === 1 ? singolare : plurale);

    apriPannello('Le tue foto', 'Quelle che aprono le storie', `
      <div class="rg-voce">
        ${attive
          ? `Le storie aprono con ${una(attive, 'l&#39;unica foto in uso', `una di <b>${attive}</b> foto, scelta a caso ogni volta`)}.`
          : `<b>Nessuna foto in uso.</b> Le storie partono senza la slide di apertura:
             comincerebbero da meta&#768; discorso.`}
        ${daVedere ? `<div class="rg-voce-fonte">${daVedere} ${una(daVedere, 'foto aspetta', 'foto aspettano')} che tu ${una(daVedere, 'la guardi', 'le guardi')}.</div>` : ''}
      </div>

      <div class="rg-sez">Fanne di nuove</div>
      <div class="rg-voce">
        ${manca.length
          ? `<b>Non si possono generare:</b> al motore ${manca.length === 1 ? 'manca' : 'mancano'}
             ${manca.map(x => `<code>${esc(x)}</code>`).join(' e ')}.
             ${manca.length === 1 ? 'Va messa' : 'Vanno messe'} fra le variabili d&#39;ambiente del
             progetto Vercel <b>indubai-social-manager</b>, con la spunta su Production, e poi serve
             una nuova pubblicazione.`
          : 'Nascono da vedere, non in uso: le guardi tu e decidi.'}
        <div class="rg-voce-azioni rg-foto-genera">
          <label class="rg-campo-et" for="rg-foto-quante">Quante</label>
          <input class="rg-campo" id="rg-foto-quante" type="number" min="1" max="${max}" value="4"
                 style="width:84px" ${manca.length ? 'disabled' : ''}>
          <button class="btn btn-accent btn-sm" data-foto-genera="1" ${manca.length ? 'disabled' : ''}>Genera</button>
        </div>
        ${manca.length ? '' : '<div class="rg-voce-fonte">Ognuna costa: chiedine poche e guarda come vengono.</div>'}
      </div>

      ${inAttesaDiUso || attive
        ? `<div class="rg-sez">Mettile in uso</div>
           <div class="rg-voce">
             ${inAttesaDiUso
               ? `${inAttesaDiUso} ${una(inAttesaDiUso, 'foto approvata non e&#768;', 'foto approvate non sono')}
                  ancora fra le sorgenti.`
               : 'Le sorgenti sono allineate alle approvate.'}
             <div class="rg-voce-azioni">
               <button class="btn btn-ghost btn-sm" data-foto-attiva="1">Rifai l&#39;elenco delle sorgenti</button>
             </div>
             <div class="rg-voce-fonte">
               Le sorgenti diventano tutte e sole le approvate: togliere un&#39;approvazione
               e rifare l&#39;elenco basta a togliere la foto dalle storie.
             </div>
           </div>`
        : ''}

      <div class="rg-sez">Tutte (${foto.length})</div>
      ${foto.length
        ? `<div class="rg-foto-griglia">${foto.map(fotoHtml).join('')}</div>`
        : '<div class="rg-vuoto-tocca">Non ce n&#39;e&#768; nessuna. Generane qualcuna qui sopra.</div>'}
    `);

    const corpo = corpoPannello();

    corpo.querySelector('[data-foto-genera]')?.addEventListener('click', async (ev) => {
      const quante = Math.max(1, Math.min(max, Number($('rg-foto-quante')?.value) || 4));
      const tasto = ev.currentTarget;
      tasto.disabled = true;
      tasto.textContent = 'Le sto facendo…';
      try {
        const d = await D.avatar('genera', { quante });
        window.ui.showToast(d.messaggio || 'Fatte.', 'success');
        await apriAvatar(d);
      } catch (e) {
        window.ui.showToast(pulisciErrore(e.message), 'error');
        tasto.disabled = false;
        tasto.textContent = 'Genera';
      }
    });

    corpo.querySelector('[data-foto-attiva]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const d = await D.avatar('attiva');
        window.ui.showToast(d.messaggio || 'Elenco rifatto.', 'success');
        await apriAvatar(d);
      } catch (e) {
        window.ui.showToast(pulisciErrore(e.message), 'error');
        ev.currentTarget.disabled = false;
      }
    });

    // Sulla griglia, non sul corpo del pannello: il corpo e' sempre lo
    // stesso elemento, e un ascoltatore in piu' a ogni riapertura vuol dire
    // la stessa richiesta mandata due volte, poi tre.
    corpo.querySelector('.rg-foto-griglia')?.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-foto], [data-foto-elimina]');
      if (!b) return;
      b.disabled = true;
      try {
        const d = b.dataset.fotoElimina
          ? await D.avatar('elimina', { id: b.dataset.fotoElimina })
          : await D.avatar('stato', { id: b.dataset.id, stato: b.dataset.foto });
        await apriAvatar(d);
      } catch (e) {
        window.ui.showToast(pulisciErrore(e.message), 'error');
        b.disabled = false;
      }
    });
  }

  async function apriDirezione() {
    ui.pannello = { tipo: 'direzione' };
    apriPannello('Direzione', 'Il piano di questa settimana',
      '<div class="rg-vuoto-tocca">Carico…</div>');

    let righe = [];
    try { righe = await D.piano(0) || []; }
    catch (e) {
      corpoPannello().innerHTML =
        `<div class="rg-vuoto-tocca">Non riesco a leggere il piano: ${esc(e.message)}</div>`;
      return;
    }
    if (ui.pannello?.tipo !== 'direzione') return;

    const s = D.stato.impostazioni || {};
    const spesoOggi = Number(s.speso_oggi_usd || 0);
    const budget = Number(s.budget_giorno_usd || 0);

    const corpo = righe.length
      ? righe.map(rigaPianoHtml).join('')
      : `<div class="rg-vuoto-tocca">
           Il piano e&#768; vuoto: gli agenti aspettano che tu dica cosa fare, ogni volta.
           Aggiungi una voce e sapranno da soli quanto deve uscire.
         </div>`;

    corpoPannello().innerHTML = `
      <div class="rg-sez">Cosa deve uscire</div>
      ${corpo}
      <div class="rg-piano-azioni">
        <button class="btn btn-accent btn-sm" data-piano-nuovo="1">Aggiungi una voce</button>
        ${righe.some(r => r.attivo && r.mancanti > 0)
          ? '<button class="btn btn-ghost btn-sm" data-piano-lancia="1">Lancia quello che manca</button>'
          : ''}
      </div>

      <div class="rg-sez">Da sola</div>
      <div class="rg-voce">
        ${s.piano_automatico === false
          ? 'Il piano <b>non</b> parte da solo: quello che manca lo lanci tu da qui.'
          : 'Ogni mattina, se la settimana non e&#768; coperta, il Direttore riceve da solo l&#39;incarico di coprirla.'}
        <div class="rg-voce-azioni">
          <button class="btn btn-ghost btn-sm" data-piano-auto="${s.piano_automatico === false ? '1' : '0'}">
            ${s.piano_automatico === false ? 'Fallo partire da solo' : 'Lascia decidere a me'}</button>
        </div>
      </div>

      <div class="rg-sez">Spesa</div>
      <div class="rg-voce">
        Oggi gli agenti hanno speso <b>${spesoOggi.toFixed(2)} $</b>
        ${budget ? `su un tetto di <b>${budget.toFixed(2)} $</b>` : ''}.
        Oltre il tetto la coda si ferma da sola.
        <div class="rg-voce-fonte">Il tetto lo cambia l&#39;amministratore.</div>
      </div>`;

    corpoPannello().querySelector('[data-piano-nuovo]')
      ?.addEventListener('click', () => formaRigaPiano(null));
    corpoPannello().querySelector('[data-piano-auto]')
      ?.addEventListener('click', async (ev) => {
        const verso = ev.currentTarget.dataset.pianoAuto === '1';
        ev.currentTarget.disabled = true;
        try {
          await D.pianoAutomatico(verso);
          window.ui.showToast(verso ? 'Parte da solo ogni mattina.' : 'Non parte piu\' da solo.', 'success');
          await apriDirezione();
        } catch (e) {
          window.ui.showToast(pulisciErrore(e.message), 'error');
          ev.currentTarget.disabled = false;
        }
      });
    corpoPannello().querySelector('[data-piano-lancia]')
      ?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          await D.lanciaQuelloCheManca();
          window.ui.showToast('Detto al Direttore. Guarda la sala.', 'success');
          chiudiPannello();
          cambiaVista('sala');
        } catch (e) { window.ui.showToast(pulisciErrore(e.message), 'error'); }
      });

    for (const b of corpoPannello().querySelectorAll('[data-piano-modifica]')) {
      b.addEventListener('click', () =>
        formaRigaPiano(righe.find(r => r.id === b.dataset.pianoModifica)));
    }
    for (const b of corpoPannello().querySelectorAll('[data-piano-acceso]')) {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await D.salvaRigaPiano(b.dataset.pianoAcceso, { attivo: b.dataset.verso === '1' });
          await apriDirezione();
        } catch (e) { window.ui.showToast(pulisciErrore(e.message), 'error'); b.disabled = false; }
      });
    }
    for (const b of corpoPannello().querySelectorAll('[data-piano-togli]')) {
      b.addEventListener('click', () => {
        const r = righe.find(x => x.id === b.dataset.pianoTogli);
        modale('Togliere questa voce?', `
          <p>«${esc(r.nome)}» non fara&#768; piu&#768; parte del piano, e gli agenti non sapranno
          piu&#768; che deve uscire. I contenuti gia&#768; fatti restano dove sono.</p>`,
          [{ etichetta: 'Togli', primaria: true, azione: async () => {
              await D.eliminaRigaPiano(r.id);
              chiudiModale();
              window.ui.showToast('Togliata dal piano.', 'success');
              apriDirezione();
            } }]);
      });
    }
  }

  function rigaPianoHtml(r) {
    const previsti = Number(r.quanti_a_settimana || 0);
    const fatti = Number(r.usciti || 0) + Number(r.in_calendario || 0) + Number(r.in_lavorazione || 0);
    const manca = Number(r.mancanti || 0);
    const quota = previsti ? Math.min(100, Math.round(fatti / previsti * 100)) : 0;
    const det = [];
    if ((r.pillar || []).length)    det.push('pillar ' + r.pillar.join(' o '));
    if ((r.categorie || []).length) det.push('categoria ' + r.categorie.join(' o '));
    det.push(r.agente ? `li fa ${esc(r.agente)}` : 'lo decide il Direttore');
    if ((r.giorni || []).length) {
      det.push('giorni: ' + r.giorni.map(g => (GIORNI.find(x => x[0] === Number(g)) || [, g])[1]).join(', '));
    }
    if (r.ora) det.push(`verso le ${String(r.ora).slice(0, 5)}`);

    return `<div class="rg-piano-riga ${r.attivo ? '' : 'spenta'}">
      <div class="rg-piano-testa">
        <span class="rg-piano-nome">${esc(r.nome)}</span>
        <span class="rg-piano-conto ${!r.attivo ? '' : manca ? 'manca' : 'pieno'}">${fatti} su ${previsti}</span>
      </div>
      <div class="rg-piano-prog"><span style="width:${quota}%"></span></div>
      <div class="rg-piano-det">${esc(det.join(' · '))}</div>
      ${!r.attivo
        ? '<div class="rg-piano-det">In pausa: gli agenti non la contano e non la coprono.</div>'
        : manca
          ? `<div class="rg-piano-det"><b>Mancano ${manca}.</b> ${Number(r.usciti) ? `Usciti ${r.usciti}. ` : ''}${Number(r.in_calendario) ? `In calendario ${r.in_calendario}. ` : ''}${Number(r.in_lavorazione) ? `In lavorazione ${r.in_lavorazione}.` : ''}</div>`
          : '<div class="rg-piano-det">Questa voce è coperta.</div>'}
      ${r.come ? `<div class="rg-piano-come">${esc(r.come)}</div>` : ''}
      <div class="rg-piano-azioni">
        <button class="btn btn-ghost btn-sm" data-piano-modifica="${r.id}">Modifica</button>
        <button class="btn btn-ghost btn-sm" data-piano-acceso="${r.id}" data-verso="${r.attivo ? '0' : '1'}">
          ${r.attivo ? 'Metti in pausa' : 'Rimetti in piano'}</button>
        <button class="btn btn-ghost btn-sm" data-piano-togli="${r.id}">Togli</button>
      </div>
    </div>`;
  }

  function formaRigaPiano(r) {
    const nuova = !r;
    const agenti = D.stato.agenti.filter(a => a.slug !== 'direttore');
    modale(nuova ? 'Una voce nuova nel piano' : 'Modifica la voce', `
      <label class="rg-campo"><span>Come la chiamiamo</span>
        <input id="rg-p-nome" value="${esc(r?.nome || '')}"
          placeholder="Per esempio: caroselli fiscali del marted&igrave;"></label>

      <label class="rg-campo"><span>Che cos&#39;e&#768;</span>
        <select id="rg-p-tipo">${TIPI.map(([k, et]) =>
          `<option value="${k}" ${r?.tipo === k ? 'selected' : ''}>${et}</option>`).join('')}</select></label>

      <label class="rg-campo"><span>Quanti a settimana</span>
        <input id="rg-p-quanti" type="number" min="0" max="70"
          value="${r ? r.quanti_a_settimana : 2}"></label>

      <label class="rg-campo"><span>Chi li fa</span>
        <select id="rg-p-agente">
          <option value="">lo decide il Direttore</option>
          ${agenti.map(a => `<option value="${a.id}" ${r?.agente_id === a.id ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}
        </select></label>

      <div class="rg-campo"><span>Che giorni</span>
        <div id="rg-p-giorni" style="display:flex;gap:6px;flex-wrap:wrap">
          ${GIORNI.map(([n, et]) => `
            <button type="button" class="rg-zona" data-g="${n}"
              aria-pressed="${(r?.giorni || []).map(Number).includes(n)}">${et}</button>`).join('')}
        </div>
        <div class="rg-campo-aiuto">Nessuno selezionato: li distribuisce il Direttore.</div></div>

      <label class="rg-campo"><span>Pillar, se vuoi vincolarlo</span>
        <input id="rg-p-pillar" value="${esc((r?.pillar || []).join(', '))}"
          placeholder="fiscale, residenza">
        <div class="rg-campo-aiuto">Separati da virgola. Vuoto: qualunque pillar vale per questa voce.</div></label>

      <label class="rg-campo"><span>Come vanno fatti</span>
        <textarea id="rg-p-come" placeholder="Scrivilo come lo spiegheresti a una persona nuova. Per esempio: si apre con un numero, si chiude con un invito a leggere l&#39;approfondimento, mai piu&#768; di sei slide.">${esc(r?.come || '')}</textarea>
        <div class="rg-campo-aiuto">Questo testo lo legge l&#39;agente parola per parola, ogni volta che lavora su questa voce.</div></label>
      `,
      [{ etichetta: nuova ? 'Aggiungi' : 'Salva', primaria: true, azione: async () => {
          const nome = $('rg-p-nome').value.trim();
          if (!nome) { window.ui.showToast('Serve un nome per riconoscerla.', 'error'); return; }
          const giorni = [...document.querySelectorAll('#rg-p-giorni [data-g][aria-pressed="true"]')]
            .map(b => Number(b.dataset.g));
          const dati = {
            nome,
            tipo: $('rg-p-tipo').value,
            quanti_a_settimana: Math.max(0, Number($('rg-p-quanti').value) || 0),
            agente_id: $('rg-p-agente').value || null,
            giorni,
            pillar: $('rg-p-pillar').value.split(',').map(x => x.trim()).filter(Boolean),
            come: $('rg-p-come').value.trim() || null,
          };
          if (nuova) await D.nuovaRigaPiano(dati);
          else await D.salvaRigaPiano(r.id, dati);
          chiudiModale();
          window.ui.showToast(nuova ? 'Aggiunta al piano.' : 'Salvata.', 'success');
          apriDirezione();
        } }]);

    // I giorni sono tasti, non caselle: si premono e restano premuti.
    document.getElementById('rg-p-giorni')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-g]');
      if (!b) return;
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
  }

  // ══════════════════════════════════════════════════════════
  // Interruttori
  // ══════════════════════════════════════════════════════════

  async function cambiaInterruttore(forza) {
    const fermoAdesso = !!D.stato.impostazioni?.stop_tutto;
    const fermo = typeof forza === 'boolean' ? forza : !fermoAdesso;
    if (fermo === fermoAdesso) return;

    // Fermare tutto si conferma, far ripartire no: il verso prudente non
    // chiede permesso.
    if (!fermo) return applicaInterruttore(false);

    const inCorso = D.stato.lavori.filter(j => j.stato === 'in_corso').length;
    modale('Fermare tutti gli agenti?', `
      <p>Non parte nessun lavoro nuovo e non si spende piu&#768; niente.
      ${inCorso ? `I <b>${inCorso}</b> gia&#768; partiti finiscono il loro giro: non si possono richiamare a metà.` : ''}
      Quelli in coda restano in coda e ripartono da soli quando riaccendi.</p>`,
      [{ etichetta: 'Ferma tutto', primaria: true, azione: async () => {
          await applicaInterruttore(true);
          chiudiModale();
        } }]);
  }

  async function applicaInterruttore(fermo) {
    const sw = $('rg-interruttore');
    if (sw) sw.disabled = true;
    try {
      await D.interruttore(fermo);
      window.ui.showToast(fermo ? 'Fermi.' : 'Ripartiti.', 'success');
    } catch (e) {
      window.ui.showToast(pulisciErrore(e.message), 'error');
    } finally {
      if (sw) sw.disabled = false;
    }
  }

  // ══════════════════════════════════════════════════════════
  // Modali
  // ══════════════════════════════════════════════════════════
  function modale(titolo, corpo, azioni) {
    // Mai una finestra sopra il pannello: se e' aperto, prima si chiude.
    // E' la regola che toglie alla radice l'accavallamento.
    if ($('rg-pannello').classList.contains('aperto')) chiudiPannello();
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
    setTimeout(() => $('rg-modale-corpo')
      .querySelector('textarea, input, select')?.focus(), 60);
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

  /**
   * Schermo intero sulla scena.
   * Va chiesto da un gesto dell'utente, e il browser puo' rifiutare: in quel
   * caso si dice perche' invece di non fare niente.
   */
  async function schermoIntero() {
    const palco = $('rg-palco');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (palco.requestFullscreen) await palco.requestFullscreen();
      else if (palco.webkitRequestFullscreen) palco.webkitRequestFullscreen();
      else window.ui.showToast('Questo browser non apre lo schermo intero.', 'error');
    } catch (e) {
      window.ui.showToast('Schermo intero non disponibile qui.', 'error');
    }
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
    // La barra della vista riguarda solo la Sala: nelle altre sparisce
    // tutta, invece di restare mezza vuota.
    $('rg-barra-vista').hidden = quale !== 'sala';
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
      disegnaFasciaAgenti();
      disegnaFasciaSettimana().catch(() => {});
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
    if (t.closest?.('[data-piano]')) return apriDirezione();
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('rg-btn-nuovo').addEventListener('click', nuovoLavoro);
    $('rg-btn-reference').addEventListener('click', nuovaReference);
    $('rg-btn-cervello').addEventListener('click', apriCervello);
    $('rg-btn-direzione').addEventListener('click', apriDirezione);
    $('rg-calma-direzione')?.addEventListener('click', apriDirezione);
    $('rg-btn-avatar')?.addEventListener('click', () => apriAvatar());
    $('rg-btn-newsletter')?.addEventListener('click', () => apriNewsletter());
    $('rg-interruttore').addEventListener('click', () => cambiaInterruttore());
    $('rg-fermo-riparti').addEventListener('click', () => cambiaInterruttore(false));
    $('rg-pan-chiudi').addEventListener('click', chiudiPannello);
    $('rg-velo').addEventListener('click', chiudiPannello);
    $('rg-modale-chiudi').addEventListener('click', chiudiModale);
    $('rg-cam-reset').addEventListener('click', () => ui.tridi?.torna());
    $('rg-zoom-piu').addEventListener('click', () => ui.tridi?.zoom(1));
    $('rg-zoom-meno').addEventListener('click', () => ui.tridi?.zoom(-1));
    $('rg-schermo').addEventListener('click', schermoIntero);

    // La rotellina sulla scena non deve far scorrere la pagina: la scena se
    // la prende per lo zoom. Fuori dalla scena la pagina scorre normale.
    $('rg-palco').addEventListener('wheel', (ev) => {
      if (ui.tridi) ev.preventDefault();
    }, { passive: false });
    $('rg-btn-vista').addEventListener('click', () =>
      cambiaVistaSala(ui.usaTridi ? 'lista' : '3d'));
    for (const b of document.querySelectorAll('[data-vista]')) {
      b.addEventListener('click', () => cambiaVista(b.dataset.vista));
    }
    $('rg-pan-testo').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('rg-pan-invia').click(); }
    });
    // Esc chiude un livello alla volta, dal piu' alto: prima la finestra,
    // poi il riquadro dentro il pannello, poi il pannello, poi lo schermo
    // intero. Senza quest'ordine si chiudeva tutto insieme.
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if ($('rg-modale').style.display !== 'none') return chiudiModale();
      if ($('rg-riquadro')) return chiudiRiquadro();
      if ($('rg-pannello').classList.contains('aperto')) return chiudiPannello();
      if (document.fullscreenElement) document.exitFullscreen?.();
    });

    document.addEventListener('fullscreenchange', () => {
      const dentro = !!document.fullscreenElement;
      $('rg-schermo').setAttribute('aria-pressed', String(dentro));
      $('rg-schermo').title = dentro ? 'Esci da schermo intero' : 'Schermo intero';
      // La tela deve rimisurarsi: il contenitore ha cambiato dimensione.
      setTimeout(() => ui.tridi?.ridimensiona?.(), 60);
    });
    // Il pannello si aggancia anche al tasto Guarda dentro un fumetto 3D.
    avvia();
  });

  window.addEventListener('beforeunload', () => { D.fermati(); spegniTridi(); });
})();
