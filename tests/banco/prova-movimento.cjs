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
const IN_GIRO_MAX = 2;
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

  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(2000);
    const ora = await leggi();
    if (!ora) break;
    let inGiro = 0;
    for (const a of ora) {
      const da = casa.get(a.id);
      if (!da) continue;
      const d = Math.hypot(a.mx - da.mx, a.mz - da.mz);
      lontananza.set(a.chi, Math.max(lontananza.get(a.chi) || 0, d));
      if (a.inGiro) inGiro++;
      // Chi lavora, chi ha la mano alzata e chi e' spento non si muove:
      // alzarsi racconterebbe una cosa che non e' vera.
      if (FERMI.includes(a.posa) && d > 0.6) nonDovevano.add(`${a.chi} (${a.posa}, ${d.toFixed(1)}m)`);
      if (Math.abs(a.mx) > MURO || Math.abs(a.mz) > MURO) fuori.push(`${a.chi} a (${a.mx},${a.mz})`);
      // In piedi vuol dire alzato da terra di 16 centimetri: e' la misura
      // che fa toccare le scarpe al pavimento con le gambe distese.
      if (a.inPiedi > 0.95) {
        visteGambe = true;
        if (Math.abs(a.my - 0.16) > 0.05) {
          nonDovevano.add(`${a.chi} in piedi ma a y=${a.my}`);
        }
      }
    }
    massimoInGiro = Math.max(massimoInGiro, inGiro);
  }

  const mossi = [...lontananza].filter(([, d]) => d > 1).map(([c, d]) => `${c} ${d.toFixed(1)}m`);
  dice(mossi.length > 0, 'qualcuno si alza e cammina davvero', mossi.join(', ') || 'nessuno');
  dice(visteGambe, 'e sta in piedi sulle sue gambe, alla giusta altezza');
  dice(nonDovevano.size === 0, 'chi deve stare al suo posto ci resta',
       [...nonDovevano].join('; '));
  dice(massimoInGiro <= IN_GIRO_MAX, `mai piu' di ${IN_GIRO_MAX} in giro insieme`,
       `visti ${massimoInGiro}`);
  dice(fuori.length === 0, 'nessuno esce dalla stanza', fuori.slice(0, 3).join('; '));
  dice(errori.length === 0, 'nessun errore in pagina', errori.slice(0, 2).join(' | '));

  await page.screenshot({ path: path.join(BANCO, 'movimento.png') });
  await b.close();
  console.log(falliti ? `\n${falliti} controlli falliti\n` : '\nLa stanza si muove, e dice il vero.\n');
  process.exit(falliti ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
