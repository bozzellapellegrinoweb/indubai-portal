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
  // Spento non e' "libero": libero vuol dire che puo' partire da un momento
  // all'altro, spento vuol dire che non partira' finche' non lo riaccendi.
  spento:      { colore: 0x4b5563, etichetta: 'spento' },
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
  /** Dove torna il tasto "casa": lo decide l'inquadratura, non una costante. */
  const riposoBersaglio = new THREE.Vector3(0, 0.6, 0.4);

  /**
   * L'area da inquadrare: dove stanno gli agenti, non la pianta delle zone.
   *
   * Le zone coprono tutto il pavimento, ma gli agenti occupano una parte
   * molto piu' piccola, e la posizione se la portano in tabella. Inquadrare
   * la pianta vorrebbe dire allontanarsi fino a prendere la nebbia, che
   * comincia a 22 unita'.
   *
   * Si ricalcola quando gli agenti vengono disposti, cosi' segue anche chi
   * li sposta.
   */
  let AREA = { x: 0.2, z: 0.4, mezzaX: 4.4, mezzaZ: 4.4, alto: 2.2 };

  function angoliArea() {
    const a = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, AREA.alto]) {
      a.push(new THREE.Vector3(AREA.x + sx * AREA.mezzaX, y, AREA.z + sz * AREA.mezzaZ));
    }
    return a;
  }

  /** Vero appena il manager tocca lo zoom: da li' in poi decide lui. */
  let zoomManuale = false;

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

  /**
   * Da quanto lontano guardare perche' la stanza riempia il riquadro.
   *
   * Il raggio era fisso a 26, qualunque fosse la forma del riquadro. Su uno
   * largo e basso - cioe' quello che si ha davvero, perche' sopra la scena
   * ci sono intestazione, linguette e "tocca a te" - la stanza occupava un
   * terzo della larghezza e il resto era pavimento vuoto: la scena c'era ma
   * era inguardabile.
   *
   * Qui si proiettano gli angoli dell'area di lavoro e si cerca il raggio
   * che li porta appena dentro i bordi. Due passate bastano: a campo visivo
   * stretto la grandezza sullo schermo e' quasi esattamente inversa alla
   * distanza.
   */
  function raggioCheInquadra(margine = 0.95) {
    const salva = orbita.raggio;
    let r = salva;
    for (let giro = 0; giro < 3; giro++) {
      orbita.raggio = r;
      piazzaCamera();
      camera.updateMatrixWorld();
      let piuLontano = 0;
      for (const punto of angoliArea()) {
        const q = punto.clone().project(camera);
        piuLontano = Math.max(piuLontano, Math.abs(q.x), Math.abs(q.y));
      }
      if (!isFinite(piuLontano) || piuLontano <= 0) break;
      r = THREE.MathUtils.clamp(r * (piuLontano / margine),
                                LIMITI.raggioMin, LIMITI.raggioMax);
    }
    orbita.raggio = salva;
    piazzaCamera();
    return r;
  }

  /**
   * Sposta il bersaglio finche' la stanza sta in mezzo allo schermo.
   *
   * Inquadrare il centro dell'area non basta: la vista e' obliqua, quindi
   * il centro del mondo e il centro dell'immagine non coincidono, e la
   * stanza finiva spostata a destra con mezzo riquadro di pavimento vuoto a
   * sinistra.
   *
   * Si misura dove cade l'ingombro sullo schermo e si sposta il bersaglio a
   * terra: di lato lungo la destra della camera, in profondita' lungo la
   * direzione dello sguardo, che sullo schermo sale di quanto dice
   * l'inclinazione.
   */
  function centraInquadratura() {
    camera.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const punto of angoliArea()) {
      const q = punto.clone().project(camera);
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (!isFinite(cx) || !isFinite(cy)) return;

    const mezzaAltezza = Math.tan(camera.fov * Math.PI / 360) * orbita.raggio;
    const destra = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0);
    if (destra.lengthSq() < 1e-6) return;
    destra.normalize();
    const avanti = new THREE.Vector3().subVectors(bersaglio, camera.position).setY(0);
    if (avanti.lengthSq() < 1e-6) return;
    avanti.normalize();
    // Quanto di uno spostamento a terra si vede come movimento verticale.
    const salita = Math.max(0.25, Math.cos(orbita.phi + Math.PI / 2) * -1);

    bersaglio.addScaledVector(destra, cx * mezzaAltezza * camera.aspect);
    bersaglio.addScaledVector(avanti, (cy * mezzaAltezza) / salita);
    piazzaCamera();
  }

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

  /**
   * La luce segue l'ora di Dubai, ma l'ufficio resta sempre leggibile.
   *
   * La prima versione abbassava tutto la sera: alle due di notte la stanza
   * diventava una poltiglia grigia in cui non si distingueva un agente da
   * una pianta. Un ufficio di sera non e' buio, e' illuminato dall'interno.
   * Quindi di sera cala la luce che viene da fuori e salgono le lampade,
   * con un bianco caldo: cambia l'atmosfera, non la leggibilita'.
   */
  function aggiornaLuce() {
    const fmt = new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Asia/Dubai', hour: 'numeric', minute: 'numeric', hour12: false,
    });
    const parti = Object.fromEntries(fmt.formatToParts(new Date())
      .filter(x => x.type === 'hour' || x.type === 'minute')
      .map(x => [x.type, Number(x.value)]));
    const ora = (parti.hour % 24) + (parti.minute || 0) / 60;

    // quanto e' "giorno": 0 di notte piena, 1 a mezzogiorno
    const giorno = Math.max(0, Math.min(1,
      ora < 5.5 || ora > 19.5 ? 0 : Math.sin(Math.PI * (ora - 5.5) / 14)));
    const sera = giorno < 0.18;

    // Il sole gira e si abbassa, ma non si spegne del tutto: resta una
    // luce direzionale tenue che tiene le ombre e il volume.
    sole.position.set(
      Math.cos(Math.PI * Math.max(0.08, giorno)) * 10,
      3 + giorno * 11,
      5 - giorno * 2,
    );
    sole.intensity = 0.42 + giorno * 1.05;
    sole.color.setHex(sera ? 0xffd9b0 : (giorno < 0.35 ? 0xffe8c8 : 0xfff6e8));

    // L'ambiente non scende mai sotto una soglia: e' quello che tiene
    // leggibili i volti e i colori delle maglie.
    ambiente.intensity = 0.82 + giorno * 0.25;
    ambiente.color.setHex(sera ? 0xfff3e2 : 0xffffff);
    ambiente.groundColor.setHex(sera ? 0xd8cfc0 : 0xd8d2c4);

    riempimento.intensity = sera ? 0.18 : 0.35;
    riempimento.color.setHex(sera ? 0xffe0bb : 0xdce6ff);

    // Lo sfondo di sera e' caldo e appena piu' scuro, non grigio freddo.
    const sfondo = sera ? 0xf0e9df : 0xf7f6f2;
    renderer.setClearColor(sfondo, 1);
    scena.fog.color.setHex(sfondo);
    renderer.toneMappingExposure = sera ? 1.12 : 1.05;

    return { sera, ora, giorno };
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

  /** Il monitor di un agente spento: nero, con una riga sola. */
  function schermoSpento(schermo) {
    const g = schermo.canvas.getContext('2d');
    const W = schermo.canvas.width, H = schermo.canvas.height;
    g.fillStyle = '#0a0a0f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3a3a4a'; g.font = '700 22px Inter, sans-serif';
    g.fillText('spento', 24, H / 2 + 8);
    schermo.tex.needsUpdate = true;
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

  // ── Le persone ──────────────────────────────────────────
  // Costruite da primitive, ma non "una capsula e una palla": la prima
  // versione non aveva collo, spalle ne' faccia, e le braccia partivano
  // dritte di lato come stecchi. Da vicino sembravano orsetti gommosi.
  //
  // Quello che le rende leggibili e' poco e preciso: un collo, le spalle
  // piu' larghe dei fianchi, gli occhi, e soprattutto le mani appoggiate
  // sulla scrivania invece che per aria.

  const PELLI   = [0xf2cdab, 0xe8bb94, 0xd9a57c, 0xc08a5e, 0x8d5a3b, 0x6b4229];
  const CAPELLI = [0x2b2622, 0x4a342a, 0x6b4a2f, 0x9a7340, 0xc9a227, 0xb0b0b0, 0x1c1a19];
  const ACCONCIATURE = ['corti', 'caschetto', 'chignon', 'rasati'];

  /** Numero stabile ricavato dallo slug: lo stesso agente e' sempre uguale. */
  function impronta(testo) {
    let h = 0;
    for (let i = 0; i < testo.length; i++) h = (h * 31 + testo.charCodeAt(i)) >>> 0;
    return h;
  }

  /**
   * L'aspetto si prende dalla colonna avatar di smm_agents, se c'e'.
   * Altrimenti si ricava dallo slug: cosi' otto agenti non sono otto cloni,
   * e chi ne aggiunge uno dall'interfaccia non deve scegliere niente.
   */
  function aspettoDi(agente) {
    const a = agente.avatar || {};
    const h = impronta(agente.slug || agente.nome || 'x');
    return {
      pelle:   a.pelle   ?? PELLI[h % PELLI.length],
      capelli: a.capelli ?? CAPELLI[(h >> 3) % CAPELLI.length],
      taglio:  a.taglio  ?? ACCONCIATURE[(h >> 6) % ACCONCIATURE.length],
      // la camicia e' il colore dell'agente, schiarito: resta riconoscibile
      // ma non fa a pugni con l'anello di stato
      maglia:  a.maglia  ?? null,
    };
  }

  /** Un avatar costruito da primitive. */
  function creaAvatar(agente, x, z, rotazione) {
    const gruppo = new THREE.Group();
    gruppo.position.set(x, 0, z);
    gruppo.rotation.y = rotazione;

    const look = aspettoDi(agente);
    const base = new THREE.Color(agente.colore || '#47ee74');
    const maglia = look.maglia
      ? new THREE.Color(look.maglia)
      : base.clone().lerp(new THREE.Color(0xffffff), 0.18);
    const pantaloni = base.clone().lerp(new THREE.Color(0x14161a), 0.62);

    const matMaglia    = new THREE.MeshLambertMaterial({ color: maglia });
    const matPantaloni = new THREE.MeshLambertMaterial({ color: pantaloni });
    const matPelle     = new THREE.MeshLambertMaterial({ color: look.pelle });
    const matCapelli   = new THREE.MeshLambertMaterial({ color: look.capelli });
    const matOcchi     = new THREE.MeshBasicMaterial({ color: 0x1b1a18 });

    // ── scrivania ──
    const piano = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.95), mat.scrivania);
    piano.position.set(0, 0.76, 0);
    piano.castShadow = piano.receiveShadow = !movimentoRidotto;
    gruppo.add(piano);
    // Un bordo piu' scuro sul davanti: senza, il piano sparisce contro il
    // pavimento quando la luce e' piatta.
    const bordo = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.035, 0.03), mat.gambe);
    bordo.position.set(0, 0.742, 0.474);
    gruppo.add(bordo);
    for (const [gx, gz] of [[-0.88, -0.4], [0.88, -0.4], [-0.88, 0.4], [0.88, 0.4]]) {
      const gamba = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.73, 7), mat.gambe);
      gamba.position.set(gx, 0.37, gz);
      gruppo.add(gamba);
    }
    gruppo.add(ombraContatto(0, 0.1, 2.7));

    // ── monitor ──
    // Misure tarate guardando gli screenshot: con lo schermo piu' grande e
    // piu' vicino alla sedia copriva la persona e sembrava un televisore
    // appoggiato sul tavolo.
    // Il monitor sta di lato, non davanti al petto. Al centro copriva il
    // busto della persona e la scena diventava una fila di televisori con
    // una testa che spunta. Spostato e ruotato verso di lei, si vedono tutti
    // e due: la persona e quello che sta facendo.
    const latoMonitor = (impronta(agente.slug || agente.nome || 'x') % 2) ? 1 : -1;
    const mx = 0.47 * latoMonitor;
    const schermo = creaSchermo(0.62, 0.36);
    schermo.mesh.position.set(mx, 1.03, -0.14);
    schermo.mesh.rotation.set(-0.06, -0.38 * latoMonitor, 0);
    gruppo.add(schermo.mesh);
    const scocca = new THREE.Mesh(new THREE.BoxGeometry(0.67, 0.41, 0.028), mat.monitor);
    scocca.position.set(mx + 0.01 * latoMonitor, 1.03, -0.155);
    scocca.rotation.set(-0.06, -0.38 * latoMonitor, 0);
    scocca.castShadow = !movimentoRidotto;
    gruppo.add(scocca);
    const collo = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.025), mat.monitor);
    collo.position.set(mx, 0.855, -0.16);
    gruppo.add(collo);
    const piede = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.014, 0.13), mat.monitor);
    piede.position.set(mx, 0.787, -0.16);
    piede.rotation.y = -0.38 * latoMonitor;
    gruppo.add(piede);

    // tastiera: da' alle mani un posto dove stare
    const tastiera = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.015, 0.16), mat.gambe);
    tastiera.position.set(0, 0.8, 0.12);
    tastiera.rotation.x = -0.03;
    gruppo.add(tastiera);

    // ── sedia ──
    const sedia = new THREE.Group();
    sedia.position.set(0, 0, 0.84);
    const sedile = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.44), mat.sedia);
    sedile.position.y = 0.44;
    sedile.castShadow = !movimentoRidotto;
    sedia.add(sedile);
    const spalliera = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.07), mat.sedia);
    spalliera.position.set(0, 0.72, 0.21);
    spalliera.rotation.x = 0.1;
    sedia.add(spalliera);
    for (const lato of [-1, 1]) {
      const bracciolo = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), mat.sedia);
      bracciolo.position.set(0.25 * lato, 0.6, 0.02);
      sedia.add(bracciolo);
      const sostegno = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), mat.sedia);
      sostegno.position.set(0.25 * lato, 0.52, 0.12);
      sedia.add(sostegno);
    }
    const perno = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), mat.gambe);
    perno.position.y = 0.25;
    sedia.add(perno);
    // base a cinque razze
    for (let i = 0; i < 5; i++) {
      const razza = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.26), mat.gambe);
      razza.position.set(Math.sin(i * 1.2566) * 0.11, 0.1, Math.cos(i * 1.2566) * 0.11);
      razza.rotation.y = i * 1.2566;
      sedia.add(razza);
    }
    gruppo.add(sedia);

    // ── la persona ──
    // Seduta: il bacino sta sul sedile, il busto si inclina appena in avanti.
    const persona = new THREE.Group();
    persona.position.set(0, 0, 0.8);

    const bacino = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.26), matPantaloni);
    bacino.position.y = 0.54;
    persona.add(bacino);

    // Il busto e' un tronco di cono a otto lati: spalle piu' larghe dei
    // fianchi, che e' cio' che fa leggere una figura come una persona.
    const busto = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.155, 0.4, 8), matMaglia);
    busto.position.set(0, 0.79, -0.015);
    busto.rotation.x = -0.1;
    busto.castShadow = !movimentoRidotto;
    persona.add(busto);

    // spalle: due sfere schiacciate, cosi' le braccia non spuntano dal nulla
    for (const lato of [-1, 1]) {
      const spalla = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), matMaglia);
      spalla.position.set(0.185 * lato, 0.95, -0.03);
      spalla.scale.set(1, 0.85, 1);
      persona.add(spalla);
    }

    const colloPersona = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 10), matPelle);
    colloPersona.position.set(0, 1.0, -0.035);
    persona.add(colloPersona);

    // ── testa ──
    const testa = new THREE.Group();
    testa.position.set(0, 1.07, -0.045);

    const cranio = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 16), matPelle);
    cranio.scale.set(1, 1.08, 0.96);
    cranio.castShadow = !movimentoRidotto;
    testa.add(cranio);

    // La persona guarda verso -Z: gli occhi stanno di la'.
    for (const lato of [-1, 1]) {
      const occhio = new THREE.Mesh(new THREE.SphereGeometry(0.023, 10, 8), matOcchi);
      occhio.position.set(0.054 * lato, 0.02, -0.116);
      testa.add(occhio);
      // sopracciglio: un trattino sottile, ma cambia tutto
      const sopracciglio = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.011, 0.012), matCapelli);
      sopracciglio.position.set(0.052 * lato, 0.062, -0.116);
      testa.add(sopracciglio);
    }
    const naso = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), matPelle);
    naso.position.set(0, -0.012, -0.129);
    naso.scale.set(0.8, 1, 1.1);
    testa.add(naso);

    // ── capelli ──
    if (look.taglio !== 'rasati') {
      const calotta = new THREE.Mesh(
        new THREE.SphereGeometry(0.142, 20, 14, 0, Math.PI * 2, 0,
          look.taglio === 'caschetto' ? Math.PI * 0.72 : Math.PI * 0.55),
        matCapelli);
      calotta.position.y = 0.012;
      calotta.scale.set(1, 1.04, 0.99);
      testa.add(calotta);
      if (look.taglio === 'chignon') {
        const nodo = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), matCapelli);
        nodo.position.set(0, 0.06, 0.125);
        testa.add(nodo);
      }
    } else {
      // Rasato, non pelato: una calotta bassissima nel colore dei capelli.
      // Con una sfera semitrasparente sembrava un casco grigio.
      const rasatura = new THREE.Mesh(
        new THREE.SphereGeometry(0.139, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46),
        matCapelli);
      rasatura.position.y = 0.01;
      rasatura.scale.set(1, 0.92, 1);
      testa.add(rasatura);
    }
    persona.add(testa);

    /**
     * Un braccio in due pezzi, con il gomito.
     * La mano finisce sulla tastiera, non per aria: e' la differenza fra
     * "una persona che lavora" e "un pupazzo con due stecchi".
     */
    function braccio(lato) {
      const spalla = new THREE.Group();
      spalla.position.set(0.185 * lato, 0.94, -0.03);

      const omero = new THREE.Mesh(new THREE.CapsuleGeometry(0.047, 0.19, 3, 8), matMaglia);
      omero.position.y = -0.12;
      spalla.add(omero);

      const gomito = new THREE.Group();
      gomito.position.y = -0.24;
      spalla.add(gomito);

      const avambraccio = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.17, 3, 8), matPelle);
      avambraccio.position.y = -0.11;
      gomito.add(avambraccio);

      const mano = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), matPelle);
      mano.position.y = -0.215;
      mano.scale.set(1, 0.72, 1.25);
      gomito.add(mano);

      // riposo: braccio in giu' e avambraccio in avanti verso la tastiera
      spalla.rotation.set(-0.42, 0, 0.12 * lato);
      gomito.rotation.x = -0.95;
      persona.add(spalla);
      return { spalla, gomito };
    }
    const braccioSx = braccio(-1), braccioDx = braccio(1);

    /**
     * Una gamba con l'anca e il ginocchio.
     *
     * Erano tre pezzi incollati nella posa da seduto: cosce orizzontali
     * sotto la scrivania, polpacci in giu', scarpe. Andava bene finche'
     * nessuno si alzava. Adesso sono snodate come le braccia, e la posa da
     * seduto e' semplicemente la loro rotazione di riposo: in piedi
     * l'anca torna a zero e la gamba si distende.
     */
    const matScarpa = new THREE.MeshLambertMaterial({ color: 0x3a3832 });
    function gamba(lato) {
      const anca = new THREE.Group();
      anca.position.set(0.085 * lato, 0.54, -0.02);

      const coscia = new THREE.Mesh(new THREE.CapsuleGeometry(0.063, 0.24, 3, 8), matPantaloni);
      coscia.position.y = -0.185;
      coscia.castShadow = !movimentoRidotto;
      anca.add(coscia);

      const ginocchio = new THREE.Group();
      ginocchio.position.y = -0.37;
      anca.add(ginocchio);

      const polpaccio = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.22, 3, 8), matPantaloni);
      polpaccio.position.y = -0.16;
      ginocchio.add(polpaccio);

      const scarpa = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.19), matScarpa);
      scarpa.position.set(0, -0.325, 0.04);
      ginocchio.add(scarpa);

      // Riposo = seduto: coscia in avanti, polpaccio in giu'. Gli stessi
      // angoli di prima, scritti come rotazioni invece che come posizioni.
      anca.rotation.x = Math.PI / 2;
      ginocchio.rotation.x = -Math.PI / 2 + 0.12;
      persona.add(anca);
      return { anca, ginocchio };
    }
    const gambaSx = gamba(-1), gambaDx = gamba(1);

    gruppo.add(persona);

    // ── anello di stato ──
    const anello = new THREE.Mesh(
      new THREE.RingGeometry(0.44, 0.58, 28),
      new THREE.MeshBasicMaterial({ color: POSA.libero.colore, transparent: true, opacity: 0.85 }));
    anello.rotation.x = -Math.PI / 2;
    anello.position.set(0, 0.02, 0.84);
    gruppo.add(anello);

    // Il bersaglio del click copre tutta la postazione: cliccare la testa o
    // la scrivania deve fare la stessa cosa.
    const bersaglioClick = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 1.8, 2.4),
      new THREE.MeshBasicMaterial({ visible: false }));
    bersaglioClick.position.set(0, 0.85, 0.3);
    bersaglioClick.userData.agentId = agente.id;
    gruppo.add(bersaglioClick);
    cliccabili.push(bersaglioClick);

    gruppoAgenti.add(gruppo);

    return {
      agente, gruppo, persona, testa, busto, sedia,
      braccioSx, braccioDx, gambaSx, gambaDx, anello, schermo,
      base: { x, z }, posa: 'libero', fase: Math.random() * Math.PI * 2,
      // Dove sta quando e' al suo posto, e dove sta andando se non ci sta.
      // Il giro e' null quando e' seduto: vedi decidiGiri.
      giro: null, passo: Math.random() * 6.28, inPiedi: 0,
      prossimaIdea: 4 + Math.random() * 20,
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

    const messi = [];
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
        // L'orientamento conta piu' di quanto sembri. Nella prima versione
        // ogni agente guardava il centro della stanza: sembrava sensato, ma
        // dalla vista d'insieme si vedevano nuche e retro dei monitor,
        // cioe' il peggio dei due mondi, visto che lo schermo mostra la
        // miniatura vera del lavoro in corso.
        //
        // Lo schermo sta davanti alla persona, quindi si vede solo da
        // dietro le sue spalle: e' anche l'inquadratura del riferimento,
        // la scrivania vista da dietro con il monitor acceso davanti.
        // Quindi le persone danno le spalle alla posizione di riposo della
        // camera, con una variazione per agente perche' non sembrino una
        // fila di comparse. Chi vuole vedere le facce gira intorno:
        // l'orbita arriva dall'altra parte.
        const h = impronta(agente.slug || agente.nome || String(i));
        const variazione = ((h % 100) / 100 - 0.5) * 0.7;   // circa ±20 gradi
        const rotazione = orbitaRiposo.theta + variazione;
        avatarPerAgente.set(agente.id, creaAvatar(agente, x, z, rotazione));
        messi.push([x, z]);
      });
    }

    // L'area da inquadrare e' dove sono finiti davvero, non la pianta delle
    // zone: il margine tiene dentro scrivania e monitor, che stanno intorno
    // al punto dell'avatar.
    if (messi.length) {
      const xs = messi.map(m => m[0]), zs = messi.map(m => m[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      AREA = {
        x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
        mezzaX: (maxX - minX) / 2 + 1.2,
        mezzaZ: (maxZ - minZ) / 2 + 1.2,
        alto: 2.2,
      };
      bersaglio.set(AREA.x, 0.6, AREA.z);
      // Due passate: si inquadra, si centra, e si rimisura perche'
      // spostando il bersaglio cambia anche quanto serve stare lontani.
      for (let i = 0; i < 2; i++) {
        orbita.raggio = raggioCheInquadra();
        piazzaCamera();
        centraInquadratura();
      }
      orbitaRiposo.raggio = orbita.raggio;
      riposoBersaglio.copy(bersaglio);
      if (zoomManuale) { orbita.raggio = orbitaRiposo.raggio; }
      piazzaCamera();
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

  /** L'ultima fotografia di chi sta lavorando con chi. La usa decidiGiri. */
  let ultimeCoppie = [];

  function aggiornaCollaborazioni(coppie) {
    ultimeCoppie = Array.isArray(coppie) ? coppie : [];
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
    zoomManuale = true;
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
      zoomManuale = true;
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
    // Torna anche all'inquadratura che si adatta al riquadro: e' il tasto
    // con cui si rimedia a uno zoom andato storto.
    zoomManuale = false;
    orbitaRiposo.raggio = raggioCheInquadra();
    inquadra(riposoBersaglio.clone(), orbitaRiposo.raggio);
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

  // ── Targhette: chi e' chi, e dove sono le zone ──────────
  // Stesso livello dei fumetti e stessa meccanica, per lo stesso motivo:
  // il testo dentro la scena non si legge. Il nome dipinto sul monitor e'
  // un canvas 384x228 su un piano di 0.62 unita' mondo, e alla scala di
  // resa esce a circa tre pixel.
  const targhe = new Map();
  function targaDi(id) {
    if (targhe.has(id)) return targhe.get(id);
    const el = document.createElement('div');
    el.className = 'regia-targa';
    el.innerHTML = '<span class="rt-pallino"></span>'
                 + '<span class="rt-nome"></span><span class="rt-che"></span>';
    livello.appendChild(el);
    const t = { el, pallino: el.querySelector('.rt-pallino'),
                nome: el.querySelector('.rt-nome'), che: el.querySelector('.rt-che') };
    targhe.set(id, t);
    return t;
  }

  const targheZona = new Map();
  function targaZonaDi(chiave, nome) {
    if (targheZona.has(chiave)) return targheZona.get(chiave);
    const el = document.createElement('div');
    el.className = 'regia-zona';
    el.textContent = nome;
    livello.appendChild(el);
    targheZona.set(chiave, el);
    return el;
  }

  const vettore = new THREE.Vector3();
  function posizionaFumetti() {
    const r = renderer.domElement.getBoundingClientRect();

    // La scala si calcola una volta sola e vale per tutti: i fumetti, le
    // targhette e i nomi delle zone devono rimpicciolire insieme, e il
    // controllo delle sovrapposizioni ha bisogno delle misure *rese*, non
    // di quelle di layout.
    //
    // Il minimo era 0.62: con l'inquadratura d'insieme il testo usciva fra
    // i 7 e i 9 pixel e il tasto "Guarda" misurava 43x18, cioe' sotto la
    // soglia di quello che si riesce a centrare col dito o col mouse. Il
    // fumetto e' l'unico punto della scena da cui si avvia un'azione: se
    // non si legge e non si preme, il 3D e' decorazione e si lavora dalla
    // fascia laterale.
    const scala = THREE.MathUtils.clamp(1.2 - orbita.raggio / 70, 0.9, 1.1);

    // Le targhette: una per agente visibile, e solo per chi non ha gia'
    // un fumetto. Il fumetto il nome lo dice da se': due cartellini per la
    // stessa persona sono rumore, ed era proprio il difetto della Sala —
    // lo stesso fatto scritto in quattro posti.
    const cartelli = [];
    for (const [id, a] of avatarPerAgente) {
      const t = targaDi(id);
      if (!a.gruppo.visible || fumetti.has(id)) { t.el.style.display = 'none'; continue; }
      // Segue la persona, non la scrivania: da quando si alzano e vanno in
      // giro, il nome fermo al posto vuoto era il cartellino di nessuno.
      a.persona.getWorldPosition(vettore);
      vettore.y = 0.04;
      vettore.project(camera);
      if (vettore.z > 1) { t.el.style.display = 'none'; continue; }
      const p = POSA[a.posa] || POSA.libero;
      if (t.nome.textContent !== (a.agente.nome || '')) t.nome.textContent = a.agente.nome || '';
      if (t.che.textContent !== p.etichetta) t.che.textContent = p.etichetta;
      t.pallino.style.background = '#' + p.colore.toString(16).padStart(6, '0');
      t.el.style.display = '';
      t.el.style.zIndex = String(500 - Math.round(vettore.z * 200));
      cartelli.push({
        t,
        x: (vettore.x * 0.5 + 0.5) * r.width,
        y: (-vettore.y * 0.5 + 0.5) * r.height + 6,
        w: (t.el.offsetWidth || 120) * scala,
        h: (t.el.offsetHeight || 22) * scala,
      });
    }
    // Chi sta davanti tiene il suo posto, chi sta dietro scende quel tanto
    // che basta. Le misure sono rese, non di layout: e' lo stesso errore
    // che faceva sbagliare bersaglio alla correzione dei fumetti.
    cartelli.sort((a, b) => a.y - b.y);
    for (let i = 0; i < cartelli.length; i++) {
      const c = cartelli[i];
      for (let j = 0; j < i; j++) {
        const d = cartelli[j];
        const vicinoX = Math.abs(c.x - d.x) < (c.w + d.w) / 2 - 8;
        if (vicinoX && c.y < d.y + d.h + 3 && c.y + c.h > d.y) c.y = d.y + d.h + 3;
      }
      c.t.el.style.transform =
        `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) `
        + `scale(${scala.toFixed(3)}) translate(-50%, 0)`;
    }
    for (const [id, t] of targhe) {
      if (!avatarPerAgente.has(id)) { t.el.remove(); targhe.delete(id); }
    }

    // I nomi delle zone, sul pavimento. Solo quelle che hanno qualcuno
    // dentro: una zona vuota con il cartello e' un posto che non esiste.
    const abitate = new Set();
    for (const a of avatarPerAgente.values()) {
      if (a.gruppo.visible && a.agente.zona) abitate.add(a.agente.zona);
    }
    for (const [chiave, z] of Object.entries(ZONE)) {
      const el = targaZonaDi(chiave, z.nome);
      if (!abitate.has(chiave)) { el.style.display = 'none'; continue; }
      // Spostato in fuori dal centro della stanza, cosi' il cartello non
      // finisce sopra le teste di chi ci lavora.
      const lungo = Math.hypot(z.x, z.z) || 1;
      vettore.set(z.x + (z.x / lungo) * 2.1, 0.02, z.z + (z.z / lungo) * 2.1);
      vettore.project(camera);
      if (vettore.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.zIndex = '1';
      // Dentro l'inquadratura: "Studio creativo" finiva mezzo fuori dal
      // bordo destro, e mezzo nome di zona non dice niente.
      const mezza = ((el.offsetWidth || 90) * scala) / 2 + 8;
      const sx = Math.min(Math.max((vettore.x * 0.5 + 0.5) * r.width, mezza), r.width - mezza);
      el.style.transform = `translate(${sx.toFixed(1)}px, `
        + `${((-vettore.y * 0.5 + 0.5) * r.height).toFixed(1)}px) `
        + `scale(${scala.toFixed(3)}) translate(-50%, -50%)`;
    }

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
        // Misure *rese*: offsetHeight e offsetWidth sono di layout, e
        // confrontarle con posizioni in pixel di schermo era confrontare
        // due sistemi di coordinate diversi. Con la scala a 0.67 i fumetti
        // si credevano larghi 216 ed erano 145: la correzione mirava al
        // posto sbagliato e due fumetti si sovrapponevano lo stesso, col
        // tasto "Guarda" di uno finito sotto l'altro.
        h: (f.el.offsetHeight || 64) * scala,
        w: (f.el.offsetWidth || 180) * scala,
      });
    }

    // Dal piu' vicino al piu' lontano: chi sta davanti tiene il suo posto e
    // chi sta dietro sale quel tanto che basta per restare leggibile.
    piazzati.sort((p, q) => p.z - q.z);
    for (let i = 0; i < piazzati.length; i++) {
      const p = piazzati[i];
      // Tre giri bastano: ogni giro o separa o si ferma. Prima era un
      // passaggio solo, e si alzava il fumetto sopra l'altro — ma se sopra
      // non c'era spazio, il "non uscire dall'inquadratura" lo rimetteva
      // giu' esattamente dov'era. Su una scena alta 360 pixel, cioe'
      // quella di un portatile, succedeva sempre: due fumetti sovrapposti
      // per il trentun per cento, col tasto "Guarda" di uno sotto
      // l'altro. Se sopra non c'e' posto ci si scosta di lato, che e' la
      // cosa che un essere umano farebbe.
      for (let giro = 0; giro < 3; giro++) {
        let mosso = false;
        for (let j = 0; j < i; j++) {
          const q = piazzati[j];
          const limiteX = (p.w + q.w) / 2 - 10;
          if (Math.abs(p.x - q.x) >= limiteX) continue;
          if (p.y <= q.y - q.h || p.y - p.h >= q.y) continue;
          const sopra = q.y - q.h - 8;        // bordo alto del fumetto gia' messo
          if (sopra - p.h >= 6) { p.y = sopra; mosso = true; continue; }
          const verso = p.x >= q.x ? 1 : -1;
          p.x = Math.min(Math.max(q.x + verso * limiteX, p.w / 2 + 4),
                         r.width - p.w / 2 - 4);
          mosso = true;
        }
        if (!mosso) break;
      }
      // Non deve uscire dall'inquadratura in alto.
      p.y = Math.max(p.h + 6, p.y);
      p.f.el.style.transform =
        `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) `
        + `scale(${scala.toFixed(3)}) translate(-50%, -100%)`;
      p.f.el.style.zIndex = String(1000 - Math.round(p.z * 500));
    }
  }

  // ── Chi si alza e dove va ───────────────────────────────
  //
  // La stanza aveva otto persone che respiravano alla scrivania e non si
  // muovevano mai. Il movimento non e' decorazione: e' l'unica cosa che
  // dice, guardando e basta, che qualcosa sta succedendo. Chi lavora resta
  // al suo posto — li' la verita' e' che e' al suo posto — ma chi e' libero
  // si alza, e chi e' stato coinvolto da un collega va davvero da lui.
  //
  // Nessuno di questi giri inventa un fatto: o c'e' una collaborazione
  // vera nei lavori aperti, o e' una pausa, e una pausa non dice niente di
  // falso su un agente libero.

  const PASSO = 1.15;          // metri al secondo, un passo tranquillo
  const vTmp = new THREE.Vector3();

  /** Un angolo che si avvicina a un altro per la via piu' corta. */
  function versoAngolo(da, a, quanto) {
    let d = ((a - da + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return da + d * Math.min(1, quanto);
  }

  /** Il posto dove ci si ferma per parlare con qualcuno: di fianco a lui. */
  function accantoA(altro) {
    return altro.gruppo.localToWorld(new THREE.Vector3(1.05, 0, 1.25));
  }

  function mandaIn(a, mondo, secondi) {
    const locale = a.gruppo.worldToLocal(mondo.clone());
    a.giro = {
      locale: new THREE.Vector3(locale.x, 0, locale.z),
      fino: 0, durata: secondi, torna: false, arrivato: false,
    };
  }

  /** Quante persone al massimo stanno in giro insieme. */
  const IN_GIRO_MAX = 2;

  function decidiGiri(t) {
    const liberi = [];
    let inGiro = 0;
    for (const a of avatarPerAgente.values()) {
      if (!a.gruppo.visible) { a.giro = null; continue; }
      // Chi lavora, chi ha una domanda in sospeso e chi e' spento sta al
      // suo posto: alzarsi racconterebbe una cosa che non e' vera.
      if (a.posa === 'lavora' || a.posa === 'mano_alzata' || a.posa === 'spento') {
        if (a.giro) a.giro.torna = true;
        continue;
      }
      if (a.giro) inGiro++; else liberi.push(a);
    }
    if (!liberi.length) return;

    // Prima le collaborazioni vere: chi e' stato coinvolto va dal collega.
    for (const c of ultimeCoppie) {
      const chi = avatarPerAgente.get(c.a);
      const verso = avatarPerAgente.get(c.da);
      if (!chi || !verso || chi === verso) continue;
      if (chi.giro || !liberi.includes(chi)) continue;
      if (!chi.gruppo.visible || !verso.gruppo.visible) continue;
      if (inGiro >= IN_GIRO_MAX) break;
      mandaIn(chi, accantoA(verso), 7 + Math.random() * 6);
      chi.prossimaIdea = t + 40;
      inGiro++;
    }

    // Poi le pause: non spesso, e mai piu' di due persone in piedi insieme.
    // Con otto che si alzano a turno la stanza sembra un corteo, e il
    // movimento smette di dire qualcosa proprio perche' c'e' sempre.
    if (inGiro >= IN_GIRO_MAX) return;
    for (const a of liberi) {
      if (a.giro || t < a.prossimaIdea) continue;
      a.prossimaIdea = t + 45 + Math.random() * 70;
      const altri = liberi.filter(x => x !== a && !x.giro && x.gruppo.visible);
      const alCervello = Math.random() < 0.45 || !altri.length;
      const meta = alCervello
        ? new THREE.Vector3(ZONE.cervello.x + (Math.random() - 0.5) * 1.6, 0,
                            ZONE.cervello.z + 1.5 + Math.random() * 0.6)
        : accantoA(altri[Math.floor(Math.random() * altri.length)]);
      mandaIn(a, meta, 6 + Math.random() * 8);
      break;   // una persona alla volta: otto che si alzano insieme e' un corteo
    }
  }

  // ── Stato degli avatar ──────────────────────────────────
  function aggiornaStato(agenti, datiPerAgente) {
    for (const [id, a] of avatarPerAgente) {
      const d = datiPerAgente.get(id) || {};
      a.posa = d.posa || 'libero';
      const p = POSA[a.posa] || POSA.libero;
      a.anello.material.color.setHex(p.colore);
      if (a.posa === 'spento') schermoSpento(a.schermo);
      else disegnaSchermo(a.schermo, a.agente, d.lavoro, d.contenuto);
    }
  }

  // ── Il ciclo ────────────────────────────────────────────
  let orologio = new THREE.Clock();
  let ultimaDecisione = 0;
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

    // La distanza giusta dipende dalla forma del riquadro, quindi si rifa'
    // qui: alla prima misura e a ogni cambio di finestra. Se il manager ha
    // gia' messo mano allo zoom non gliela si sposta sotto le mani.
    orbitaRiposo.raggio = raggioCheInquadra();
    if (!zoomManuale) {
      orbita.raggio = orbitaRiposo.raggio;
      piazzaCamera();
    }
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
    // Le lampade salgono man mano che cala la luce da fuori: alle sei di
    // sera sono gia' accese a meta', a mezzanotte al massimo.
    const accese = 1.25 * (1 - Math.min(1, condizioniLuce.giorno / 0.45));
    for (const l of luciLampada) l.intensity += (accese - l.intensity) * dt * 2;

    if (!movimentoRidotto) {
      // ── animazioni degli avatar ──
      for (const a of avatarPerAgente.values()) {
        a.fase += dt;
        const respiro = Math.sin(a.fase * 1.6) * 0.011;
        a.busto.position.y = 0.79 + respiro;
        a.testa.position.y = 1.07 + respiro;

        const sx = a.braccioSx, dx = a.braccioDx;

        if (a.posa === 'spento') {
          // Immobile, spalle giu', testa bassa: si vede da lontano che non
          // sta aspettando un lavoro, e' fuori servizio.
          sx.spalla.rotation.x = 0.04; sx.spalla.rotation.z =  0.06;
          dx.spalla.rotation.x = 0.04; dx.spalla.rotation.z = -0.06;
          sx.gomito.rotation.x = -0.08;
          dx.gomito.rotation.x = -0.08;
          a.testa.rotation.x = 0.3;
          a.testa.rotation.y *= 0.9;
          a.persona.rotation.z = 0;
          // nessun respiro: l'altezza torna ferma al suo posto
          a.busto.position.y = 0.785;
          a.testa.position.y = 1.065;

        } else if (a.posa === 'lavora') {
          // digita: le mani si alternano sulla tastiera, e la testa e'
          // appena china sullo schermo
          const v = a.fase * 10;
          sx.gomito.rotation.x = -0.95 + Math.sin(v) * 0.07;
          dx.gomito.rotation.x = -0.95 + Math.sin(v + 2.1) * 0.07;
          sx.spalla.rotation.x = -0.42; dx.spalla.rotation.x = -0.42;
          sx.spalla.rotation.z =  0.12; dx.spalla.rotation.z = -0.12;
          a.testa.rotation.x = 0.17;
          a.testa.rotation.y *= 0.88;
          a.persona.rotation.z = 0;

        } else if (a.posa === 'mano_alzata') {
          // alza il braccio destro, lo tiene su e oscilla appena
          dx.spalla.rotation.x = -2.5 + Math.sin(a.fase * 2.3) * 0.11;
          dx.spalla.rotation.z = -0.3;
          dx.gomito.rotation.x = -0.35;
          sx.spalla.rotation.x = -0.42; sx.spalla.rotation.z = 0.12;
          sx.gomito.rotation.x = -0.95;
          a.testa.rotation.x = -0.1;
          a.testa.rotation.y *= 0.88;
          a.persona.rotation.z = Math.sin(a.fase * 1.1) * 0.018;

        } else if (a.posa === 'attende') {
          // ferma a guardare lo schermo, una mano che tamburella
          sx.spalla.rotation.x = -0.4; sx.spalla.rotation.z = 0.12;
          dx.spalla.rotation.x = -0.4; dx.spalla.rotation.z = -0.12;
          sx.gomito.rotation.x = -0.9;
          dx.gomito.rotation.x = -0.9 + Math.sin(a.fase * 3.4) * 0.05;
          a.testa.rotation.x = 0.1;
          a.testa.rotation.y *= 0.88;
          a.persona.rotation.z = 0;

        } else {
          // in pausa: si stacca dalla scrivania, braccia rilassate, si
          // guarda intorno
          sx.spalla.rotation.x = -0.12; sx.spalla.rotation.z =  0.2;
          dx.spalla.rotation.x = -0.12; dx.spalla.rotation.z = -0.2;
          sx.gomito.rotation.x = -0.3;
          dx.gomito.rotation.x = -0.3;
          a.testa.rotation.x = -0.03;
          a.testa.rotation.y = Math.sin(a.fase * 0.45) * 0.45;
          a.persona.rotation.z = 0;
        }

        // ── stare al proprio posto, o andare da qualche parte ──
        //
        // Chi lavora sta vicino alla scrivania, chi e' in pausa si allontana
        // un po' con tutta la sedia. E chi ha un giro da fare ci va: a
        // piedi, guardando dove cammina, e poi torna a sedersi.
        const zRiposo = (a.posa === 'libero' || a.posa === 'spento') ? 0.98 : 0.8;
        a.sedia.position.z += ((zRiposo + 0.04) - a.sedia.position.z) * dt * 2.4;

        const g = a.giro;
        const andando = g && !g.torna;
        const bx = andando ? g.locale.x : 0;
        const bz = andando ? g.locale.z : zRiposo;
        const p = a.persona.position;
        // vx/vz e non dx/dz: dx qui sopra e' gia' il braccio destro, e
        // ridichiararlo faceva fallire tutto il modulo con un
        // "Identifier 'dx' has already been declared". La scena non si
        // apriva affatto, e node --check non se n'era accorto: l'ha preso
        // il banco, aprendo la pagina in un browser vero.
        const vx = bx - p.x, vz = bz - p.z;
        const lontano = Math.hypot(vx, vz);
        const cammina = lontano > 0.1;

        if (cammina) {
          const avanti = Math.min(1, (PASSO * dt) / lontano);
          p.x += vx * avanti;
          p.z += vz * avanti;
          a.persona.rotation.y = versoAngolo(a.persona.rotation.y,
                                             Math.atan2(vx, vz), dt * 5);
          a.passo += dt * 7.5;
        } else if (g && !g.torna) {
          // Arrivato: si ferma li' e guarda verso la scrivania da cui e'
          // venuto, che e' quello che fa una persona che e' andata a dire
          // una cosa a qualcuno.
          if (!g.arrivato) { g.arrivato = true; g.fino = t + g.durata; }
          a.persona.rotation.y = versoAngolo(a.persona.rotation.y,
                                             Math.atan2(-p.x, -p.z), dt * 3);
          if (t > g.fino) g.torna = true;
        } else if (g && g.torna) {
          a.giro = null;
        } else {
          p.x += (0 - p.x) * dt * 2.4;
          p.z += (zRiposo - p.z) * dt * 2.4;
          a.persona.rotation.y = versoAngolo(a.persona.rotation.y, 0, dt * 4);
        }

        // In piedi o seduto: una sola grandezza da cui dipendono l'altezza,
        // le gambe e le braccia. Passa da 0 a 1 in mezzo secondo, cosi'
        // alzarsi si vede ma non e' uno scatto.
        const vuole = a.giro ? 1 : 0;
        a.inPiedi += (vuole - a.inPiedi) * Math.min(1, dt * 3.4);
        const seduto = 1 - a.inPiedi;
        // 0.16 e' quanto manca alle scarpe per toccare terra con le gambe
        // distese: seduto l'anca sta a 0.54 e la gamba e' lunga 0.70.
        const saltello = cammina ? Math.abs(Math.sin(a.passo)) * 0.022 : 0;
        a.persona.position.y = a.inPiedi * (0.16 + saltello);

        const ANCA_SEDUTA = Math.PI / 2;
        const GIN_SEDUTO = -Math.PI / 2 + 0.12;
        let ancaS = 0, ancaD = 0, ginS = 0, ginD = 0;
        if (cammina) {
          const o = Math.sin(a.passo);
          ancaS = o * 0.5;  ancaD = -o * 0.5;
          ginS = -Math.max(0, -o) * 0.75;
          ginD = -Math.max(0,  o) * 0.75;
        }
        a.gambaSx.anca.rotation.x      = ANCA_SEDUTA * seduto + ancaS * a.inPiedi;
        a.gambaDx.anca.rotation.x      = ANCA_SEDUTA * seduto + ancaD * a.inPiedi;
        a.gambaSx.ginocchio.rotation.x = GIN_SEDUTO  * seduto + ginS * a.inPiedi;
        a.gambaDx.ginocchio.rotation.x = GIN_SEDUTO  * seduto + ginD * a.inPiedi;

        // In piedi le braccia non stanno sulla tastiera: pendono, e
        // camminando oscillano al contrario delle gambe.
        if (a.inPiedi > 0.02) {
          const o = cammina ? Math.sin(a.passo) : 0;
          const misc = (fermo, mosso) => fermo * seduto + mosso * a.inPiedi;
          sx.spalla.rotation.x = misc(sx.spalla.rotation.x, -o * 0.42);
          dx.spalla.rotation.x = misc(dx.spalla.rotation.x,  o * 0.42);
          sx.spalla.rotation.z = misc(sx.spalla.rotation.z,  0.1);
          dx.spalla.rotation.z = misc(dx.spalla.rotation.z, -0.1);
          sx.gomito.rotation.x = misc(sx.gomito.rotation.x, -0.22);
          dx.gomito.rotation.x = misc(dx.gomito.rotation.x, -0.22);
          a.testa.rotation.x = misc(a.testa.rotation.x, 0);
        }
      }

      // Chi si alza lo si decide ogni secondo e mezzo, non sessanta volte
      // al secondo: e' una decisione, non un'animazione.
      if (t - ultimaDecisione > 1.5) { decidiGiri(t); ultimaDecisione = t; }

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

  /** Avvicina o allontana di un passo, dentro i limiti dell'orbita. */
  function zoom(passo) {
    zoomManuale = true;
    orbita.raggio = THREE.MathUtils.clamp(
      orbita.raggio * (passo > 0 ? 0.78 : 1.28),
      LIMITI.raggioMin, LIMITI.raggioMax);
    piazzaCamera();
  }

  return {
    disponiAgenti, aggiornaStato, aggiornaCollaborazioni, aggiornaFumetti,
    pulsaCervello, inquadra, torna, filtraZona, distruggi, zoom,
    ridimensiona,
    inquadraAgente: (id) => {
      const a = avatarPerAgente.get(id);
      if (a) inquadra(new THREE.Vector3(a.base.x, 1.0, a.base.z), 13);
    },
    zone: ZONE,
    /**
     * Dove stanno le persone, adesso. Esiste per il banco di prova: senza,
     * "camminano?" si puo' solo guardare, e guardare non e' una misura.
     */
    dovEsono: () => [...avatarPerAgente.values()].map((a) => {
      const m = a.persona.getWorldPosition(new THREE.Vector3());
      return {
        id: a.agente.id, chi: a.agente.nome, posa: a.posa,
        x: +a.persona.position.x.toFixed(2),
        z: +a.persona.position.z.toFixed(2),
        // In coordinate del mondo: servono per inquadrare e per sapere se
        // qualcuno e' finito fuori dalla stanza.
        mx: +m.x.toFixed(2), my: +m.y.toFixed(2), mz: +m.z.toFixed(2),
        inPiedi: +a.inPiedi.toFixed(2),
        inGiro: Boolean(a.giro),
      };
    }),
  };
}
