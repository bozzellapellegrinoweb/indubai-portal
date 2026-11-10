// ============================================================
// Regia SMM — la scena 3D
// ============================================================
// Three.js puro, caricato come modulo da jsDelivr. Non React Three Fiber:
// il portale e' HTML e JavaScript senza alcun passaggio di compilazione
// (vercel.json ha buildCommand "echo skip"), e portare React e un bundler
// dentro un progetto cosi' per una pagina sola non si giustifica.
//
// Tre scelte che vale la pena spiegare:
//
// 1. I fumetti sopra la testa sono HTML, non sprite. In React Three Fiber lo
//    farebbe drei con <Html>; qui si proietta la posizione 3D in coordinate
//    schermo e si muove un div. Stesso risultato, nessuna dipendenza, e il
//    testo resta selezionabile e leggibile da uno screen reader.
//
// 2. Niente occlusione ambientale calcolata: SSAO su un telefono costa piu'
//    di quanto renda. Al suo posto ombre morbide e un piano di contatto con
//    una texture radiale sotto ogni oggetto. A occhio e' la stessa cosa e
//    gira a sessanta fotogrammi.
//
// 3. L'ufficio e' tutto procedurale: nessun file di modello da scaricare,
//    niente da tenere aggiornato, e la scena si apre in un attimo.
//
// Tutto cio' che si vede qui esiste anche nella vista a lista, che e'
// sempre disponibile: il 3D e' un modo di guardare gli stessi dati, non il
// solo modo di usare la sezione.
// ============================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';

const COLORI = {
  pavimento:  0xf4f2ec,
  muro:       0xffffff,
  scrivania:  0xe9e4d8,
  gambe:      0xbdb6a6,
  monitor:    0x2b2e35,
  sedia:      0xd6d0c2,
  pianta:     0x6aa84f,
  vaso:       0xcfc6b4,
  divisorio:  0xe3ddd0,
  tappeto:    0xece7dc,
};

const POSA = {
  libero:      { colore: 0x9ca3af, etichetta: 'libero' },
  attende:     { colore: 0xd97706, etichetta: 'in attesa' },
  lavora:      { colore: 0x16a34a, etichetta: 'al lavoro' },
  mano_alzata: { colore: 0xdc2626, etichetta: 'ha una domanda' },
};

/** Il centro di ogni zona. Gli agenti si disperdono attorno al loro. */
const ZONE = {
  direzione: { x: -4.2, z: -0.4, nome: 'Direzione' },
  studio:    { x:  1.6, z: -3.4, nome: 'Studio creativo' },
  montaggio: { x: -2.4, z:  3.2, nome: 'Montaggio' },
  uscita:    { x:  2.4, z:  4.2, nome: 'Uscita' },
  revisione: { x:  4.6, z:  1.0, nome: 'Revisione' },
  cervello:  { x:  0.0, z:  0.6, nome: 'Cervello condiviso' },
};

