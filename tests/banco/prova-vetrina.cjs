/**
 * La vetrina: la Regia appesa a uno schermo in ufficio.
 *
 * Non e' la modalita' di lavoro. Qui davanti ci passa la gente, quindi:
 * niente linguette ne' filtri, la stanza grande, la camera che gira piano
 * da sola, e quello su cui si preme ancora vivo — i fumetti sopra gli
 * agenti e la striscia "Tocca a te".
 *
 *   node tests/banco/prova-vetrina.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };

let falliti = 0;
const dice = (ok, che, extra = '') => {
  console.log(`  ${ok ? 'ok ' : 'KO '} ${che}${extra ? '  ' + extra : ''}`);
  if (!ok) falliti++;
};

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  // La misura di uno schermo appeso, non di un portatile.
  const page = await b.newPage({ viewport: { width:1920, height:1080 }, timezoneId:'Asia/Dubai' });
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

  const scenaPrima = await page.evaluate(() => {
    const r = document.getElementById('rg-palco').getBoundingClientRect();
    return Math.round(r.width * r.height);
  });

  await page.locator('#rg-vetrina').click();
  await page.waitForTimeout(1600);

  const v = await page.evaluate(() => {
    const vis = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 0;
    };
    const p = document.getElementById('rg-palco').getBoundingClientRect();
    return {
      classe: document.body.classList.contains('rg-vetrina'),
      area: Math.round(p.width * p.height),
      pezzo: +(p.width * p.height / (innerWidth * innerHeight)).toFixed(2),
      linguette: vis('.rg-barra'),
      stato: vis('#rg-stato'),
      tocca: vis('#rg-tocca'),
      fascia: vis('#rg-fascia-agenti'),
      menu: getComputedStyle(document.querySelector('.main-content')).marginLeft,
      scroll: document.body.scrollHeight - innerHeight,
      esci: vis('#rg-esci-vetrina'),
    };
  });

  dice(v.classe, 'la vetrina e accesa');
  dice(v.linguette === false, 'niente linguette ne filtri: non e una schermata da usare');
  dice(v.stato === true, 'resta scritto chi c e e cosa sta facendo');
  dice(v.tocca === true, 'resta la striscia delle cose da fare');
  dice(v.fascia === true, 'restano le fasce: chi e in sala e come va la settimana');
  dice(v.menu === '0px', 'il menu del portale non occupa spazio');
  dice(v.scroll <= 4, 'la pagina non scorre', `${v.scroll}px`);
  dice(v.esci === true, 'c e un modo per uscirne');
  dice(v.area > scenaPrima * 1.3, 'la stanza e molto piu grande di prima',
       `${scenaPrima} -> ${v.area} (${(v.pezzo * 100).toFixed(0)}% dello schermo)`);

  // La camera gira da sola, piano. Nel banco non si puo' entrare in
  // fullscreen vero (serve un gesto), ma il giro e' indipendente da quello.
  const a = await page.evaluate(() => window.regiaScena?.dovEGuarda?.());
  await page.waitForTimeout(12000);
  const bq = await page.evaluate(() => window.regiaScena?.dovEGuarda?.());
  const girato = a && bq ? Math.abs(bq.theta - a.theta) : 0;
  dice(girato > 0.1, 'la camera si muove da sola', `${girato.toFixed(3)} rad in 12s`);
  // Un grado e mezzo al secondo: oltre i tre gradi diventa una giostra.
  dice(girato < 0.75, 'ma piano, non e una giostra', `${(girato / 12 * 57.3).toFixed(1)} gradi al secondo`);

  // Si preme ancora: e' il punto di avere uno schermo in ufficio.
  const tasti = await page.locator('.regia-fumetto button').count();
  dice(tasti > 0, 'i fumetti degli agenti restano premibili', `${tasti} tasti`);

  await page.locator('#rg-esci-vetrina').click();
  await page.waitForTimeout(700);
  dice(!(await page.evaluate(() => document.body.classList.contains('rg-vetrina'))),
       'e si esce davvero');
  dice(errori.length === 0, 'nessun errore in pagina', errori.slice(0, 2).join(' | '));

  await b.close();
  console.log(falliti ? `\n${falliti} controlli falliti\n` : '\nLa vetrina si puo appendere al muro.\n');
  process.exit(falliti ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
