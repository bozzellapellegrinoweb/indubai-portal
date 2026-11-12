(function () {
  const BRAND = 'ecdcc147-6256-4df7-8e36-75613f6987b9';
  const CID = 'f62b1e44-eca0-4fc7-94ab-16c45815d262';
  const U = 'https://res.cloudinary.com/djn4uyihl/raw/upload/v1794433967/indubai-smm/story_' + CID;

  const agenti = [
    ['6782e953-9f4a-44f6-b458-5a59426a10bd','direttore','Direttore','Direttore',0,'direzione',-3.2,0],
    ['2852685a-1f46-4adb-b91b-c973ae23bf83','stratega','Stratega editoriale','Stratega',1,'studio',-1.2,-2.4],
    ['9931c699-ddf4-44fa-b771-6ad40c145e05','copywriter','Copywriter','Copywriter',2,'studio',1.2,-2.4],
    ['969122a5-fa1a-4a46-b640-a49effd7ed45','grafico','Grafico','Grafico',3,'studio',3.2,-2.4],
    ['98d4d107-b28b-4398-a930-e4ea9fd8935c','video','Video','Video',4,'montaggio',-2,2.6],
    ['1b4526dc-492f-4295-b795-d67d50cee28a','revisore','Revisore di conformita','Revisore',5,'revisione',3.4,2.6],
    ['79d4f1f3-a11e-41f6-b683-99b0f7f92c72','pubblicatore','Pubblicatore','Pubblicatore',6,'uscita',0.6,4.8],
    ['d44e9f8d-831b-4466-8acd-3e7c5f0ad9d0','analista','Analista','Analista',7,'uscita',2.6,4.8],
  ].map(([id, slug, nome, ruolo, ordine, zona, x, z]) => ({
    id, slug, nome, ruolo, ordine, zona, posizione: { x, z },
    colore: ({'direttore':'#2563a8','stratega':'#7c3aed','copywriter':'#16a34a','grafico':'#d97706','video':'#db2777','revisore':'#dc2626','pubblicatore':'#0369a1','analista':'#6b7280'})[slug],
    attivo: true, brand_id: BRAND,
    model: 'claude-opus-5-5', descrizione: ruolo, strumenti: [],
  }));

  const slides = [
    { numero: 1, titolo: 'Il visto per Dubai arriva in poche settimane. La residenza fiscale no.',
      testo: 'Il visto ti rende residente negli Emirati sulla carta. Per il certificato di residenza fiscale servono più di 183 giorni di presenza effettiva nel Paese.' },
    { numero: 2, titolo: "Intanto l'Italia guarda altro",
      testo: "Per il Fisco italiano contano casa, interessi e presenza. Dal 2024 basta anche la sola presenza fisica in Italia per la maggior parte dell'anno." },
    { numero: 3, titolo: 'E se ti vogliono residente entrambi?',
      testo: 'La convenzione tra Italia ed Emirati ha un ordine preciso di criteri. Se vuoi capire a che punto sei, scrivici in privato.' },
  ];

  const contenuto = {
    id: CID, brand_id: BRAND, titolo: 'Storia 6/7 – Confronto Italia Dubai',
    tipo: 'storia', stato: 'da_approvare', pillar: 'confronto italia dubai',
    categoria: 'residenza', slides, caption: 'Il visto per Dubai arriva in poche settimane…',
    hashtags: [], revisore_ok: true, approvato_da: null, slot_at: null,
    created_at: '2026-11-11T19:58:51Z', brief: null, revisore_note: null,
  };

  // L'ordine di arrivo NON e' quello delle pagine: e' il caso che
  // l'anteprima deve reggere.
  const media = [2, 1, 3].map((n, k) => ({
    id: 'm' + n, content_id: CID, ruolo: 'derivato', bucket: 'cloudinary',
    path: 'indubai-smm/story_' + CID + '_' + n,
    nome_file: 'story_' + CID + '_' + n,
    mime: 'video/mp4', cloudinary_url: U + '_' + n + '.mp4',
    created_at: '2026-11-11T21:02:0' + k + 'Z', bytes: 180000,
  }));

  const lavori = [
    { id: 'j1', brand_id: BRAND, agent_id: agenti[2].id, content_id: CID, tipo: 'agente',
      stato: 'in_corso', titolo: 'Scrivere la storia', attivita: 'scrive',
      created_at: new Date().toISOString(), started_at: new Date().toISOString(),
      costo_usd: 0.2, priorita: 50 },
    { id: 'j2', brand_id: BRAND, agent_id: agenti[5].id, content_id: CID, tipo: 'agente',
      stato: 'attesa_risposta', titolo: 'Dubbio sulla CRS',
      domanda: 'Posso dire che il Fisco vede il conto, o è troppo netto?',
      attivita: 'ha una domanda', created_at: new Date().toISOString(), priorita: 60 },
    { id: 'j3', brand_id: BRAND, agent_id: agenti[3].id, content_id: CID, tipo: 'agente',
      stato: 'in_coda', titolo: 'Montare le slide', created_at: new Date().toISOString(), priorita: 50 },
  ];

  // Due contenuti in piu' per guardare il calendario: uno approvato che
  // aspetta una data, uno gia' in calendario per oggi alle 18.
  const oggi18 = (() => {
    const d = new Date(); d.setHours(18, 0, 0, 0); return d.toISOString();
  })();
  const altri = [
    { ...contenuto, id: 'c-pronto', titolo: 'Corporate Tax: la soglia che tutti sbagliano',
      tipo: 'carosello', stato: 'approvato', slot_at: null, approvato_da: 'u-prova' },
    { ...contenuto, id: 'c-oggi', titolo: 'Residenza fiscale: il visto non basta',
      tipo: 'storia', stato: 'in_calendario', slot_at: oggi18, approvato_da: 'u-prova' },
  ];

  // ?calma=1 : la sala senza lavori, come la trova il manager a fine
  // giornata quando il piano della settimana e' gia' coperto.
  if (new URLSearchParams(location.search).has('calma')) lavori.length = 0;

  const stato = {
    contenutiExtra: altri,
    brand: { id: BRAND, nome: 'InDubai', cta_default: 'Approfondisci su InDubai.it', sito: 'InDubai.it' },
    agenti, lavori, contenuti: [contenuto, ...altri],
    impostazioni: { brand_id: BRAND, stop_tutto: false, budget_giorno_usd: 10,
                    speso_oggi_usd: 0.4798, speso_oggi_data: '2026-11-12', piano_automatico: true },
    piano: [], cervelloContatori: { regola: 51, nota: 3, studio: 0, design: 2, daConfermare: 1 },
    profilo: { id: 'u-prova', role: 'admin' }, caricato: true,
  };

  const ascoltatori = new Set();
  const nulla = async () => {};
  const vuoto = async () => [];

  window.regiaDati = {
    stato,
    carica: async () => stato,
    avvia: () => { setTimeout(() => { for (const f of ascoltatori) f(stato); }, 0); },
    fermati: () => {},
    ascolta: (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); },
    // Copiate dal vero regia-dati.js: una finta che si comporta
    // diversamente fa trovare difetti che non esistono.
    lavoroVivoDi(id) {
      return lavori.find(j => j.agent_id === id && ['in_corso', 'attesa_risposta'].includes(j.stato))
          || lavori.find(j => j.agent_id === id && j.stato === 'in_coda') || null;
    },
    posaDi(id) {
      const a = agenti.find(x => x.id === id);
      if (a && a.attivo === false) return 'spento';
      const j = this.lavoroVivoDi(id);
      if (!j) return 'libero';
      if (j.stato === 'attesa_risposta') return 'mano_alzata';
      if (j.stato === 'in_corso') return 'lavora';
      return 'attende';
    },
    collaborazioni: () => [],
    riepilogo() {
      const domande = lavori.filter(j => j.stato === 'attesa_risposta').length;
      const lavorano = lavori.filter(j => j.stato === 'in_corso').length;
      const inCoda = lavori.filter(j => j.stato === 'in_coda').length;
      const daGuardare = stato.contenuti.filter(c => c.stato === 'da_approvare').length;
      const occupati = new Set(lavori.filter(j => ['in_corso','in_coda'].includes(j.stato)).map(j => j.agent_id));
      const accesi = agenti.filter(a => a.attivo !== false);
      const spenti = agenti.length - accesi.length;
      const liberi = accesi.filter(a => !occupati.has(a.id)).length;
      return { domande, lavorano, inCoda, daGuardare, liberi, spenti, totale: agenti.length };
    },
    // La forma e' quella vera di D.toccaATe() in js/regia-dati.js:172-178.
    // Prima qui mancavano titolo, id e azione: la tessera usciva senza
    // titolo e con un tasto senza scritta, e sembrava un difetto del
    // prodotto. E' la trappola del mestiere scritta in LEGGIMI.md: una
    // finta che non somiglia all'originale fa cercare il guasto nel posto
    // sbagliato.
    toccaATe: () => [{ tipo: 'domanda', id: 'j2', agente: agenti[5],
                       titolo: 'Revisore di conformita ha una domanda',
                       testo: 'Posso dire che il Fisco vede il conto, o e troppo netto?',
                       azione: 'Rispondi' }],
    contenuto: async () => contenuto,
    versioni: vuoto, note: vuoto, messaggiDi: vuoto,
    lavoriDi: async (id) => lavori.filter(j => j.content_id === id),
    mediaDi: async () => media,
    plurale: (t, n) => (n === 1 ? t : t),
    piano: async () => ([
      { id:'p1', nome:'Storie quotidiane', tipo:'storia', quanti_a_settimana:7, attivo:true,
        usciti:1, in_calendario:1, in_lavorazione:5, mancanti:0 },
      { id:'p2', nome:'Caroselli dalle notizie', tipo:'carosello', quanti_a_settimana:3, attivo:true,
        usciti:0, in_calendario:0, in_lavorazione:1, mancanti:2 },
    ]), risultati: vuoto, cervelloCerca: vuoto, cervelloDaConfermare: vuoto,
    avatar: async () => ({ ok: true, foto: [], attive: 0, da_vedere: 0, massimo_per_volta: 8 }),
    newsletter: async (azione, extra) => {
      if (azione === 'genera') return { ok: true, tipo: extra.tipo, contenuto: {
        subject: 'Il visto non ti rende residente fiscale',
        previewText: 'E la differenza te la fa pagare il Fisco italiano',
        hook: 'Hai il visto, hai l\'Emirates ID. Per l\'Italia dove sei residente?',
        answer: 'Dove hai il centro dei tuoi interessi, non dove hai il permesso di soggiorno.',
        bullets: ['Il certificato di residenza fiscale vuole 183 giorni di presenza',
                  'L\'AIRE e\' necessaria ma non basta da sola',
                  'La convenzione Italia-Emirati ha un ordine preciso di criteri'],
        ps: 'Se stai gia\' facendo avanti e indietro, il tempo gioca contro di te.',
      }, html: '<p>…</p>', controllo: extra.tipo === 'originale'
        ? { approved: false, errors: ['La soglia citata non corrisponde al testo vigente'] } : null };
      if (azione === 'invia') return { ok: true, sent: 412, failed: 0,
        messaggio: 'Inviata a 412 persone.', storico: [] };
      return { ok: true, tagli: ['news','originale','conversion'], destinatari: 412,
        storico: [{ id: '1', oggetto: 'Corporate Tax: la soglia dei 375.000',
                    inviata: '2026-11-05T09:00:00Z', quanti: 408 }],
        configurazione: { anthropic: true, ghl: true } };
    },
    linkFirmato: async (p) => null,
    aggiungiNota: nulla, risolviNota: nulla, approva: nulla, approvaComeAdmin: nulla,
    rimandaIndietro: nulla, spostaInCalendario: nulla, pubblicaOra: nulla,
    cervelloConferma: nulla, cervelloScarta: nulla, cervelloAggiungi: nulla,
    scarta: async () => 'buttato',
    nuovaReference: nulla, salvaRisultato: nulla, salvaImpostazioni: nulla,
    nuovaRigaPiano: nulla, salvaRigaPiano: nulla, eliminaRigaPiano: nulla,
    lanciaQuelloCheManca: nulla, interruttore: nulla, accendiAgente: nulla,
    pianoAutomatico: nulla, caricaFile: nulla, svegliaWorker: nulla, rendi: nulla,
    scriviAlDirettore: nulla, scriviAdAgente: nulla, rispondiAlLavoro: nulla,
  };
})();