export function creaScena(contenitore, opzioni = {}) {
  const {
    onClickAgente = () => {},
    onClickCervello = () => {},
    movimentoRidotto = false,
  } = opzioni;

  // ── Renderer ────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: !movimentoRidotto,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0xf7f6f2, 1);
  // Il rapporto di pixel si adatta: su un telefono con schermo molto denso
  // disegnare a tre volte la risoluzione non si vede e scalda la batteria.
  const dprMax = movimentoRidotto ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dprMax);
  renderer.shadowMap.enabled = !movimentoRidotto;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  contenitore.appendChild(renderer.domElement);

  const scena = new THREE.Scene();
  scena.fog = new THREE.Fog(0xf7f6f2, 22, 42);

  // ── Camera quasi ortografica ────────────────────────────
  // Un campo visivo molto stretto da lontano: la prospettiva resta appena
  // percepibile, come in un disegno isometrico, ma i click si proiettano
  // ancora in modo naturale.
  const camera = new THREE.PerspectiveCamera(22, 1, 1, 200);
  const bersaglio = new THREE.Vector3(0, 0.6, 0.4);
  const orbita = { raggio: 26, theta: Math.PI * 0.25, phi: Math.PI * 0.30 };
  const orbitaRiposo = { ...orbita };

  function piazzaCamera() {
    const r = orbita.raggio, t = orbita.theta, p = orbita.phi;
    camera.position.set(
      bersaglio.x + r * Math.sin(p) * Math.cos(t),
      bersaglio.y + r * Math.cos(p),
      bersaglio.z + r * Math.sin(p) * Math.sin(t),
    );
    camera.lookAt(bersaglio);
  }
  piazzaCamera();

  // ── Luci: seguono l'ora di Dubai ────────────────────────
  const ambiente = new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 0.95);
  scena.add(ambiente);

  const sole = new THREE.DirectionalLight(0xfff4e0, 1.5);
  sole.position.set(7, 12, 5);
  sole.castShadow = !movimentoRidotto;
  if (sole.shadow) {
    sole.shadow.mapSize.set(movimentoRidotto ? 512 : 2048, movimentoRidotto ? 512 : 2048);
    sole.shadow.camera.left = -14; sole.shadow.camera.right = 14;
    sole.shadow.camera.top = 14;   sole.shadow.camera.bottom = -14;
    sole.shadow.camera.near = 1;   sole.shadow.camera.far = 40;
    sole.shadow.bias = -0.0008;
    sole.shadow.normalBias = 0.02;
  }
  scena.add(sole);

  const riempimento = new THREE.DirectionalLight(0xdce6ff, 0.35);
  riempimento.position.set(-8, 6, -6);
  scena.add(riempimento);

  /** 0 = alba, 0.5 = mezzogiorno, 1 = sera. Calcolato sull'ora di Dubai. */
  function aggiornaLuce() {
    const oraDubai = Number(new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Asia/Dubai', hour: 'numeric', hour12: false,
    }).format(new Date()));
    const minuti = Number(new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Asia/Dubai', minute: 'numeric',
    }).format(new Date()));
    const ora = oraDubai + minuti / 60;

    // Giorno fra le 6 e le 19: il sole gira e si abbassa.
    const giorno = Math.min(1, Math.max(0, (ora - 5.5) / 13.5));
    const altezza = Math.sin(Math.PI * giorno);
    const sera = ora >= 18 || ora < 6.5;

    sole.position.set(
      Math.cos(Math.PI * giorno) * 10,
      2 + altezza * 12,
      5 - altezza * 2,
    );
    sole.intensity = sera ? 0.45 : 0.9 + altezza * 0.8;
    sole.color.setHex(sera ? 0xffd9a8 : (giorno < 0.25 || giorno > 0.8 ? 0xffe2bb : 0xfff6e8));

    ambiente.intensity = sera ? 0.55 : 0.8 + altezza * 0.3;
    ambiente.color.setHex(sera ? 0xdfe4f0 : 0xffffff);
    ambiente.groundColor.setHex(sera ? 0xbdbac4 : 0xd8d2c4);

    const sfondo = sera ? 0xe8e6ee : 0xf7f6f2;
    renderer.setClearColor(sfondo, 1);
    scena.fog.color.setHex(sfondo);
    return { sera, ora };
  }
  let condizioniLuce = aggiornaLuce();

  // ── Materiali condivisi ─────────────────────────────────
  const mat = {};
  for (const [nome, colore] of Object.entries(COLORI)) {
    mat[nome] = new THREE.MeshLambertMaterial({ color: colore });
  }
  mat.scrivania = new THREE.MeshPhongMaterial({ color: COLORI.scrivania, shininess: 8 });
  mat.monitor   = new THREE.MeshPhongMaterial({ color: COLORI.monitor, shininess: 40 });
  mat.vetro     = new THREE.MeshPhongMaterial({
    color: 0xcfe4f5, transparent: true, opacity: 0.22, shininess: 90,
  });

  // L'ombra di contatto: una macchia radiale su un piano. Costa una texture
  // e due triangoli, e da' all'oggetto il peso che l'occlusione ambientale
  // darebbe a un prezzo molto piu' alto.
  const texOmbra = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(20,22,26,0.34)');
    grad.addColorStop(0.55, 'rgba(20,22,26,0.14)');
    grad.addColorStop(1, 'rgba(20,22,26,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const matOmbra = new THREE.MeshBasicMaterial({
    map: texOmbra, transparent: true, depthWrite: false,
  });
  const geoOmbra = new THREE.PlaneGeometry(1, 1);

  function ombraContatto(x, z, raggio = 1.6) {
    const m = new THREE.Mesh(geoOmbra, matOmbra);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.scale.set(raggio, raggio, 1);
    return m;
  }

  // ── L'ufficio ───────────────────────────────────────────
  const ufficio = new THREE.Group();
  scena.add(ufficio);

  const pavimento = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat.pavimento);
  pavimento.rotation.x = -Math.PI / 2;
  pavimento.receiveShadow = !movimentoRidotto;
  ufficio.add(pavimento);

  // Fughe del pavimento: una griglia leggera, non un reticolo tecnico.
  const griglia = new THREE.GridHelper(30, 30, 0xe2ddd1, 0xe9e5db);
  griglia.position.y = 0.002;
  ufficio.add(griglia);

  // Due muri, appena accennati: chiudono la stanza senza chiudere la vista.
  for (const [w, h, x, y, z, ry] of [[30, 5.5, 0, 2.75, -15, 0], [30, 5.5, -15, 2.75, 0, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat.muro);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.receiveShadow = !movimentoRidotto;
    ufficio.add(m);
  }

  // Tappeti di zona: dicono dove finisce una zona e comincia l'altra.
  for (const [chiave, z] of Object.entries(ZONE)) {
    if (chiave === 'cervello') continue;
    const t = new THREE.Mesh(new THREE.CircleGeometry(3.1, 40), mat.tappeto);
    t.rotation.x = -Math.PI / 2;
    t.position.set(z.x, 0.006, z.z);
    ufficio.add(t);
  }

  // Divisori in vetro fra lo studio e il montaggio.
  for (const [x, z, ry, larghezza] of [[-0.2, -1.4, 0, 6.4], [4.9, -1.2, Math.PI / 2, 4.2]]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(larghezza, 1.5, 0.06), mat.vetro);
    v.position.set(x, 1.1, z); v.rotation.y = ry;
    ufficio.add(v);
    const telaio = new THREE.Mesh(new THREE.BoxGeometry(larghezza, 0.06, 0.1), mat.divisorio);
    telaio.position.set(x, 0.36, z); telaio.rotation.y = ry;
    ufficio.add(telaio);
  }

  // ── Piante e lampade, con instancing ────────────────────
  // Sono gli oggetti che si ripetono: una sola chiamata di disegno per tutte.
  const puntiPianta = [
    [-6.6, -4.4], [6.8, -4.6], [-6.8, 5.2], [6.6, 6.2], [0.2, -6.4],
    [-3.4, 6.6], [7.2, 1.6], [-7.0, 0.8],
  ];
  const vasi = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.26, 0.19, 0.42, 12), mat.vaso, puntiPianta.length);
  const fronde = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.46, 0), mat.pianta, puntiPianta.length);
  vasi.castShadow = fronde.castShadow = !movimentoRidotto;
  const m4 = new THREE.Matrix4();
  puntiPianta.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.21, z); vasi.setMatrixAt(i, m4);
    m4.compose(
      new THREE.Vector3(x, 0.78, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 0.7, 0.12)),
      new THREE.Vector3(1, 1.25, 1));
    fronde.setMatrixAt(i, m4);
    ufficio.add(ombraContatto(x, z, 1.1));
  });
  ufficio.add(vasi, fronde);

  const puntiLampada = [[-4.2, -3.0], [3.6, -5.0], [-5.0, 4.0], [4.2, 5.6]];
  const paliLampada = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.045, 0.045, 1.9, 8), mat.gambe, puntiLampada.length);
  const cappelli = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.34, 0.34, 14, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xfffaf0, side: THREE.DoubleSide }),
    puntiLampada.length);
  puntiLampada.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.95, z); paliLampada.setMatrixAt(i, m4);
    m4.makeTranslation(x, 2.02, z); cappelli.setMatrixAt(i, m4);
  });
  ufficio.add(paliLampada, cappelli);

  // Di sera le lampade si accendono davvero.
  const luciLampada = puntiLampada.map(([x, z]) => {
    const l = new THREE.PointLight(0xffe7bb, 0, 5.5, 2);
    l.position.set(x, 1.85, z);
    ufficio.add(l);
    return l;
  });

  // ── Le scrivanie e gli avatar ───────────────────────────
  const avatarPerAgente = new Map();   // agentId -> oggetto avatar
  const cliccabili = [];               // mesh che rispondono al click
  const gruppoAgenti = new THREE.Group();
  scena.add(gruppoAgenti);

  /** Un monitor con la miniatura vera del lavoro in corso. */
  function creaSchermo(larghezza = 0.84, altezza = 0.5) {
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 228;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(larghezza, altezza),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    return { mesh, canvas, tex };
  }

  /** Disegna sul monitor cosa sta facendo l'agente. */
  function disegnaSchermo(schermo, agente, lavoro, contenuto) {
    const g = schermo.canvas.getContext('2d');
    const W = schermo.canvas.width, H = schermo.canvas.height;
    g.fillStyle = '#13131f'; g.fillRect(0, 0, W, H);

    if (!lavoro) {
      g.fillStyle = '#2a2a45';
      for (let i = 0; i < 5; i++) g.fillRect(24, 40 + i * 30, 120 + i * 30, 10);
      g.fillStyle = '#4b4b6a'; g.font = '600 20px Inter, sans-serif';
      g.fillText('in pausa', 24, 196);
      schermo.tex.needsUpdate = true;
      return;
    }

    // Barra del brand
    g.fillStyle = agente.colore || '#b5ff00';
    g.fillRect(0, 0, W, 6);

    g.fillStyle = '#b5ff00';
    g.font = '700 15px Inter, sans-serif';
    g.fillText((agente.ruolo || '').toUpperCase().slice(0, 28), 22, 36);

    g.fillStyle = '#ffffff';
    g.font = '800 24px Inter, sans-serif';
    const titolo = (contenuto?.titolo || lavoro.titolo || '').slice(0, 64);
    avvolgi(g, titolo, 22, 72, W - 44, 28, 3);

    if (contenuto?.caption) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = '400 14px Inter, sans-serif';
      avvolgi(g, contenuto.caption.slice(0, 160), 22, 158, W - 44, 18, 3);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.font = '400 14px Inter, sans-serif';
      g.fillText(lavoro.attivita || 'sta lavorando', 22, 162);
    }
    schermo.tex.needsUpdate = true;
  }

  function avvolgi(g, testo, x, y, larghezza, passo, maxRighe) {
    const parole = String(testo).split(/\s+/);
    let riga = '', righe = 0;
    for (const p of parole) {
      const prova = riga ? riga + ' ' + p : p;
      if (g.measureText(prova).width > larghezza && riga) {
        g.fillText(riga, x, y + righe * passo);
        if (++righe >= maxRighe) return;
        riga = p;
      } else riga = prova;
    }
    if (riga && righe < maxRighe) g.fillText(riga, x, y + righe * passo);
  }

  /** Un avatar costruito da primitive. */
  function creaAvatar(agente, x, z, rotazione) {
    const gruppo = new THREE.Group();
    gruppo.position.set(x, 0, z);
    gruppo.rotation.y = rotazione;

    const colore = new THREE.Color(agente.colore || '#47ee74');
    const matVestito = new THREE.MeshLambertMaterial({ color: colore });
    const matPelle = new THREE.MeshLambertMaterial({ color: 0xf0c9a8 });

    // ── scrivania ──
    const piano = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.95), mat.scrivania);
    piano.position.set(0, 0.73, 0);
    piano.castShadow = piano.receiveShadow = !movimentoRidotto;
    gruppo.add(piano);
    for (const [gx, gz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) {
      const gamba = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 7), mat.gambe);
      gamba.position.set(gx, 0.36, gz);
      gruppo.add(gamba);
    }
    gruppo.add(ombraContatto(0, 0, 2.6));

    // ── monitor con la miniatura del lavoro ──
    const schermo = creaSchermo();
    schermo.mesh.position.set(0, 1.12, -0.26);
    schermo.mesh.rotation.x = -0.1;
    gruppo.add(schermo.mesh);
    const scocca = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.57, 0.04), mat.monitor);
    scocca.position.set(0, 1.12, -0.29);
    scocca.rotation.x = -0.1;
    scocca.castShadow = !movimentoRidotto;
    gruppo.add(scocca);
    const piedeMonitor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.04), mat.monitor);
    piedeMonitor.position.set(0, 0.84, -0.28);
    gruppo.add(piedeMonitor);

    // ── sedia ──
    const sedile = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.5), mat.sedia);
    sedile.position.set(0, 0.46, 0.86);
    gruppo.add(sedile);
    const spalliera = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.08), mat.sedia);
    spalliera.position.set(0, 0.76, 1.09);
    gruppo.add(spalliera);
    const perno = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), mat.gambe);
    perno.position.set(0, 0.21, 0.86);
    gruppo.add(perno);

    // ── persona ──
    const persona = new THREE.Group();
    persona.position.set(0, 0, 0.78);

    const busto = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 4, 12), matVestito);
    busto.position.y = 0.78;
    busto.castShadow = !movimentoRidotto;
    persona.add(busto);

    const testa = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), matPelle);
    testa.position.y = 1.12;
    testa.castShadow = !movimentoRidotto;
    persona.add(testa);

    const capelli = new THREE.Mesh(
      new THREE.SphereGeometry(0.166, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshLambertMaterial({ color: 0x3b3a36 }));
    capelli.position.y = 1.13;
    persona.add(capelli);

    // Le braccia hanno il perno sulla spalla, cosi' ruotano come braccia.
    function braccio(lato) {
      const perno = new THREE.Group();
      perno.position.set(0.21 * lato, 0.96, 0);
      const arto = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.3, 3, 8), matVestito);
      arto.position.y = -0.19;
      perno.add(arto);
      const mano = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), matPelle);
      mano.position.y = -0.37;
      perno.add(mano);
      perno.rotation.x = -0.9;   // avambracci verso la tastiera
      persona.add(perno);
      return perno;
    }
    const braccioSx = braccio(-1), braccioDx = braccio(1);

    // Gambe: si vedono poco da seduti, ma senza si nota.
    for (const lato of [-1, 1]) {
      const coscia = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.24, 3, 8), matVestito);
      coscia.position.set(0.1 * lato, 0.5, -0.16);
      coscia.rotation.x = Math.PI / 2;
      persona.add(coscia);
    }

    gruppo.add(persona);

    // ── anello di stato ai piedi della scrivania ──
    const anello = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.56, 28),
      new THREE.MeshBasicMaterial({ color: POSA.libero.colore, transparent: true, opacity: 0.85 }));
    anello.rotation.x = -Math.PI / 2;
    anello.position.set(0, 0.02, 0.78);
    gruppo.add(anello);

    // Il bersaglio del click e' una scatola invisibile che copre tutta la
    // postazione: cliccare la testa o la scrivania deve fare la stessa cosa.
    const bersaglioClick = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 1.6, 2.3),
      new THREE.MeshBasicMaterial({ visible: false }));
    bersaglioClick.position.set(0, 0.8, 0.3);
    bersaglioClick.userData.agentId = agente.id;
    gruppo.add(bersaglioClick);
    cliccabili.push(bersaglioClick);

    gruppoAgenti.add(gruppo);

    return {
      agente, gruppo, persona, testa, busto, braccioSx, braccioDx, anello, schermo,
      base: { x, z }, posa: 'libero', fase: Math.random() * Math.PI * 2,
    };
  }

  /** Dispone gli agenti nella loro zona, a ventaglio attorno al centro. */
  function disponiAgenti(agenti) {
    for (const a of avatarPerAgente.values()) {
      gruppoAgenti.remove(a.gruppo);
      a.gruppo.traverse(o => {
        if (o.geometry && o.geometry !== geoOmbra) o.geometry.dispose?.();
      });
    }
    avatarPerAgente.clear();
    cliccabili.length = 0;

    const perZona = new Map();
    for (const a of agenti) {
      const z = ZONE[a.zona] ? a.zona : 'studio';
      if (!perZona.has(z)) perZona.set(z, []);
      perZona.get(z).push(a);
    }

    for (const [zona, lista] of perZona) {
      const centro = ZONE[zona];
      lista.forEach((agente, i) => {
        // Se l'agente porta una posizione in tabella si rispetta: cosi' la
        // disposizione e' un dato, non una regola nel codice.
        const p = agente.posizione || {};
        let x = typeof p.x === 'number' ? p.x : null;
        let z = typeof p.z === 'number' ? p.z : null;
        if (x === null || z === null) {
          const angolo = -Math.PI / 2 + (i - (lista.length - 1) / 2) * 0.7;
          x = centro.x + Math.cos(angolo) * 1.7;
          z = centro.z + Math.sin(angolo) * 1.7;
        }
        // Guarda verso il centro della stanza.
        const rotazione = Math.atan2(-x, -z) + Math.PI;
        avatarPerAgente.set(agente.id, creaAvatar(agente, x, z, rotazione));
      });
    }
  }

  // ── Il Cervello condiviso ───────────────────────────────
  const cervello = new THREE.Group();
  cervello.position.set(ZONE.cervello.x, 0, ZONE.cervello.z);
  scena.add(cervello);

  // Piu' alto e piu' stretto della prima versione: nella vista d'insieme il
  // Cervello e' il centro della stanza e deve leggersi da lontano, non
  // sembrare un vaso.
  const piedistallo = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.68, 1.5, 22), mat.divisorio);
  piedistallo.position.y = 0.75;
  piedistallo.castShadow = piedistallo.receiveShadow = !movimentoRidotto;
  cervello.add(piedistallo);
  cervello.add(ombraContatto(0, 0, 2.0));

  // Una sfera di nodi: punti sulla sfera, uniti da segmenti brevi.
  const NODI = 74;
  const puntiNodi = [];
  for (let i = 0; i < NODI; i++) {
    // distribuzione a spirale: nodi distanziati in modo regolare
    const y = 1 - (i / (NODI - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = i * Math.PI * (3 - Math.sqrt(5));
    puntiNodi.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r).multiplyScalar(0.72));
  }
  const geoNodi = new THREE.BufferGeometry().setFromPoints(puntiNodi);
  const matNodi = new THREE.PointsMaterial({
    color: 0x0f8a3d, size: 0.13, sizeAttenuation: true,
    transparent: true, opacity: 1,
  });
  const nodi = new THREE.Points(geoNodi, matNodi);
  nodi.position.y = 2.55;
  cervello.add(nodi);

  const segmenti = [];
  for (let i = 0; i < puntiNodi.length; i++) {
    for (let j = i + 1; j < puntiNodi.length; j++) {
      if (puntiNodi[i].distanceTo(puntiNodi[j]) < 0.42) segmenti.push(puntiNodi[i], puntiNodi[j]);
    }
  }
  const fili = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(segmenti),
    new THREE.LineBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.62 }));
  fili.position.y = 2.55;
  cervello.add(fili);

  const alone = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 24, 18),
    new THREE.MeshBasicMaterial({ color: 0xa3f7ba, transparent: true, opacity: 0.14 }));
  alone.position.y = 2.55;
  cervello.add(alone);

  const luceCervello = new THREE.PointLight(0x47ee74, 1.1, 7, 2);
  luceCervello.position.y = 2.55;
  cervello.add(luceCervello);

  const bersaglioCervello = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 4.2, 2.4),
    new THREE.MeshBasicMaterial({ visible: false }));
  bersaglioCervello.position.y = 1.9;
  bersaglioCervello.userData.cervello = true;
  cervello.add(bersaglioCervello);
  cliccabili.push(bersaglioCervello);

  // Particelle: salgono quando entra una regola nuova.
  const PARTICELLE = 60;
  const posParticelle = new Float32Array(PARTICELLE * 3);
  const vitaParticelle = new Float32Array(PARTICELLE).fill(-1);
  const geoParticelle = new THREE.BufferGeometry();
  geoParticelle.setAttribute('position', new THREE.BufferAttribute(posParticelle, 3));
  const particelle = new THREE.Points(geoParticelle, new THREE.PointsMaterial({
    color: 0x16a34a, size: 0.1, transparent: true, opacity: 0.9, sizeAttenuation: true,
  }));
  particelle.position.y = 2.55;
  cervello.add(particelle);

  let pulsazioneCervello = 0;
  function pulsaCervello() {
    pulsazioneCervello = 1;
    for (let i = 0; i < PARTICELLE; i++) {
      if (vitaParticelle[i] < 0) { vitaParticelle[i] = 1; break; }
    }
  }

  // ── Linee di collaborazione ─────────────────────────────
  const gruppoLinee = new THREE.Group();
  scena.add(gruppoLinee);
  let linee = [];

  function aggiornaCollaborazioni(coppie) {
    for (const l of linee) {
      gruppoLinee.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mesh.material.dispose();
    }
    linee = [];
    for (const { da, a } of coppie) {
      const A = avatarPerAgente.get(da), B = avatarPerAgente.get(a);
      if (!A || !B) continue;
      // Un arco che sale: una linea retta fra due scrivanie passerebbe
      // attraverso i mobili.
      const p0 = new THREE.Vector3(A.base.x, 1.25, A.base.z);
      const p1 = new THREE.Vector3(B.base.x, 1.25, B.base.z);
      const mezzo = p0.clone().lerp(p1, 0.5);
      mezzo.y += Math.max(1.1, p0.distanceTo(p1) * 0.32);
      const curva = new THREE.QuadraticBezierCurve3(p0, mezzo, p1);
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curva, 36, 0.028, 7, false),
        new THREE.MeshBasicMaterial({ color: 0x2563a8, transparent: true, opacity: 0.6 }));
      gruppoLinee.add(mesh);
      linee.push({ mesh, fase: Math.random() * Math.PI * 2 });
    }
  }

  // ── Click e tocco ───────────────────────────────────────
  const raggio = new THREE.Raycaster();
  const puntatore = new THREE.Vector2();
  let trascinato = false, giuX = 0, giuY = 0;

  function coordinate(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    const t = ev.touches?.[0] ?? ev.changedTouches?.[0] ?? ev;
    return {
      x: ((t.clientX - r.left) / r.width) * 2 - 1,
      y: -((t.clientY - r.top) / r.height) * 2 + 1,
      cx: t.clientX, cy: t.clientY,
    };
  }

  function colpito(ev) {
    const c = coordinate(ev);
    puntatore.set(c.x, c.y);
    raggio.setFromCamera(puntatore, camera);
    return raggio.intersectObjects(cliccabili, false)[0]?.object ?? null;
  }

  function premuto(ev) {
    const c = coordinate(ev);
    giuX = c.cx; giuY = c.cy; trascinato = false;
  }

  function rilasciato(ev) {
    if (trascinato) return;
    const o = colpito(ev);
    if (!o) return;
    if (o.userData.cervello) {
      inquadra(new THREE.Vector3(ZONE.cervello.x, 2.0, ZONE.cervello.z), 13);
      onClickCervello();
    } else if (o.userData.agentId) {
      const a = avatarPerAgente.get(o.userData.agentId);
      if (a) inquadra(new THREE.Vector3(a.base.x, 1.0, a.base.z), 13);
      onClickAgente(o.userData.agentId);
    }
  }

  // ── Orbita limitata, zoom, spostamento ──────────────────
  // L'ascolto di mouseup sta su window, non sulla tela, perche' il
  // trascinamento deve finire anche se il puntatore e' uscito dalla scena.
  // Questo pero' vuol dire che ogni rilascio del tasto nella pagina passa da
  // qui: senza ricordare se la pressione era cominciata sulla tela, un click
  // su una scheda in cima alla pagina veniva proiettato nella scena e apriva
  // il pannello di un agente, perche' per caso cadeva sopra una scrivania.
  // Lo ha trovato la prova nel browser: il velo del pannello restava aperto
  // e bloccava tutti i click successivi.
  let premutoSuTela = false;
  let trascina = null;
  const LIMITI = { thetaMin: -0.35, thetaMax: Math.PI * 0.9, phiMin: 0.22, phiMax: 1.12,
                   raggioMin: 9, raggioMax: 38 };

  function giuMouse(ev) {
    premuto(ev);
    premutoSuTela = true;
    const c = coordinate(ev);
    trascina = { x: c.cx, y: c.cy, pan: ev.shiftKey || ev.button === 1 };
  }
  function muovi(ev) {
    if (!trascina) return;
    const c = coordinate(ev);
    const dx = c.cx - trascina.x, dy = c.cy - trascina.y;
    if (Math.abs(c.cx - giuX) + Math.abs(c.cy - giuY) > 6) trascinato = true;
    if (trascina.pan) {
      // Lo spostamento resta sul piano del pavimento.
      const avanti = new THREE.Vector3().subVectors(bersaglio, camera.position).setY(0).normalize();
      const destra = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), avanti).normalize();
      const scala = orbita.raggio * 0.0016;
      bersaglio.addScaledVector(destra, -dx * scala).addScaledVector(avanti, -dy * scala);
      bersaglio.x = THREE.MathUtils.clamp(bersaglio.x, -9, 9);
      bersaglio.z = THREE.MathUtils.clamp(bersaglio.z, -9, 9);
    } else {
      orbita.theta = THREE.MathUtils.clamp(orbita.theta - dx * 0.005, LIMITI.thetaMin, LIMITI.thetaMax);
      orbita.phi   = THREE.MathUtils.clamp(orbita.phi   - dy * 0.004, LIMITI.phiMin,  LIMITI.phiMax);
    }
    trascina.x = c.cx; trascina.y = c.cy;
    piazzaCamera();
  }
  function su(ev) {
    if (premutoSuTela) rilasciato(ev);
    premutoSuTela = false;
    trascina = null;
  }

  function rotella(ev) {
    ev.preventDefault();
    orbita.raggio = THREE.MathUtils.clamp(
      orbita.raggio * (1 + Math.sign(ev.deltaY) * 0.09), LIMITI.raggioMin, LIMITI.raggioMax);
    piazzaCamera();
  }

  // Due dita: pizzico per lo zoom, trascinamento per l'orbita.
  let pizzico = null;
  function tocchiGiu(ev) {
    if (ev.touches.length === 2) {
      pizzico = distanza(ev.touches);
      trascina = null;
      premutoSuTela = false;   // due dita sono un gesto, non un click
    } else { giuMouse(ev); }
  }
  function tocchiMuovi(ev) {
    if (ev.touches.length === 2 && pizzico) {
      ev.preventDefault();
      const d = distanza(ev.touches);
      orbita.raggio = THREE.MathUtils.clamp(
        orbita.raggio * (pizzico / d), LIMITI.raggioMin, LIMITI.raggioMax);
      pizzico = d;
      trascinato = true;
      piazzaCamera();
    } else if (ev.touches.length === 1) {
      ev.preventDefault();
      muovi(ev);
    }
  }
  function tocchiSu(ev) {
    if (!ev.touches.length) { pizzico = null; su(ev); }
  }
  function distanza(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  const el = renderer.domElement;
  el.addEventListener('mousedown', giuMouse);
  window.addEventListener('mousemove', muovi);
  window.addEventListener('mouseup', su);
  el.addEventListener('wheel', rotella, { passive: false });
  el.addEventListener('touchstart', tocchiGiu, { passive: false });
  el.addEventListener('touchmove', tocchiMuovi, { passive: false });
  el.addEventListener('touchend', tocchiSu);

  /** Sposta la camera verso un punto, con un'animazione breve. */
  let inquadratura = null;
  function inquadra(punto, raggioFinale) {
    if (movimentoRidotto) {
      bersaglio.copy(punto); orbita.raggio = raggioFinale; piazzaCamera(); return;
    }
    inquadratura = {
      da: bersaglio.clone(), a: punto.clone(),
      raggioDa: orbita.raggio, raggioA: raggioFinale,
      t: 0,
    };
  }

  function torna() {
    inquadra(new THREE.Vector3(0, 0.6, 0.4), orbitaRiposo.raggio);
    orbita.theta = orbitaRiposo.theta;
    orbita.phi = orbitaRiposo.phi;
  }

  // ── Fumetti HTML sopra la testa ─────────────────────────
  // Il livello dei fumetti e' HTML vero, posizionato proiettando la testa
  // dell'avatar sullo schermo.
  const livello = document.createElement('div');
  livello.className = 'regia-fumetti';
  contenitore.appendChild(livello);
  const fumetti = new Map();

  function fumettoDi(agentId) {
    if (fumetti.has(agentId)) return fumetti.get(agentId);
    const el = document.createElement('div');
    el.className = 'regia-fumetto';
    livello.appendChild(el);
    const f = { el, visibile: false };
    fumetti.set(agentId, f);
    return f;
  }

  /**
   * Aggiorna cosa dicono i fumetti.
   * @param {Array} voci [{agentId, nome, testo, azione, onAzione, urgente}]
   */
  function aggiornaFumetti(voci) {
    const visti = new Set();
    for (const v of voci) {
      visti.add(v.agentId);
      const f = fumettoDi(v.agentId);
      if (f.testo !== v.testo || f.azione !== v.azione || f.nome !== v.nome) {
        f.testo = v.testo; f.azione = v.azione; f.nome = v.nome;
        f.el.innerHTML = '';
        const nome = document.createElement('div');
        nome.className = 'rf-nome';
        nome.textContent = v.nome;
        const testo = document.createElement('div');
        testo.className = 'rf-testo';
        testo.textContent = v.testo;
        f.el.append(nome, testo);
        if (v.azione) {
          const b = document.createElement('button');
          b.className = 'rf-azione';
          b.type = 'button';
          b.textContent = v.azione;
          b.addEventListener('click', (ev) => { ev.stopPropagation(); v.onAzione?.(); });
          f.el.appendChild(b);
        }
      }
      f.el.classList.toggle('urgente', !!v.urgente);
      f.visibile = true;
    }
    for (const [id, f] of fumetti) {
      if (!visti.has(id)) { f.el.remove(); fumetti.delete(id); }
    }
  }

  const vettore = new THREE.Vector3();
  function posizionaFumetti() {
    const r = renderer.domElement.getBoundingClientRect();

    // Si calcolano prima tutte le posizioni, poi si sistemano le
    // sovrapposizioni: tre agenti vicini nella stessa zona avevano i fumetti
    // uno sull'altro e si leggeva solo l'ultimo.
    const piazzati = [];
    for (const [id, f] of fumetti) {
      const a = avatarPerAgente.get(id);
      if (!a || !a.gruppo.visible) { f.el.style.display = 'none'; continue; }
      a.testa.getWorldPosition(vettore);
      vettore.y += 0.42;
      vettore.project(camera);
      if (vettore.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      piazzati.push({
        f,
        x: (vettore.x * 0.5 + 0.5) * r.width,
        y: (-vettore.y * 0.5 + 0.5) * r.height,
        z: vettore.z,
        h: f.el.offsetHeight || 64,
        w: f.el.offsetWidth || 180,
      });
    }

    // Dal piu' vicino al piu' lontano: chi sta davanti tiene il suo posto e
    // chi sta dietro sale quel tanto che basta per restare leggibile.
    piazzati.sort((p, q) => p.z - q.z);
    for (let i = 0; i < piazzati.length; i++) {
      const p = piazzati[i];
      for (let j = 0; j < i; j++) {
        const q = piazzati[j];
        const vicinoX = Math.abs(p.x - q.x) < (p.w + q.w) / 2 - 12;
        const sopra = q.y - q.h - 8;          // bordo alto del fumetto gia' messo
        if (vicinoX && p.y > sopra && p.y - p.h < q.y) {
          p.y = sopra;                        // lo si alza sopra l'altro
        }
      }
      // Non deve uscire dall'inquadratura in alto.
      p.y = Math.max(p.h + 6, p.y);
      p.f.el.style.transform =
        `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      // Piu' lontano, piu' piccolo.
      const scala = THREE.MathUtils.clamp(1.15 - orbita.raggio / 60, 0.62, 1);
      p.f.el.style.setProperty('--scala', scala.toFixed(2));
      p.f.el.style.zIndex = String(1000 - Math.round(p.z * 500));
    }
  }

  // ── Stato degli avatar ──────────────────────────────────
  function aggiornaStato(agenti, datiPerAgente) {
    for (const [id, a] of avatarPerAgente) {
      const d = datiPerAgente.get(id) || {};
      a.posa = d.posa || 'libero';
      const p = POSA[a.posa] || POSA.libero;
      a.anello.material.color.setHex(p.colore);
      disegnaSchermo(a.schermo, a.agente, d.lavoro, d.contenuto);
    }
  }

  // ── Il ciclo ────────────────────────────────────────────
  let orologio = new THREE.Clock();
  let attivo = true;
  let ultimaLuce = 0;
  let fotogrammi = 0, ultimoControllo = performance.now(), dprCorrente = dprMax;

  function ridimensiona() {
    const w = contenitore.clientWidth || 1;
    const h = contenitore.clientHeight || 1;
    // setSize con updateStyle a false lascia alla tela la sola misura del
    // buffer: con un rapporto di pixel di 2 il canvas veniva disposto al
    // doppio della sua area e la scena finiva tagliata. Lo si lascia fare a
    // Three, che imposta anche la misura in CSS.
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  ridimensiona();
  const osservatore = new ResizeObserver(ridimensiona);
  osservatore.observe(contenitore);

  function ciclo() {
    if (!attivo) return;
    requestAnimationFrame(ciclo);
    const dt = Math.min(orologio.getDelta(), 0.1);
    const t = orologio.elapsedTime;

    // La luce di Dubai si ricalcola ogni mezzo minuto, non ogni fotogramma.
    if (t - ultimaLuce > 30) { condizioniLuce = aggiornaLuce(); ultimaLuce = t; }
    const accese = condizioniLuce.sera ? 0.9 : 0;
    for (const l of luciLampada) l.intensity += (accese - l.intensity) * dt * 2;

    if (!movimentoRidotto) {
      // ── animazioni degli avatar ──
      for (const a of avatarPerAgente.values()) {
        a.fase += dt;
        const respiro = Math.sin(a.fase * 1.6) * 0.012;
        a.busto.position.y = 0.78 + respiro;
        a.testa.position.y = 1.12 + respiro;

        if (a.posa === 'lavora') {
          // digita: le mani si alternano sulla tastiera
          const v = a.fase * 11;
          a.braccioSx.rotation.x = -0.9 + Math.sin(v) * 0.11;
          a.braccioDx.rotation.x = -0.9 + Math.sin(v + 1.9) * 0.11;
          a.testa.rotation.x = 0.16;
          a.persona.rotation.z = 0;
        } else if (a.posa === 'mano_alzata') {
          // alza la mano e la tiene su, con un'oscillazione appena percepibile
          a.braccioDx.rotation.x = -2.55 + Math.sin(a.fase * 2.4) * 0.13;
          a.braccioSx.rotation.x = -0.75;
          a.testa.rotation.x = -0.09;
          a.persona.rotation.z = Math.sin(a.fase * 1.2) * 0.02;
        } else if (a.posa === 'attende') {
          // guarda lo schermo, immobile, un piede che si muove
          a.braccioSx.rotation.x = -0.72;
          a.braccioDx.rotation.x = -0.72 + Math.sin(a.fase * 2.8) * 0.05;
          a.testa.rotation.x = 0.1;
        } else {
          // in pausa: si allontana dalla scrivania e si guarda intorno
          a.braccioSx.rotation.x = -0.25;
          a.braccioDx.rotation.x = -0.25;
          a.testa.rotation.y = Math.sin(a.fase * 0.5) * 0.4;
          a.testa.rotation.x = 0;
          a.persona.position.z = 0.78 + Math.sin(a.fase * 0.4) * 0.06;
        }
        if (a.posa !== 'libero') {
          a.testa.rotation.y *= 0.9;
          a.persona.position.z += (0.78 - a.persona.position.z) * dt * 3;
        }
      }

      // ── il Cervello pulsa ──
      const base = 1 + Math.sin(t * 1.25) * 0.035;
      const spinta = 1 + pulsazioneCervello * 0.3;
      nodi.scale.setScalar(base * spinta);
      fili.scale.setScalar(base * spinta);
      alone.scale.setScalar(base * spinta * 1.02);
      nodi.rotation.y = t * 0.16;
      fili.rotation.y = t * 0.16;
      luceCervello.intensity = 0.65 + Math.sin(t * 1.25) * 0.12 + pulsazioneCervello * 1.4;
      alone.material.opacity = 0.1 + pulsazioneCervello * 0.2;
      pulsazioneCervello = Math.max(0, pulsazioneCervello - dt * 0.8);

      // ── particelle ──
      let qualcunaViva = false;
      for (let i = 0; i < PARTICELLE; i++) {
        if (vitaParticelle[i] < 0) continue;
        qualcunaViva = true;
        if (vitaParticelle[i] === 1) {
          const dir = puntiNodi[(i * 7) % puntiNodi.length];
          posParticelle[i * 3]     = dir.x * 0.85;
          posParticelle[i * 3 + 1] = dir.y * 0.85;
          posParticelle[i * 3 + 2] = dir.z * 0.85;
        }
        posParticelle[i * 3 + 1] += dt * 1.5;
        vitaParticelle[i] -= dt * 0.55;
        if (vitaParticelle[i] <= 0) {
          vitaParticelle[i] = -1;
          posParticelle[i * 3 + 1] = -99;
        }
      }
      if (qualcunaViva) geoParticelle.attributes.position.needsUpdate = true;
      particelle.material.opacity = 0.9;

      // ── linee di collaborazione: l'impulso scorre ──
      for (const l of linee) {
        l.fase += dt * 2.2;
        l.mesh.material.opacity = 0.35 + (Math.sin(l.fase) * 0.5 + 0.5) * 0.45;
      }
    }

    // ── inquadratura ──
    if (inquadratura) {
      inquadratura.t = Math.min(1, inquadratura.t + dt * 2.2);
      // accelera e poi frena
      const e = inquadratura.t < 0.5
        ? 2 * inquadratura.t * inquadratura.t
        : 1 - Math.pow(-2 * inquadratura.t + 2, 2) / 2;
      bersaglio.lerpVectors(inquadratura.da, inquadratura.a, e);
      orbita.raggio = inquadratura.raggioDa + (inquadratura.raggioA - inquadratura.raggioDa) * e;
      piazzaCamera();
      if (inquadratura.t >= 1) inquadratura = null;
    }

    posizionaFumetti();
    renderer.render(scena, camera);

    // ── risoluzione adattiva ──
    // Se la scena non tiene il passo si abbassa il rapporto di pixel invece
    // di far muovere tutto a scatti.
    fotogrammi++;
    const adesso = performance.now();
    if (adesso - ultimoControllo > 2000) {
      const fps = fotogrammi * 1000 / (adesso - ultimoControllo);
      fotogrammi = 0; ultimoControllo = adesso;
      if (fps < 32 && dprCorrente > 0.75) {
        dprCorrente = Math.max(0.75, dprCorrente - 0.25);
        renderer.setPixelRatio(dprCorrente);
      } else if (fps > 55 && dprCorrente < dprMax) {
        dprCorrente = Math.min(dprMax, dprCorrente + 0.25);
        renderer.setPixelRatio(dprCorrente);
      }
    }
  }
  requestAnimationFrame(ciclo);

  // ── Fine ────────────────────────────────────────────────
  function distruggi() {
    attivo = false;
    osservatore.disconnect();
    el.removeEventListener('mousedown', giuMouse);
    window.removeEventListener('mousemove', muovi);
    window.removeEventListener('mouseup', su);
    el.removeEventListener('wheel', rotella);
    el.removeEventListener('touchstart', tocchiGiu);
    el.removeEventListener('touchmove', tocchiMuovi);
    el.removeEventListener('touchend', tocchiSu);
    livello.remove();
    scena.traverse(o => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
      else o.material?.dispose?.();
    });
    renderer.dispose();
    el.remove();
  }

  /** Nasconde le zone che il filtro esclude. */
  function filtraZona(zona) {
    for (const a of avatarPerAgente.values()) {
      a.gruppo.visible = !zona || zona === 'tutto' || a.agente.zona === zona;
    }
    if (zona && zona !== 'tutto' && ZONE[zona]) {
      inquadra(new THREE.Vector3(ZONE[zona].x, 0.8, ZONE[zona].z), 16);
    } else if (!zona || zona === 'tutto') {
      torna();
    }
  }

  return {
    disponiAgenti, aggiornaStato, aggiornaCollaborazioni, aggiornaFumetti,
    pulsaCervello, inquadra, torna, filtraZona, distruggi,
    inquadraAgente: (id) => {
      const a = avatarPerAgente.get(id);
      if (a) inquadra(new THREE.Vector3(a.base.x, 1.0, a.base.z), 13);
    },
    zone: ZONE,
  };
}
