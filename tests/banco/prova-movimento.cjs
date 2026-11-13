/**
 * La stanza si muove, e si muove dicendo la verita'.
 *
 * Il movimento non e' decorazione: e' l'unica cosa che, guardando e basta,
 * dice che qualcosa sta succedendo. Ma per questo deve essere vero: chi
 * sta lavorando e' al suo posto, chi ha una domanda in sospeso non va a
 * passeggio, e nessuno esce dalla stanza.
 *
 * Il test guarda per un minuto e mezzo, perche' le pause sono rade di
 * proposito: otto persone che si alzano a turno sarebbero un corteo.
 *
 *   node tests/banco/prova-movimento.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };

const FERMI = ['lavora', 'mano_alzata', 'spento'];
// Il tetto riguarda chi sta IN PIEDI fuori posto. Chi e' seduto altrove —
// sullo sgabello del bancone, a una sedia del tavolo riunioni — non conta:
// tre che camminano insieme sono un corteo, tre seduti al tavolo sono una
// riunione.
// Due e' il tetto per chi PARTE. Si arriva a tre solo in un caso, ed e'
// voluto: chi e' seduto al bancone o al tavolo e ha finito il suo tempo
// aspetta che il tetto si liberi, ma dopo quaranta secondi si alza
// comunque — un tetto che inchioda qualcuno al divano non e' un tetto,
// e' un guasto. Tre persone in piedi su otto non sono un corteo.
const IN_PIEDI_MAX = 3;
const FUORI_MAX = 4;
const MURO = 11;          // oltre questo non c'e' piu' pavimento

let falliti = 0;
const dice = (ok, che, extra = '') => {
  console.log(`  ${ok ? 'ok ' : 'KO '} ${che}${extra ? '  ' + extra : ''}`);
  if (!ok) falliti++;
};

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await b.newPage({ viewport: { width:1440, height:900 }, timezoneId:'Asia/Dubai' });
  const errori = [];
  page.on('pageerror', e => errori.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errori.push(m.text().slice(0, 200)); });
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()); const s = SOST[u.pathname];
    if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
    r.continue();
  });
  await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2600);

  const leggi = () => page.evaluate(() => window.regiaScena?.dovEsono?.() ?? null);
  const partenza = await leggi();
  dice(Array.isArray(partenza) && partenza.length > 0,
       'la scena e viva e dice dove sono tutti',
       partenza ? `${partenza.length} persone` : 'NIENTE');
  if (!partenza) { await b.close(); process.exit(1); }

  const casa = new Map(partenza.map(a => [a.id, { mx: a.mx, mz: a.mz, posa: a.posa }]));
  const lontananza = new Map();      // quanto si e' allontanato ognuno
  let massimoInGiro = 0;
  const fuori = [];
  const nonDovevano = new Set();
  let visteGambe = false;

  const perche = new Map();        // perche' si sono alzati, e quante volte
  let maxStesi = 0;
  let massimoFuori = 0;
  const oziVisti = new Set();
  const sedutiAltrove = new Set();
  let altezzeSbagliate = [];

  for (let i = 0; i < 75; i++) {
    await page.waitForTimeout(2000);
    const ora = await leggi();
    if (!ora) break;
    let inPiedi = 0, fuoriPosto = 0;
    for (const a of ora) {
      const da = casa.get(a.id);
      if (!da) continue;
      const d = Math.hypot(a.mx - da.mx, a.mz - da.mz);
      lontananza.set(a.chi, Math.max(lontananza.get(a.chi) || 0, d));
      if (a.inGiro) {
        fuoriPosto++;
        if (a.inPiedi > 0.5 && a.steso < 0.5) inPiedi++;
      }
      // Chi lavora, chi ha la mano alzata e chi e' spento non si muove:
      // alzarsi racconterebbe una cosa che non e' vera.
      if (FERMI.includes(a.posa) && d > 0.6) nonDovevano.add(`${a.chi} (${a.posa}, ${d.toFixed(1)}m)`);
      if (Math.abs(a.mx) > MURO || Math.abs(a.mz) > MURO) fuori.push(`${a.chi} a (${a.mx},${a.mz})`);
      // In piedi vuol dire alzato da terra di 16 centimetri: e' la misura
      // che fa toccare le scarpe al pavimento con le gambe distese.
      // steso < 0.01 e non 0.1: chi si sta rialzando dal divano passa per
      // tutte le altezze intermedie, ed e' giusto cosi'. Con la soglia
      // larga il test diceva "in piedi ma a y=0.22" di uno che si stava
      // ancora tirando su.
      if (a.inPiedi > 0.98 && a.steso < 0.01) {
        visteGambe = true;
        if (Math.abs(a.my - 0.16) > 0.05) {
          nonDovevano.add(`${a.chi} in piedi ma a y=${a.my}`);
        }
      }
      if (a.perche) perche.set(a.perche, (perche.get(a.perche) || 0) + 1);
      // Sdraiato sul divano: il corpo sta all'altezza del cuscino, non per
      // aria e non dentro.
      if (a.steso > 0.9 && Math.abs(a.my - 0.70) > 0.08) {
        altezzeSbagliate.push(`${a.chi} steso a y=${a.my}`);
      }
    }
    massimoInGiro = Math.max(massimoInGiro, inPiedi);
    massimoFuori = Math.max(massimoFuori, fuoriPosto);
    maxStesi = Math.max(maxStesi, ora.filter(a => a.steso > 0.5).length);
    for (const a of ora) if (a.ozio) oziVisti.add(a.ozio);
    // Seduto fuori posto: lo sgabello sta sedici centimetri sopra la sedia
    // della scrivania, la sedia da riunione tre.
    for (const a of ora) {
      if (a.inGiro && a.inPiedi < 0.1 && a.steso < 0.1 && a.my > 0.01) {
        sedutiAltrove.add(`${a.chi} ${a.perche} y=${a.my}`);
      }
    }
  }

  const mossi = [...lontananza].filter(([, d]) => d > 1).map(([c, d]) => `${c} ${d.toFixed(1)}m`);
  dice(mossi.length > 0, 'qualcuno si alza e cammina davvero', mossi.join(', ') || 'nessuno');
  dice(visteGambe, 'e sta in piedi sulle sue gambe, alla giusta altezza');
  dice(nonDovevano.size === 0, 'chi deve stare al suo posto ci resta',
       [...nonDovevano].join('; '));
  dice(massimoInGiro <= IN_PIEDI_MAX, `mai piu' di ${IN_PIEDI_MAX} in piedi insieme`,
       `visti ${massimoInGiro}`);
  dice(massimoFuori <= FUORI_MAX, `mai piu' di ${FUORI_MAX} fuori posto insieme`,
       `visti ${massimoFuori}`);
  dice(fuori.length === 0, 'nessuno esce dalla stanza', fuori.slice(0, 3).join('; '));

  // Non basta che camminino: devono andare da qualche parte per un motivo.
  // Un ufficio dove tutti fanno la stessa cosa non e' vivo, e' un ciclo.
  dice(perche.size >= 2, 'si alzano per motivi diversi',
       [...perche.keys()].join(', ') || 'nessuno');
  dice(maxStesi <= 1, 'sul divano ci sta una persona sola', `visti ${maxStesi}`);
  dice(altezzeSbagliate.length === 0, 'chi e sdraiato sta sul divano, non per aria',
       altezzeSbagliate.slice(0, 2).join('; '));

  // Chi non lavora non resta immobile alla scrivania: si stiracchia, si
  // appoggia allo schienale, guarda il telefono, pensa. Erano cinque
  // agenti liberi su otto tutti nella stessa identica posa.
  dice(oziVisti.size >= 3, 'chi e fermo alla scrivania fa cose diverse',
       [...oziVisti].join(', ') || 'nessuna');
  dice(sedutiAltrove.size > 0, 'e c e chi va a sedersi da un altra parte',
       [...sedutiAltrove].slice(0, 2).join('; ') || 'nessuno');
  dice(errori.length === 0, 'nessun errore in pagina', errori.slice(0, 2).join(' | '));

  await page.screenshot({ path: path.join(BANCO, 'movimento.png') });
  await b.close();
  console.log(falliti ? `\n${falliti} controlli falliti\n` : '\nLa stanza si muove, e dice il vero.\n');
  process.exit(falliti ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
