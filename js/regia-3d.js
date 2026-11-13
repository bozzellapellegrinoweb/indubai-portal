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

/**
 * La tavolozza.
 *
 * Era tutta crema su crema: pareti bianche, mobili crema, tappeti crema.
 * Da lontano — e questa schermata sta appesa a un muro — spariva tutto.
 * La reference che mi ha mandato Pellegrino fa l'opposto, e funziona:
 * pareti verde scuro, pavimento chiaro, legno caldo, ottone, sedute
 * bianche. Il contrasto e' fra il guscio scuro e quello che ci sta dentro.
 */
const COLORI = {
  pavimento:  0xf4f2ec,
  muro:       0x2a3527,   // verde scuro: e' il colore che fa la stanza
  scrivania:  0xf2eee5,
  gambe:      0xb4924f,   // ottone
  monitor:    0x2b2e35,
  sedia:      0xf0ece1,
  pianta:     0x4f8f3e,
  vaso:       0xcfc6b4,
  divisorio:  0xe3ddd0,
  tappeto:    0xdde3d3,   // salvia chiarissimo: si deve distinguere dal pavimento
  bordoTappeto: 0x4a5c42,  // il bordo verde dei tappeti della reference
  legno:      0x7b5634,   // noce caldo: bancone, tavolini, tavolo riunioni
  // Il divano era crema come il pavimento e spariva dentro: da lontano
  // sembrava una macchia. Verde salvia scuro, come i mobili della
  // reference: si vede da sei metri che li' c'e' un posto dove sedersi.
  // Il divano della reference e' bianco e curvo, non un parallelepipedo
  // verde: il verde sta sui muri, e dentro la stanza fa da fondo.
  divano:     0xf1ede3,
  cuscino:    0xdfd8c6,
  macchina:   0x3f434b,
  tappetoCaldo: 0xe3dac6,
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

/**
 * I posti dove si va quando non si sta alla scrivania.
 *
 * Non sono zone di lavoro e non stanno nel filtro: sono arredo con un
 * significato. Un ufficio dove tutti stanno sempre seduti al monitor non
 * somiglia a un ufficio, somiglia a un grafico; e su uno schermo appeso al
 * muro la differenza fra "sta lavorando" e "sta facendo una pausa" si deve
 * vedere da sei metri di distanza, senza leggere niente.
 */
const POSTI = {
  caffe:    { x:  6.3, z: -2.0, nome: 'Caffe\u0300' },
  relax:    { x: -6.3, z:  2.4, nome: 'Relax' },
  riunioni: { x:  5.4, z:  5.0, nome: 'Riunioni' },
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
    // La foschia sta SEMPRE dietro la stanza, non dentro.
    //
    // Era fissa a 22-42 unita', tarata su una camera che stava a sedici.
    // Appena l'inquadratura si e' allargata — il caffe' e il relax sono
    // piu' lontani delle scrivanie — la camera e' finita oltre le ventidue
    // e la foschia ha cominciato a mangiarsi i mobili invece dei muri: la
    // stanza usciva slavata, come dietro un vetro appannato. Legandola al
    // raggio, l'atmosfera resta e il soggetto no.
    if (scena.fog) {
      scena.fog.near = r * 1.35;
      scena.fog.far  = r * 3.2;
    }
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

  // La stanza e' una stanza, non un pavimento infinito.
  //
  // Prima il pavimento era trenta metri per trenta e i muri stavano a
  // quindici: fuori campo, sempre. Si vedeva una distesa chiara con dei
  // mobili in mezzo, e niente diceva dove finisse. Una scatola aperta —
  // il pavimento, due muri vicini, e il bordo spesso sotto, come una casa
  // di bambole — racconta un ufficio in un colpo d'occhio.
  //
  // I muri sono piani a faccia singola: girandoci intorno spariscono da
  // soli invece di tagliare la vista, che e' esattamente quello che serve
  // quando la camera gira da sola nella vetrina.
  const MURO = 10.2;        // dove stanno i due muri
  const LATO = 21;          // quanto e' larga la lastra del pavimento

  const pavimento = new THREE.Mesh(new THREE.PlaneGeometry(LATO, LATO), mat.pavimento);
  pavimento.rotation.x = -Math.PI / 2;
  pavimento.receiveShadow = !movimentoRidotto;
  ufficio.add(pavimento);

  // Il bordo sotto: da' spessore alla lastra e stacca la stanza dal fondo.
  const lastra = new THREE.Mesh(new THREE.BoxGeometry(LATO, 0.42, LATO),
    new THREE.MeshLambertMaterial({ color: 0xe6e1d5 }));
  lastra.position.y = -0.21;
  ufficio.add(lastra);

  // Fughe del pavimento: una griglia leggera, non un reticolo tecnico.
  const griglia = new THREE.GridHelper(LATO, LATO, 0xe2ddd1, 0xe9e5db);
  griglia.position.y = 0.002;
  ufficio.add(griglia);

  const ALTO_MURO = 3.4;
  for (const [x, z, ry] of [[0, -MURO, 0], [-MURO, 0, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(LATO, ALTO_MURO), mat.muro);
    m.position.set(x, ALTO_MURO / 2, z); m.rotation.y = ry;
    m.receiveShadow = !movimentoRidotto;
    ufficio.add(m);
    // Battiscopa: senza, il muro e il pavimento sono due bianchi che si
    // toccano e l'angolo della stanza non si vede.
    const battiscopa = new THREE.Mesh(new THREE.BoxGeometry(LATO, 0.14, 0.05), mat.divisorio);
    battiscopa.position.set(x, 0.07, z); battiscopa.rotation.y = ry;
    ufficio.add(battiscopa);
  }

  /** Qualcosa appeso al muro: una finestra chiara o un pannello scuro. */
  function alMuro(larghezza, altezza, materiale, lungoIlMuro, altezzaDaTerra, quale) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(larghezza, altezza), materiale);
    if (quale === 'fondo') m.position.set(lungoIlMuro, altezzaDaTerra, -MURO + 0.02);
    else { m.position.set(-MURO + 0.02, altezzaDaTerra, lungoIlMuro); m.rotation.y = Math.PI / 2; }
    ufficio.add(m);
    return m;
  }

  // Le finestre guardano il tramonto di Dubai: il loro colore lo decide
  // l'ora, come le lampade.
  const CIELO    = new THREE.Color(0xdcebf4);   // mezzogiorno
  const TRAMONTO = new THREE.Color(0xf0b473);   // il tramonto di Dubai
  const NOTTE    = new THREE.Color(0x2e3a52);
  const matFinestra = new THREE.MeshBasicMaterial({ color: TRAMONTO.clone() });
  const matTelaio   = new THREE.MeshLambertMaterial({ color: 0xd9d3c4 });
  const finestre = [];
  /** Di quanto staccare dal muro, per non sovrapporre due piani identici. */
  const stacca = (m, quale, quanto) => {
    if (quale === 'fondo') m.position.z += quanto; else m.position.x += quanto;
  };
  // Spaziate perche' non si tocchino: lo schermo del brand sta nel vuoto
  // fra la seconda e la terza finestra del muro di fondo.
  for (const [quale, dove] of [['fondo', -6.4], ['fondo', -1.8], ['fondo', 7.4],
                               ['lato', -4.4], ['lato', 2.2], ['lato', 7.4]]) {
    alMuro(3.0, 1.75, matTelaio, dove, 2.0, quale);
    const vetro = alMuro(2.8, 1.55, matFinestra.clone(), dove, 2.0, quale);
    stacca(vetro, quale, 0.012);
    finestre.push(vetro);
  }

  // Lo schermo del brand, come quello appeso nella sala riunioni vera.
  const cornice = alMuro(3.5, 2.05,
    new THREE.MeshLambertMaterial({ color: 0x1a1d22 }), 3.2, 2.05, 'fondo');
  stacca(cornice, 'fondo', 0.012);
  const schermoMuro = alMuro(3.3, 1.86,
    new THREE.MeshBasicMaterial({ color: 0xf7f5ef }), 3.2, 2.05, 'fondo');
  stacca(schermoMuro, 'fondo', 0.024);
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.52, 32),
    new THREE.MeshBasicMaterial({ color: 0x1a1d22 }));
  logo.position.set(3.2, 2.05, -MURO + 0.05);
  ufficio.add(logo);
  const logoDentro = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32),
    new THREE.MeshBasicMaterial({ color: 0xb5ff00 }));
  logoDentro.position.set(3.2, 2.05, -MURO + 0.06);
  ufficio.add(logoDentro);

  // I quadri: tre, piccoli, allineati. Nella reference sono la cosa che
  // dice "qui ci lavora qualcuno" piu' di qualunque mobile.
  for (const [i, dove] of [[0, -0.6], [1, 0.6], [2, 1.8]]) {
    const telaio = alMuro(0.82, 1.0,
      new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }), dove, 2.1, 'lato');
    stacca(telaio, 'lato', 0.012);
    const dentro = alMuro(0.66, 0.84,
      new THREE.MeshLambertMaterial({ color: [0xcbd9e2, 0xe6d5c2, 0xd6dfc8][i] }),
      dove, 2.1, 'lato');
    stacca(dentro, 'lato', 0.024);
  }

  /** Il colore del cielo fuori, all'ora che e' adesso a Dubai. */
  function coloraFinestre() {
    const giorno = Math.min(1, Math.max(0, condizioniLuce.giorno));
    const cielo = giorno > 0.45
      ? TRAMONTO.clone().lerp(CIELO, (giorno - 0.45) / 0.55)
      : NOTTE.clone().lerp(TRAMONTO, giorno / 0.45);
    for (const f of finestre) f.material.color.copy(cielo);
  }
  coloraFinestre();

  /**
   * Un tappeto rettangolare col bordo, come quelli della reference.
   *
   * Erano cerchi crema su pavimento crema: non si vedevano, quindi non
   * dicevano dove finisse una zona e cominciasse l'altra — che e' l'unico
   * motivo per cui un tappeto sta in un ufficio open space. Due piani
   * sovrapposti: quello sotto, verde, sporge di quindici centimetri e fa
   * il bordo.
   */
  function tappetoDiZona(x, z, larghezza, profondita, ruota = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ruota;
    const bordo = new THREE.Mesh(
      new THREE.PlaneGeometry(larghezza, profondita),
      new THREE.MeshLambertMaterial({ color: COLORI.bordoTappeto }));
    bordo.rotation.x = -Math.PI / 2;
    bordo.position.y = 0.004;
    g.add(bordo);
    const dentro = new THREE.Mesh(
      new THREE.PlaneGeometry(larghezza - 0.42, profondita - 0.42), mat.tappeto);
    dentro.rotation.x = -Math.PI / 2;
    dentro.position.y = 0.007;
    g.add(dentro);
    ufficio.add(g);
    return g;
  }

  // Tappeti di zona: dicono dove finisce una zona e comincia l'altra.
  for (const [chiave, z] of Object.entries(ZONE)) {
    if (chiave === 'cervello') continue;
    // Piccoli abbastanza da non toccarsi: a 5.8 per 5.0 si sovrapponevano,
    // e dei bordi sovrapposti non sono tappeti, sono nastro adesivo per
    // terra.
    tappetoDiZona(z.x, z.z, 3.9, 3.3);
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

  // ── Il caffe' e il relax ────────────────────────────────
  //
  // Due posti veri, con mobili veri, perche' una pausa che succede in
  // mezzo al pavimento vuoto non si legge: sembra che l'agente si sia
  // fermato per sbaglio. Con un bancone e un divano, invece, si capisce
  // a colpo d'occhio cosa sta facendo — che e' il punto di appendere
  // questa schermata a un muro.

  /** Il bancone del caffe', la macchina, due sgabelli. */
  function zonaCaffe(cx, cz) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = -Math.PI / 2.6;     // rivolto verso il centro della stanza

    // Lo stesso tappeto bordato delle zone di lavoro: un cerchio crema su
    // pavimento crema non si vedeva, e senza tappeto quell'angolo era un
    // mobile appoggiato sul pavimento invece che un'area.
    tappetoDiZona(cx, cz, 4.4, 3.4, g.rotation.y);

    const bancone = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.92, 0.62), mat.legno);
    bancone.position.set(0, 0.46, -0.5);
    bancone.castShadow = bancone.receiveShadow = !movimentoRidotto;
    g.add(bancone);
    const piano = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.7), mat.scrivania);
    piano.position.set(0, 0.95, -0.5);
    g.add(piano);

    // La macchina del caffe': un corpo, una testa, una tazza sotto.
    const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.36), mat.macchina);
    corpo.position.set(-0.6, 1.21, -0.52);
    corpo.castShadow = !movimentoRidotto;
    g.add(corpo);
    const beccuccio = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.14), mat.macchina);
    beccuccio.position.set(-0.6, 1.02, -0.38);
    g.add(beccuccio);
    const spia = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12),
      new THREE.MeshBasicMaterial({ color: 0xb5ff00 }));
    spia.position.set(-0.6, 1.3, -0.335);
    g.add(spia);

    // Tazze: piccole, ma sono quelle che dicono "qui si prende il caffe'".
    for (const [tx, tz] of [[-0.6, -0.33], [0.1, -0.44], [0.3, -0.36]]) {
      const tazza = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.04, 0.075, 10), mat.sedia);
      tazza.position.set(tx, 1.015, tz);
      g.add(tazza);
    }
    // Una brocca e un paio di bicchieri, per non lasciare il piano vuoto.
    const brocca = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 12), mat.vetro);
    brocca.position.set(0.85, 1.11, -0.5);
    g.add(brocca);

    for (const sx of [-0.55, 0.55]) {
      const sgabello = new THREE.Group();
      sgabello.position.set(sx, 0, 0.42);
      const seduta = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 14), mat.cuscino);
      seduta.position.y = 0.62;
      seduta.castShadow = !movimentoRidotto;
      sgabello.add(seduta);
      const palo = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.6, 8), mat.gambe);
      palo.position.y = 0.3;
      sgabello.add(palo);
      const piede = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 14), mat.gambe);
      piede.position.y = 0.02;
      sgabello.add(piede);
      g.add(sgabello);
    }
    g.add(ombraContatto(0, -0.5, 2.6));
    return g;
  }

  /** Il divano, un tavolino, una pianta: dove si sta sdraiati. */
  function zonaRelax(cx, cz) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = Math.PI / 2.4;

    tappetoDiZona(cx, cz, 5.0, 4.2, g.rotation.y);

    // Il divano e' curvo, come quello della reference: una mezzaluna
    // bianca. Era un parallelepipedo, e un parallelepipedo in mezzo a una
    // stanza non somiglia a un posto dove ci si siede. Resta lungo
    // abbastanza da starci stesi, perche' li' ci si stende davvero.
    //
    // Il mezzo disco va da -90 a +90 gradi: il lato dritto e' lungo l'asse
    // X, la pancia verso +Z. Chi ci si stende si allunga lungo la X.
    const R = 1.55;
    const seduta = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.3, 30, 1, false, -Math.PI / 2, Math.PI),
      mat.divano);
    seduta.position.set(0, 0.35, 0);
    seduta.castShadow = seduta.receiveShadow = !movimentoRidotto;
    g.add(seduta);
    // Lo schienale: un mezzo tubo aperto, cioe' la curva vista da dentro.
    const schienale = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.66, 30, 1, true, -Math.PI / 2, Math.PI),
      new THREE.MeshLambertMaterial({ color: COLORI.divano, side: THREE.DoubleSide }));
    schienale.position.set(0, 0.76, 0);
    schienale.castShadow = !movimentoRidotto;
    g.add(schienale);
    // Il bordo in cima, cosi' lo schienale non finisce con uno spigolo
    // sottile come un foglio.
    const bordo = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.07, 8, 30, Math.PI), mat.divano);
    bordo.position.set(0, 1.09, 0);
    bordo.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    g.add(bordo);
    for (const [px, pz] of [[-0.95, 0.5], [0.95, 0.5], [0, 0.95]]) {
      const cuscino = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.4), mat.cuscino);
      cuscino.position.set(px, 0.56, pz);
      cuscino.rotation.set(-0.2, -px * 0.5, 0);
      g.add(cuscino);
    }
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.12, R - 0.2, 0.2, 30, 1, false, -Math.PI / 2, Math.PI),
      new THREE.MeshLambertMaterial({ color: COLORI.cuscino }));
    base.position.set(0, 0.1, 0);
    g.add(base);

    const tavolino = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), mat.legno);
    tavolino.position.set(0, 0.42, -1.3);
    tavolino.castShadow = !movimentoRidotto;
    g.add(tavolino);
    const gambaT = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.4, 10), mat.gambe);
    gambaT.position.set(0, 0.2, -1.3);
    g.add(gambaT);
    const tazzina = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 10), mat.sedia);
    tazzina.position.set(0.12, 0.485, -1.25);
    g.add(tazzina);

    g.add(ombraContatto(0, 0, 2.9));
    g.add(ombraContatto(0, -1.3, 1.0));
    return g;
  }

  /** Il tavolo lungo con le sedie intorno: la sala riunioni della reference. */
  function zonaRiunioni(cx, cz) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = -Math.PI / 7;

    tappetoDiZona(cx, cz, 4.6, 3.1, g.rotation.y);

    const piano = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.08, 1.15), mat.legno);
    piano.position.y = 0.75;
    piano.castShadow = piano.receiveShadow = !movimentoRidotto;
    g.add(piano);
    // Due gambe a cavalletto invece di quattro: il tavolo lungo della
    // reference poggia cosi', e sotto si vedono le sedie.
    for (const gx of [-1.1, 1.1]) {
      const palo = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.1), mat.gambe);
      palo.position.set(gx, 0.36, 0);
      g.add(palo);
      const piede = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.9), mat.gambe);
      piede.position.set(gx, 0.03, 0);
      g.add(piede);
    }
    // Qualcosa sul tavolo: un blocco di fogli e due bicchieri.
    const fogli = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.22), mat.scrivania);
    fogli.position.set(-0.5, 0.8, 0.1);
    g.add(fogli);
    for (const bx of [0.3, 0.75]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.11, 10), mat.vetro);
      b.position.set(bx, 0.845, -0.15);
      g.add(b);
    }

    // Le sedie: tre per lato lungo, una per testa.
    // Le stesse posizioni servono dopo per farci sedere qualcuno: una
    // sedia che non si puo' usare e' un oggetto di scena.
    const sedie = SEDIE_TAVOLO;
    for (const [sx, sz, sr] of sedie) {
      const sedia = new THREE.Group();
      sedia.position.set(sx, 0, sz);
      sedia.rotation.y = sr;
      const sed = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.42), mat.sedia);
      sed.position.y = 0.45;
      sed.castShadow = !movimentoRidotto;
      sedia.add(sed);
      const sch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), mat.sedia);
      sch.position.set(0, 0.69, 0.19);
      sedia.add(sch);
      for (const [px, pz] of [[-0.16, 0.16], [0.16, 0.16], [-0.16, -0.16], [0.16, -0.16]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 6), mat.gambe);
        p.position.set(px, 0.22, pz);
        sedia.add(p);
      }
      g.add(sedia);
    }
    g.add(ombraContatto(0, 0, 3.2));
    return g;
  }

  /** Dove stanno le sedie del tavolo riunioni, in coordinate del tavolo. */
  const SEDIE_TAVOLO = [
    [-0.95, 0.95, 0], [0, 0.95, 0], [0.95, 0.95, 0],
    [-0.95, -0.95, Math.PI], [0, -0.95, Math.PI], [0.95, -0.95, Math.PI],
    [-1.85, 0, Math.PI / 2], [1.85, 0, -Math.PI / 2],
  ];

  /**
   * Una credenza bassa contro il muro.
   *
   * Nella reference sono la cosa che toglie il vuoto fra le scrivanie e la
   * parete: senza, il pavimento lungo i muri e' una fascia nuda e la
   * stanza sembra un magazzino con dentro degli uffici.
   */
  function credenza(cx, cz, larghezza, ruota) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = ruota;

    const corpo = new THREE.Mesh(new THREE.BoxGeometry(larghezza, 0.68, 0.46), mat.legno);
    corpo.position.y = 0.42;
    corpo.castShadow = corpo.receiveShadow = !movimentoRidotto;
    g.add(corpo);
    const piano = new THREE.Mesh(new THREE.BoxGeometry(larghezza + 0.06, 0.05, 0.52), mat.scrivania);
    piano.position.y = 0.78;
    g.add(piano);
    // Le ante: due solchi chiari sul fronte, che bastano a farlo leggere
    // come un mobile e non come un parallelepipedo.
    for (const ax of [-larghezza / 4, larghezza / 4]) {
      const anta = new THREE.Mesh(new THREE.BoxGeometry(larghezza / 2 - 0.08, 0.56, 0.02),
        new THREE.MeshLambertMaterial({ color: 0x8c6540 }));
      anta.position.set(ax, 0.42, 0.235);
      g.add(anta);
      const maniglia = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.025), mat.gambe);
      maniglia.position.set(ax, 0.58, 0.252);
      g.add(maniglia);
    }
    for (const px of [-larghezza / 2 + 0.12, larghezza / 2 - 0.12]) {
      const piede = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), mat.gambe);
      piede.position.set(px, 0.08, 0.16);
      g.add(piede);
    }
    // Qualcosa sopra: una pianta bassa e due libri appoggiati.
    const vasetto = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.18, 10), mat.vaso);
    vasetto.position.set(-larghezza / 2 + 0.4, 0.89, 0);
    g.add(vasetto);
    const cespuglio = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0),
      new THREE.MeshLambertMaterial({ color: 0x4f8f3e }));
    cespuglio.position.set(-larghezza / 2 + 0.4, 1.08, 0);
    g.add(cespuglio);
    const libri = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.22), mat.sedia);
    libri.position.set(larghezza / 2 - 0.5, 0.85, 0);
    libri.rotation.y = 0.2;
    g.add(libri);

    g.add(ombraContatto(0, 0, 1.9));
    return g;
  }

  /** La palma dell'angolo: alta, con le fronde aperte. */
  function palma(cx, cz) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    const vaso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.6, 14), mat.vaso);
    vaso.position.y = 0.3;
    vaso.castShadow = !movimentoRidotto;
    g.add(vaso);
    const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.7, 9), mat.legno);
    tronco.position.y = 1.4;
    tronco.rotation.z = 0.05;
    tronco.castShadow = !movimentoRidotto;
    g.add(tronco);
    for (let i = 0; i < 7; i++) {
      const fronda = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.25, 5),
        new THREE.MeshLambertMaterial({ color: 0x4f8f3e }));
      const a = (i / 7) * Math.PI * 2;
      fronda.position.set(Math.cos(a) * 0.5, 2.38, Math.sin(a) * 0.5);
      fronda.rotation.set(Math.cos(a) * 1.05, -a, Math.sin(a) * -1.05);
      fronda.scale.set(1, 1, 0.42);
      fronda.castShadow = !movimentoRidotto;
      g.add(fronda);
    }
    g.add(ombraContatto(0, 0, 1.5));
    return g;
  }

  // Le palme stanno dove stavano due piante tonde: cosi' sono dentro
  // l'inquadratura e non aggiungono larghezza alla stanza.
  const ALBERI = [[-6.6, -4.4], [5.2, -4.8]];
  const mobiliCaffe = zonaCaffe(POSTI.caffe.x, POSTI.caffe.z);
  const mobiliRelax = zonaRelax(POSTI.relax.x, POSTI.relax.z);
  const mobiliRiunioni = zonaRiunioni(POSTI.riunioni.x, POSTI.riunioni.z);
  ufficio.add(mobiliCaffe, mobiliRelax, mobiliRiunioni,
              palma(ALBERI[0][0], ALBERI[0][1]), palma(ALBERI[1][0], ALBERI[1][1]),
              credenza(-2.4, -MURO + 0.35, 2.8, 0),
              credenza(5.0, -MURO + 0.35, 2.0, 0),
              credenza(-MURO + 0.35, 1.2, 2.6, Math.PI / 2),
              credenza(-MURO + 0.35, 6.4, 1.8, Math.PI / 2));

  // ── Piante e lampade, con instancing ────────────────────
  // Sono gli oggetti che si ripetono: una sola chiamata di disegno per tutte.
  const puntiPianta = [
    [-6.8, 5.2], [8.6, 6.6], [0.2, -6.4],
    [-3.4, 6.6], [8.4, 1.4], [-8.2, -0.6],
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

  // La terza stava a (-5.0, 4.0), cioe' dentro il divano: il palo usciva
  // dal cuscino. Spostata di un metro e mezzo.
  const puntiLampada = [[-4.2, -3.0], [3.6, -5.0], [-4.0, 5.4], [4.2, 5.6]];
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
    // YXZ e non XYZ: cosi' rotation.y resta "da che parte e' girato" e
    // rotation.x diventa "quanto e' steso", uno indipendente dall'altro.
    // Con l'ordine normale il corpo si sdraiava sempre verso nord,
    // qualunque fosse il verso del divano.
    persona.rotation.order = 'YXZ';

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
      giro: null, passo: Math.random() * 6.28, inPiedi: 0, steso: 0, ozio: null,
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
        // Di tre quarti, non di spalle.
        //
        // Prima davano le spalle esatte alla camera di riposo, perche' lo
        // schermo sta davanti a loro e si voleva vedere il monitor acceso.
        // Il prezzo era che del corpo si vedeva solo la nuca: con lo
        // schienale della sedia di mezzo, un gesto delle braccia non
        // arrivava a chi guarda. Ruotandoli di cinquanta gradi si vedono
        // il profilo, le spalle e le mani, e il monitor resta comunque
        // visibile di taglio. Chi vuole la faccia intera gira intorno.
        const h = impronta(agente.slug || agente.nome || String(i));
        const variazione = ((h % 100) / 100 - 0.5) * 0.6;   // circa ±17 gradi
        const rotazione = orbitaRiposo.theta + 0.88 + variazione;
        avatarPerAgente.set(agente.id, creaAvatar(agente, x, z, rotazione));
        messi.push([x, z]);
      });
    }

    // L'area da inquadrare e' dove sono finiti davvero, non la pianta delle
    // zone: il margine tiene dentro scrivania e monitor, che stanno intorno
    // al punto dell'avatar.
    if (messi.length) {
      // Dentro l'inquadratura ci vanno anche il caffe' e il relax: se
      // restano fuori, un agente che va in pausa esce dal campo e
      // sembra sparito.
      const punti = messi
        .concat(Object.values(POSTI).map(p => [p.x, p.z]))
        .concat(ALBERI);
      const xs = punti.map(m => m[0]), zs = punti.map(m => m[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      AREA = {
        x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
        // Il margine era 1.2 e teneva fuori le sedie del tavolo lungo e la
        // cima delle palme: la stanza finiva tagliata ai bordi.
        mezzaX: (maxX - minX) / 2 + 1.7,
        mezzaZ: (maxZ - minZ) / 2 + 1.7,
        alto: 2.7,
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
  /**
   * La camera gira da sola.
   *
   * Serve alla vetrina, cioe' allo schermo appeso al muro dell'ufficio:
   * un'immagine ferma, per quanto animata al centro, dopo dieci secondi
   * smette di essere guardata. Un giro lento — meno di tre gradi al
   * secondo, un giro completo in due minuti — la tiene viva senza
   * diventare una giostra.
   *
   * Si ferma mentre qualcuno trascina, e riparte venti secondi dopo che ha
   * smesso: chi si avvicina allo schermo per guardare una cosa non deve
   * inseguirla.
   */
  let giraDaSe = false;
  let riprendiAGirare = 0;
  const LIMITI = { thetaMin: -0.35, thetaMax: Math.PI * 0.9, phiMin: 0.22, phiMax: 1.12,
                   raggioMin: 9, raggioMax: 38 };

  function giuMouse(ev) {
    premuto(ev);
    premutoSuTela = true;
    riprendiAGirare = orologio.getElapsedTime() + 20;
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
    riprendiAGirare = orologio.getElapsedTime() + 20;
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
   * @param {Array} voci [{agentId, nome, ruolo, testo, azione, onAzione, urgente}]
   */
  function aggiornaFumetti(voci) {
    const visti = new Set();
    for (const v of voci) {
      visti.add(v.agentId);
      const f = fumettoDi(v.agentId);
      const intestazione = v.ruolo ? v.nome + ' \u00b7 ' + v.ruolo : v.nome;
      if (f.testo !== v.testo || f.azione !== v.azione || f.nome !== intestazione) {
        f.testo = v.testo; f.azione = v.azione; f.nome = intestazione;
        f.el.innerHTML = '';
        const nome = document.createElement('div');
        nome.className = 'rf-nome';
        nome.textContent = intestazione;
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
                 + '<span class="rt-nome"></span><span class="rt-ruolo"></span>'
                 + '<span class="rt-che"></span>';
    livello.appendChild(el);
    const t = { el, pallino: el.querySelector('.rt-pallino'),
                nome: el.querySelector('.rt-nome'), ruolo: el.querySelector('.rt-ruolo'),
                che: el.querySelector('.rt-che') };
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
      // Nome e mestiere insieme. Da quando gli agenti si chiamano Vegeta e
      // Bulma il nome da solo non dice piu' chi fa cosa, e il mestiere
      // dipinto sul monitor, alla scala di resa, e' alto tre pixel.
      if (t.nome.textContent !== (a.agente.nome || '')) t.nome.textContent = a.agente.nome || '';
      if (t.ruolo.textContent !== (a.agente.ruolo || '')) t.ruolo.textContent = a.agente.ruolo || '';
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

    // I nomi delle zone, sul pavimento. Per le zone di lavoro solo quelle
    // che hanno qualcuno dentro: una zona vuota col cartello e' un posto
    // che non esiste. I posti fissi — caffe', relax, riunioni — invece
    // stanno sempre scritti: sono mobili, non squadre, e senza il nome
    // non si capisce che quell'angolo con un divano e' l'area relax.
    const abitate = new Set();
    for (const a of avatarPerAgente.values()) {
      if (a.gruppo.visible && a.agente.zona) abitate.add(a.agente.zona);
    }
    const daScrivere = Object.entries(ZONE).map(([k, z]) => [k, z, abitate.has(k)])
      .concat(Object.entries(POSTI).map(([k, z]) => ['posto-' + k, z, true]));
    for (const [chiave, z, mostra] of daScrivere) {
      const el = targaZonaDi(chiave, z.nome);
      if (!mostra) { el.style.display = 'none'; continue; }
      // Le zone di lavoro: il cartello si sposta in fuori, cosi' non
      // finisce sopra le teste di chi ci lavora. I posti fissi: il
      // cartello sta davanti al mobile, dove il pavimento e' libero.
      const lungo = Math.hypot(z.x, z.z) || 1;
      const fuori = chiave.startsWith('posto-') ? -2.0 : 2.1;
      vettore.set(z.x + (z.x / lungo) * fuori, 0.02, z.z + (z.z / lungo) * fuori);
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

  /**
   * Manda qualcuno da qualche parte.
   *
   * Le coordinate sono quelle della sua postazione e non del mondo, perche'
   * persona e' figlia del gruppo della scrivania: convertire qui una volta
   * sola evita di farlo sessanta volte al secondo nel ciclo.
   *
   * @param guardaMondo dove girarsi una volta arrivati (un punto del mondo)
   * @param sdraio      se ci si stende: l'altezza e l'orientamento del divano
   */
  function mandaIn(a, mondo, secondi, tipo = 'pausa', guardaMondo = null,
                   sdraio = null, siede = null) {
    const locale = a.gruppo.worldToLocal(mondo.clone());
    let guarda = null;
    if (guardaMondo) {
      const gl = a.gruppo.worldToLocal(guardaMondo.clone());
      guarda = Math.atan2(gl.x - locale.x, gl.z - locale.z);
    }
    a.giro = {
      tipo,
      locale: new THREE.Vector3(locale.x, 0, locale.z),
      guarda,
      // L'angolo del divano e' nel mondo: qui serve relativo alla scrivania.
      sdraio: sdraio ? { ...sdraio, y: sdraio.y - a.gruppo.rotation.y } : null,
      // Quanto in alto sta la seduta: uno sgabello e' sedici centimetri
      // sopra la sedia della scrivania, una sedia da riunione quasi uguale.
      siede,
      fino: 0, durata: secondi, torna: false, arrivato: false,
    };
    return a.giro;
  }

  // Un posto alla volta: due agenti sdraiati nello stesso punto del divano
  // sono una persona sola con quattro gambe.
  const occupato = {
    relax: null,
    caffe: [null, null],
    tavolo: SEDIE_TAVOLO.map(() => null),
  };

  function liberaPosti() {
    for (const [chiave, a] of Object.entries(occupato)) {
      if (Array.isArray(a)) {
        a.forEach((x, i) => { if (x && !x.giro) a[i] = null; });
      } else if (a && !a.giro) occupato[chiave] = null;
    }
  }

  /** Il divano: dove si appoggiano i piedi, dove va la testa, quanto in alto. */
  function postoSdraiato() {
    const ry = mobiliRelax.rotation.y;
    return {
      // Dentro la mezzaluna, lungo il lato dritto: e' li' che ci sta un
      // corpo disteso.
      dove: mobiliRelax.localToWorld(new THREE.Vector3(1.05, 0, 0.5)),
      // Il corpo si stende lungo il divano: la testa verso l'altro
      // bracciolo. L'angolo lo ricavo dal mobile, cosi' se il divano si
      // gira un giorno, chi ci dorme si gira con lui.
      sdraio: { y: Math.atan2(-Math.cos(ry), Math.sin(ry)), altezza: 0.70 },
    };
  }

  /** Sullo sgabello del bancone: ci si siede, non si sta in piedi davanti. */
  function postoCaffe(i) {
    return mobiliCaffe.localToWorld(new THREE.Vector3(i ? 0.55 : -0.55, 0, 0.42));
  }

  /** Una sedia libera al tavolo riunioni, col verso giusto. */
  function postoTavolo(i) {
    const [sx, sz] = SEDIE_TAVOLO[i];
    return {
      dove: mobiliRiunioni.localToWorld(new THREE.Vector3(sx, 0, sz)),
      guarda: mobiliRiunioni.localToWorld(new THREE.Vector3(sx * 0.2, 0, sz * 0.2)),
    };
  }

  /**
   * Quante persone al massimo stanno IN PIEDI fuori posto insieme.
   *
   * Il tetto riguarda chi cammina o sta all'impiedi, non chi e' seduto
   * altrove: tre che camminano insieme sono un corteo, tre seduti al
   * tavolo riunioni sono una riunione. Da quando ci si puo' sedere al
   * bancone e al tavolo, distinguere le due cose e' la differenza fra un
   * ufficio dove non succede mai niente e uno dove si lavora.
   */
  const IN_PIEDI_MAX = 2;
  // Chi parte si ferma a due; chi deve TORNARE, se ha aspettato troppo,
  // parte lo stesso. Si arriva a tre, e tre su otto non sono un corteo.
  const ASPETTA_AL_MASSIMO = 40;
  /** E quante al massimo stanno comunque lontane dalla scrivania. */
  const FUORI_MAX = 4;

  /**
   * Chi e' fuori posto e in piedi.
   *
   * Cioe' chiunque abbia un giro in corso, tranne chi in questo momento e'
   * arrivato e sta seduto o sdraiato. Il "non sta tornando" e' la parte
   * che avevo dimenticato: uno che si alza dallo sgabello e torna alla
   * scrivania e' in piedi come tutti gli altri, e contarlo ancora come
   * seduto faceva salire a quattro le persone che camminavano insieme.
   * L'ha trovato prova-movimento.cjs.
   */
  const staRitto = (a) => Boolean(a.giro)
    && !(a.giro.arrivato && !a.giro.torna && (a.giro.siede || a.giro.sdraio));

  /**
   * Quanti stanno in piedi fuori posto adesso, aggiornato a ogni
   * decisione. Serve anche a chi deve alzarsi per tornare: il tetto vale
   * per loro come per chi parte, se no due seduti che si alzano insieme lo
   * sfondano senza passare da qui.
   */
  let quantiRitti = 0;

  function decidiGiri(t) {
    const liberi = [];
    let inPiedi = 0, fuori = 0;
    for (const a of avatarPerAgente.values()) {
      if (!a.gruppo.visible) { a.giro = null; continue; }
      // Chi lavora, chi ha una domanda in sospeso e chi e' spento sta al
      // suo posto: alzarsi racconterebbe una cosa che non e' vera.
      if (a.posa === 'lavora' || a.posa === 'mano_alzata' || a.posa === 'spento') {
        if (a.giro) a.giro.torna = true;
        continue;
      }
      if (a.giro) { fuori++; if (staRitto(a)) inPiedi++; } else liberi.push(a);
    }
    liberaPosti();
    if (!liberi.length) return;

    // Prima le collaborazioni vere: chi e' stato coinvolto va dal collega.
    for (const c of ultimeCoppie) {
      const chi = avatarPerAgente.get(c.a);
      const verso = avatarPerAgente.get(c.da);
      if (!chi || !verso || chi === verso) continue;
      if (chi.giro || !liberi.includes(chi)) continue;
      if (!chi.gruppo.visible || !verso.gruppo.visible) continue;
      if (inPiedi >= IN_PIEDI_MAX || fuori >= FUORI_MAX) break;
      mandaIn(chi, accantoA(verso), 7 + Math.random() * 6, 'collega');
      chi.prossimaIdea = t + 40;
      inPiedi++; fuori++;
      quantiRitti = inPiedi;
    }

    // Poi le pause: non spesso, e mai piu' di due persone in piedi insieme.
    // Con otto che si alzano a turno la stanza sembra un corteo, e il
    // movimento smette di dire qualcosa proprio perche' c'e' sempre.
    if (fuori >= FUORI_MAX) return;
    for (const a of liberi) {
      if (a.giro || t < a.prossimaIdea) continue;
      // Piu' spesso di prima: con cinque o sei liberi e una pausa ogni
      // ottanta secondi a testa, la stanza stava ferma quasi sempre.
      a.prossimaIdea = t + 22 + Math.random() * 45;

      const altri = liberi.filter(x => x !== a && !x.giro && x.gruppo.visible);
      const sedieLibere = occupato.tavolo
        .map((x, i) => (x ? -1 : i)).filter(i => i >= 0);
      const posti = [];
      // Le cose che si fanno da seduti non contano nel tetto di chi sta in
      // piedi, quindi si possono offrire anche quando qualcuno gia' gira.
      if (!occupato.relax) posti.push('relax');
      if (occupato.caffe.some(x => !x)) posti.push('caffe', 'caffe');
      if (sedieLibere.length) posti.push('tavolo', 'tavolo');
      if (inPiedi < IN_PIEDI_MAX) {
        // Chiacchierare costa DUE posti, non uno: partono in due. Contarne
        // uno faceva arrivare a tre persone in piedi e a cinque fuori
        // posto, con i tetti a due e a quattro. L'ha trovato
        // prova-movimento.cjs, che li controlla fotogramma per fotogramma.
        if (altri.length && inPiedi + 2 <= IN_PIEDI_MAX && fuori + 2 <= FUORI_MAX) {
          posti.push('parla');
        }
        posti.push('cervello');
      }
      if (!posti.length) break;

      switch (posti[Math.floor(Math.random() * posti.length)]) {
        case 'relax': {
          // Sdraiarsi dura: e' una pausa vera, non un giro dell'isolato.
          const { dove, sdraio } = postoSdraiato();
          mandaIn(a, dove, 30 + Math.random() * 30, 'relax', null, sdraio);
          occupato.relax = a;
          fuori++; inPiedi++;   // finche' ci arriva e' in piedi come gli altri
          break;
        }
        case 'caffe': {
          const i = occupato.caffe[0] ? 1 : 0;
          // Sullo sgabello, non in piedi davanti al bancone: uno che beve
          // il caffe' in piedi in mezzo alla stanza sembra di passaggio.
          mandaIn(a, postoCaffe(i), 18 + Math.random() * 16, 'caffe',
                  mobiliCaffe.localToWorld(new THREE.Vector3(0, 0, -0.5)),
                  null, { altezza: 0.16 });
          occupato.caffe[i] = a;
          fuori++; inPiedi++;
          break;
        }
        case 'tavolo': {
          // Al tavolo riunioni, seduto, a leggere qualcosa. E' la cosa che
          // rende un ufficio un ufficio anche quando non succede niente.
          const i = sedieLibere[Math.floor(Math.random() * sedieLibere.length)];
          const { dove, guarda } = postoTavolo(i);
          mandaIn(a, dove, 30 + Math.random() * 45, 'tavolo', guarda,
                  null, { altezza: 0.03 });
          occupato.tavolo[i] = a;
          fuori++; inPiedi++;
          break;
        }
        case 'parla': {
          // Si incontrano a meta' strada e si guardano: nessuno dei due va
          // "a casa dell'altro", perche' non e' una consegna, e' una
          // chiacchiera.
          const b = altri[Math.floor(Math.random() * altri.length)];
          const pa = new THREE.Vector3(); a.gruppo.getWorldPosition(pa);
          const pb = new THREE.Vector3(); b.gruppo.getWorldPosition(pb);
          const meta = pa.clone().add(pb).multiplyScalar(0.5);
          const versoB = pb.clone().sub(pa).normalize().multiplyScalar(0.42);
          const quanto = 12 + Math.random() * 10;
          mandaIn(a, meta.clone().sub(versoB), quanto, 'parla', meta.clone().add(versoB));
          mandaIn(b, meta.clone().add(versoB), quanto, 'parla', meta.clone().sub(versoB));
          b.prossimaIdea = t + 60;
          inPiedi += 2; fuori += 2;
          break;
        }
        default:
          mandaIn(a, new THREE.Vector3(
            ZONE.cervello.x + (Math.random() - 0.5) * 1.6, 0,
            ZONE.cervello.z + 1.5 + Math.random() * 0.6),
            8 + Math.random() * 8, 'cervello');
          fuori++; inPiedi++;
      }
      break;   // una persona alla volta: otto che si alzano insieme e' un corteo
    }

    // Il conto aggiornato dopo le partenze di questo giro: lo legge chi e'
    // seduto e deve decidere se puo' alzarsi per tornare. Scriverlo prima,
    // com'era, voleva dire che chi si alzava non vedeva chi era appena
    // partito.
    quantiRitti = inPiedi;
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
  let giroAvanti = true;
  let tempoScena = 0;
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
    // Il tempo della scena, cioe' la somma dei dt davvero applicati. Non
    // coincide col tempo dell'orologio da polso: dt e' tagliato a un
    // decimo di secondo, quindi se la macchina rende a pochi fotogrammi
    // al secondo la scena va al rallentatore. Serve al banco di prova per
    // misurare le velocita' — per esempio quella della camera della
    // vetrina — senza che il risultato dipenda da quanto e' lenta la
    // macchina su cui gira il test.
    tempoScena += dt;
    const t = orologio.elapsedTime;

    // La luce di Dubai si ricalcola ogni mezzo minuto, non ogni fotogramma.
    if (t - ultimaLuce > 30) {
      condizioniLuce = aggiornaLuce();
      ultimaLuce = t;
      // Anche le finestre seguono l'ora di Dubai: cielo chiaro di giorno,
      // arancione al tramonto, blu di notte. E' la stessa cosa che fanno
      // le lampade, e insieme dicono che ora e' senza scriverlo.
      coloraFinestre();
    }
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

        } else if (a.giro) {
          // In giro: la posa la decidono il cammino e l'arrivo, qui si
          // mette solo il riposo da cui partono.
          //
          // Prima il repertorio della scrivania girava anche mentre uno
          // camminava: ogni fotogramma scriveva una posa da seduto e
          // subito dopo il blocco del passo ci mescolava l'oscillazione
          // delle braccia. Due comandi contrari sessanta volte al
          // secondo — ed e' da li' che venivano i gesti scomposti.
          sx.spalla.rotation.x = -0.12; sx.spalla.rotation.z =  0.14;
          dx.spalla.rotation.x = -0.12; dx.spalla.rotation.z = -0.14;
          sx.gomito.rotation.x = -0.26;
          dx.gomito.rotation.x = -0.26;
          a.testa.rotation.x = 0;
          a.busto.rotation.x = -0.1;
          a.persona.rotation.z = 0;

        } else {
          // ── in pausa, alla scrivania ──
          //
          // Un piccolo repertorio al posto di una posa sola. Le mani
          // restano sempre dove le terrebbe una persona seduta — sul
          // piano, in grembo, al viso — perche' un braccio che finisce
          // per aria o dentro il bracciolo si vede subito, anche da
          // lontano, e sembra un guasto.
          if (!a.ozio || t > a.ozio.fino) {
            const scelte = [
              ['guarda',     7, 11],
              ['stiracchia', 3, 2],
              ['indietro',   8, 10],
              ['telefono',   9, 10],
              ['pensa',      7, 8],
              ['guarda',     7, 10],
            ];
            const [tipo, base, extra] = scelte[Math.floor(Math.random() * scelte.length)];
            a.ozio = { tipo, fino: t + base + Math.random() * extra };
          }

          // Una velocita' sola per tutte le articolazioni: se ognuna
          // arriva per conto suo il corpo sembra montato male. E' lenta
          // di proposito — un gesto di una persona seduta non scatta.
          const verso = (nodo, campo, meta) => {
            nodo.rotation[campo] += (meta - nodo.rotation[campo]) * Math.min(1, dt * 3.5);
          };
          // Mezzo grado di differenza fra destra e sinistra: due braccia
          // identiche al millimetro sono la cosa che fa sembrare finto
          // tutto il resto.
          const asim = a.fase % 1 * 0.06;

          const posa = {
            // Seduto comodo, avambracci appoggiati al piano: e' la posa
            // di chi e' alla scrivania e non sta scrivendo.
            guarda: () => {
              verso(sx.spalla, 'x', -0.46); verso(sx.spalla, 'z',  0.14 + asim);
              verso(dx.spalla, 'x', -0.44); verso(dx.spalla, 'z', -0.14);
              verso(sx.gomito, 'x', -0.92); verso(dx.gomito, 'x', -0.96);
              verso(a.testa, 'x', -0.02);
              verso(a.testa, 'y', Math.sin(a.fase * 0.4) * 0.38);
              verso(a.busto, 'x', -0.1);
            },
            // Si stiracchia: braccia in alto, una appena piu' su
            // dell'altra, testa all'insu'.
            stiracchia: () => {
              const su = Math.sin(Math.min(Math.PI, Math.max(0, a.ozio.fino - t) * 1.1));
              verso(sx.spalla, 'x', -0.46 - 1.75 * su);
              verso(dx.spalla, 'x', -0.44 - 1.9 * su);
              verso(sx.spalla, 'z',  0.14 + 0.3 * su);
              verso(dx.spalla, 'z', -0.14 - 0.34 * su);
              verso(sx.gomito, 'x', -0.92 + 0.75 * su);
              verso(dx.gomito, 'x', -0.96 + 0.8 * su);
              verso(a.testa, 'x', -0.02 - 0.22 * su);
              verso(a.testa, 'y', 0);
              verso(a.busto, 'x', -0.1 - 0.1 * su);
            },
            // Appoggiato allo schienale, avambracci sui braccioli. Era a
            // mani dietro la nuca, con le spalle aperte di cinquanta
            // gradi: da sopra sembrava un uccello.
            indietro: () => {
              verso(sx.spalla, 'x', -0.2);  verso(sx.spalla, 'z',  0.3 + asim);
              verso(dx.spalla, 'x', -0.22); verso(dx.spalla, 'z', -0.3);
              verso(sx.gomito, 'x', -0.55); verso(dx.gomito, 'x', -0.6);
              verso(a.testa, 'x', -0.16);
              verso(a.testa, 'y', Math.sin(a.fase * 0.26) * 0.16);
              verso(a.busto, 'x', 0.1);
            },
            // Guarda il telefono: mani davanti, all'altezza del petto,
            // testa china. Il pollice che scorre e' l'unica cosa che si
            // muove.
            telefono: () => {
              verso(sx.spalla, 'x', -0.72); verso(sx.spalla, 'z',  0.22);
              verso(dx.spalla, 'x', -0.74); verso(dx.spalla, 'z', -0.2);
              verso(sx.gomito, 'x', -1.38 + Math.sin(a.fase * 2.4) * 0.035);
              verso(dx.gomito, 'x', -1.34);
              verso(a.testa, 'x', 0.3);
              verso(a.testa, 'y', 0.04);
              verso(a.busto, 'x', 0.0);
            },
            // Mano destra al mento, sinistra appoggiata al piano.
            pensa: () => {
              verso(sx.spalla, 'x', -0.5);  verso(sx.spalla, 'z',  0.16);
              verso(dx.spalla, 'x', -1.1);  verso(dx.spalla, 'z', -0.14);
              verso(sx.gomito, 'x', -0.95);
              verso(dx.gomito, 'x', -1.95);
              verso(a.testa, 'x', 0.06);
              verso(a.testa, 'y', 0.18 + Math.sin(a.fase * 0.22) * 0.08);
              verso(a.busto, 'x', -0.06);
            },
          };
          (posa[a.ozio.tipo] || posa.guarda)();
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
          // Arrivato. Dove guarda dipende dal perche' e' venuto: chi
          // chiacchiera guarda l'altro, chi prende il caffe' guarda il
          // bancone, chi non ha un motivo preciso si gira verso la
          // scrivania da cui e' venuto.
          if (!g.arrivato) { g.arrivato = true; g.fino = t + g.durata; }
          const dove = g.sdraio ? g.sdraio.y
                     : g.guarda !== null && g.guarda !== undefined ? g.guarda
                     : Math.atan2(-p.x, -p.z);
          a.persona.rotation.y = versoAngolo(a.persona.rotation.y, dove, dt * 3);
          // Finito il tempo si torna, ma non se ci sono gia' due persone
          // in piedi: chi sta comodo aspetta un momento. Dopo quaranta
          // secondi di attesa si alza comunque, perche' un tetto che
          // inchioda qualcuno al divano per sempre non e' un tetto, e' un
          // guasto.
          const puoAlzarsi = !g.siede && !g.sdraio
            ? true
            : quantiRitti < IN_PIEDI_MAX || t > g.fino + ASPETTA_AL_MASSIMO;
          if (t > g.fino && puoAlzarsi) {
            g.torna = true;
            if (g.siede || g.sdraio) quantiRitti++;
          }
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
        // In piedi finche' cammina; seduto quando e' arrivato in un posto
        // dove ci si siede — uno sgabello, una sedia del tavolo riunioni.
        const sedutoLi = Boolean(g && g.siede && g.arrivato && !g.torna && !cammina);
        const vuole = (a.giro && !sedutoLi) ? 1 : 0;
        a.inPiedi += (vuole - a.inPiedi) * Math.min(1, dt * 3.4);
        const seduto = 1 - a.inPiedi;
        // 0.16 e' quanto manca alle scarpe per toccare terra con le gambe
        // distese: seduto l'anca sta a 0.54 e la gamba e' lunga 0.70.
        const saltello = cammina ? Math.abs(Math.sin(a.passo)) * 0.022 : 0;

        // Sdraiato: il corpo si stende sul divano. Ci si mette e ci si
        // rialza in un secondo abbondante, perche' uno che scatta in piedi
        // da sdraiato non sembra una persona, sembra un difetto.
        const vuoleSteso = Boolean(g && g.sdraio && g.arrivato && !g.torna && !cammina);
        a.steso += ((vuoleSteso ? 1 : 0) - a.steso) * Math.min(1, dt * 1.6);
        a.persona.rotation.x = a.steso * (Math.PI / 2);
        const altezzaDivano = g && g.sdraio ? g.sdraio.altezza : 0.70;
        // La quota della seduta: zero alla propria scrivania, sedici
        // centimetri su uno sgabello, tre su una sedia da riunione.
        const quota = sedutoLi ? g.siede.altezza : 0;
        a.persona.position.y =
          (1 - a.steso) * (a.inPiedi * (0.16 + saltello) + (1 - a.inPiedi) * quota)
          + a.steso * altezzaDivano;

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

        // Arrivato e fermo: cosa fa dipende da perche' e' venuto. Senza
        // questo, uno al bancone del caffe' e uno che chiacchiera hanno la
        // stessa identica posa, e il posto e' l'unica cosa che li
        // distingue. Sta fuori dal blocco "in piedi" perche' al bancone e
        // al tavolo adesso ci si siede.
        if (g && g.arrivato && !g.torna && !cammina && !g.sdraio) {
          if (g.tipo === 'caffe') {
            // Beve: il braccio destro sale alla bocca ogni tanto.
            const sorso = Math.max(0, Math.sin(a.fase * 0.5));
            dx.spalla.rotation.x = -0.18 - sorso * 1.0;
            dx.spalla.rotation.z = -0.22;
            dx.gomito.rotation.x = -0.3 - sorso * 1.45;
            a.testa.rotation.x = -0.1 * sorso;
          } else if (g.tipo === 'parla') {
            // Gesticola: una mano che accompagna quello che dice.
            const gesto = Math.sin(a.fase * 1.4);
            dx.spalla.rotation.x = -0.5 + gesto * 0.22;
            dx.spalla.rotation.z = -0.3;
            dx.gomito.rotation.x = -1.0 - Math.max(0, gesto) * 0.35;
            a.testa.rotation.y = Math.sin(a.fase * 0.65) * 0.14;
          } else if (g.tipo === 'tavolo') {
            // Al tavolo: mani appoggiate, testa china su quello che legge,
            // e ogni tanto si guarda intorno come si fa in riunione.
            const alza = Math.max(0, Math.sin(a.fase * 0.22));
            sx.spalla.rotation.x = -0.62; sx.spalla.rotation.z =  0.16;
            dx.spalla.rotation.x = -0.62; dx.spalla.rotation.z = -0.16;
            sx.gomito.rotation.x = -1.05;
            dx.gomito.rotation.x = -1.05 + Math.sin(a.fase * 1.8) * 0.05;
            a.testa.rotation.x = 0.26 - 0.3 * alza;
            a.testa.rotation.y = Math.sin(a.fase * 0.3) * 0.3 * alza;
          }
        }

        // Sdraiato: braccia lungo il corpo, non piegate come alla tastiera.
        if (a.steso > 0.3) {
          const q = a.steso;
          const giu = (v) => v * (1 - q);
          sx.spalla.rotation.x = giu(sx.spalla.rotation.x);
          dx.spalla.rotation.x = giu(dx.spalla.rotation.x);
          sx.gomito.rotation.x = giu(sx.gomito.rotation.x) - 0.12 * q;
          dx.gomito.rotation.x = giu(dx.gomito.rotation.x) - 0.12 * q;
          sx.spalla.rotation.z = giu(sx.spalla.rotation.z) + 0.16 * q;
          dx.spalla.rotation.z = giu(dx.spalla.rotation.z) - 0.16 * q;
          a.testa.rotation.x = giu(a.testa.rotation.x);
        }
      }

      // Chi si alza lo si decide ogni secondo e mezzo, non sessanta volte
      // al secondo: e' una decisione, non un'animazione.
      if (t - ultimaDecisione > 1.5) { decidiGiri(t); ultimaDecisione = t; }

      if (giraDaSe && !trascina && t > riprendiAGirare && !inquadratura) {
        // Avanti e indietro fra i limiti, non un giro completo: da dietro
        // si vedrebbero le nuche e i monitor di spalle. Un grado e mezzo al
        // secondo: l'intera corsa in cinquanta secondi, andata e ritorno in
        // un minuto e quaranta. Piu' veloce diventa una giostra.
        orbita.theta += dt * 0.026 * (giroAvanti ? 1 : -1);
        if (orbita.theta > LIMITI.thetaMax) { orbita.theta = LIMITI.thetaMax; giroAvanti = false; }
        if (orbita.theta < LIMITI.thetaMin) { orbita.theta = LIMITI.thetaMin; giroAvanti = true; }
        piazzaCamera();
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
     * Mette tutti quelli fermi in una posa precisa.
     *
     * Serve al banco: i gesti si possono giudicare solo guardandoli, e
     * aspettare che capitino da soli rende il controllo irripetibile.
     * Non cambia niente di quello che gli agenti decidono: la posa
     * successiva se la scelgono come sempre.
     */
    forzaOzio: (tipo, quanto = 30) => {
      for (const a of avatarPerAgente.values()) {
        if (a.giro || a.posa !== 'libero') continue;
        a.ozio = { tipo, fino: tempoScena + quanto };
      }
    },
    /** Dove guarda la camera adesso: serve al banco per dire se gira. */
    dovEGuarda: () => ({
      theta: +orbita.theta.toFixed(4), raggio: +orbita.raggio.toFixed(2),
      tempo: +tempoScena.toFixed(3),
    }),
    /** La vetrina accende il giro lento della camera. */
    giraDaSola: (acceso) => {
      giraDaSe = Boolean(acceso);
      if (giraDaSe) riprendiAGirare = orologio.getElapsedTime() + 1.5;
    },
    /**
     * Dove stanno le persone, adesso. Esiste per il banco di prova: senza,
     * "camminano?" si puo' solo guardare, e guardare non e' una misura.
     */
    dovEsono: () => [...avatarPerAgente.values()].map((a) => {
      const m = a.persona.getWorldPosition(new THREE.Vector3());
      return {
        id: a.agente.id, chi: a.agente.nome, mestiere: a.agente.ruolo, posa: a.posa,
        x: +a.persona.position.x.toFixed(2),
        z: +a.persona.position.z.toFixed(2),
        // In coordinate del mondo: servono per inquadrare e per sapere se
        // qualcuno e' finito fuori dalla stanza.
        mx: +m.x.toFixed(2), my: +m.y.toFixed(2), mz: +m.z.toFixed(2),
        inPiedi: +a.inPiedi.toFixed(2),
        steso: +a.steso.toFixed(2),
        ozio: a.ozio ? a.ozio.tipo : null,
        perche: a.giro ? a.giro.tipo : null,
        inGiro: Boolean(a.giro),
      };
    }),
  };
}
