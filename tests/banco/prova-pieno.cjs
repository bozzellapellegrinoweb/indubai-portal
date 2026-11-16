/**
 * La giornata piena, su uno schermo da scrivania.
 *
 * Il 16 novembre 2026 la Regia aveva diciotto cose in attesa: una domanda
 * lunga una pagina, tre contenuti fermati dal Revisore, la settimana
 * scoperta e tredici contenuti pronti. La striscia "Tocca a te" andava a
 * tre righe, si prendeva meta' schermo, e la stanza — l'unica cosa che si
 * guarda da lontano — restava una fascia di trecento pixel con sopra un
 * fumetto alto quanto lei.
 *
 * Diciotto cose da fare non sono un difetto: e' una giornata di lavoro.
 * Il difetto e' una striscia che cresce senza fermarsi. Questa prova
 * tiene fermo quel contratto:
 *
 *   - la striscia non supera una riga finche' non la si apre;
 *   - una tessera non diventa un muro di testo;
 *   - la stanza tiene almeno il 40% dell'altezza della finestra;
 *   - il fumetto non copre la stanza;
 *   - e tutte e diciotto restano raggiungibili.
 *
 * Si accende con window.__BANCO_GIORNATA = 'piena' prima del caricamento:
 * i dati finti stanno nel solito stub, non qui, se no sarebbero due finte
 * che divergono.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };

let falliti = 0;
const ok = (c, t, n) => { console.log(`  ${c ? 'ok ' : 'KO '} ${t}${n ? '  ' + n : ''}`); if (!c) falliti++; };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, timezoneId: 'Asia/Dubai' });
  const errori = [];
  page.on('pageerror', e => errori.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__BANCO_GIORNATA = 'piena'; });
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()); const s = SOST[u.pathname];
    if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
    r.continue();
  });
  await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3200);

  const misura = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (s) => { const e = q(s); return e ? e.getBoundingClientRect() : null; };
    const righe = q('#rg-tocca');
    const colonne = righe ? getComputedStyle(righe).gridTemplateColumns.split(' ').length : 0;
    const tessere = [...document.querySelectorAll('.rg-tessera')];
    const fumetti = [...document.querySelectorAll('.regia-fumetto')]
      .filter(e => e.style.display !== 'none');
    return {
      quante: tessere.length,
      colonne,
      strisciaAlta: righe ? Math.round(righe.getBoundingClientRect().height) : 0,
      tesseraPiuAlta: Math.max(0, ...tessere.map(e => Math.round(e.getBoundingClientRect().height))),
      palco: r('.rg-palco') ? Math.round(r('.rg-palco').height) : 0,
      finestra: window.innerHeight,
      scorre: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      fumettoPiuAlto: Math.max(0, ...fumetti.map(e => Math.round(e.getBoundingClientRect().height))),
      palcoAlto: r('.rg-palco') ? Math.round(r('.rg-palco').height) : 0,
      apri: q('#rg-tocca-apri') ? q('#rg-tocca-apri').textContent.trim() : null,
      conta: q('#rg-tocca-conta') ? q('#rg-tocca-conta').textContent.trim() : null,
    };
  });

  const m = await misura();
  console.log('\nLA GIORNATA PIENA, a 1920x1080\n');
  ok(m.conta === '18', 'la striscia dice quante sono', m.conta);
  ok(m.quante <= m.colonne, 'e ne mostra al massimo una riga',
     `${m.quante} tessere in ${m.colonne} colonne`);
  ok(m.strisciaAlta <= 190, 'la striscia non si mangia la pagina', m.strisciaAlta + 'px');
  ok(m.tesseraPiuAlta <= 170, 'nessuna tessera e un muro di testo', m.tesseraPiuAlta + 'px');
  ok(!!m.apri, 'c e un modo per vedere le altre', m.apri);
  ok(m.palco >= m.finestra * 0.4, 'la stanza tiene la sua altezza',
     `${m.palco}px su ${m.finestra} (${Math.round(m.palco / m.finestra * 100)}%)`);
  ok(m.scorre <= 40, 'la pagina sta in una schermata', m.scorre + 'px di scorrimento');
  ok(m.fumettoPiuAlto > 0 && m.fumettoPiuAlto <= m.palcoAlto * 0.62,
     'il fumetto non copre la stanza',
     `${m.fumettoPiuAlto}px su ${m.palcoAlto}`);

  // Le altre si raggiungono.
  if (m.apri) {
    await page.click('#rg-tocca-apri');
    await page.waitForTimeout(500);
    const d = await misura();
    ok(d.quante === 18, 'aprendola ci sono tutte e diciotto', String(d.quante));
    ok(!!d.apri && /chiudi|solo/i.test(d.apri), 'e si richiude', d.apri);
    await page.click('#rg-tocca-apri');
    await page.waitForTimeout(500);
    const c = await misura();
    ok(c.quante <= c.colonne, 'richiusa torna a una riga', String(c.quante));
  }

  // Le urgenti vengono prima: una domanda e tre fermati dal Revisore non
  // possono stare sotto tredici "pronto da approvare".
  const primi = await page.$$eval('.rg-tessera', els =>
    els.slice(0, 4).map(e => e.className.includes('urgente') ? 'urgente' : 'normale'));
  ok(primi.every(x => x === 'urgente'), 'le urgenti stanno davanti', primi.join(', '));

  // Nessun cartellino sotto un fumetto: mezzo nome non dice niente.
  const coperti = await page.evaluate(() => {
    const vive = (e) => e.style.display !== 'none' && e.getBoundingClientRect().width > 0;
    const targhe = [...document.querySelectorAll('.regia-targa')].filter(vive);
    const fumetti = [...document.querySelectorAll('.regia-fumetto')].filter(vive);
    const tocca = (a, b) => !(a.right <= b.left || a.left >= b.right
                           || a.bottom <= b.top || a.top >= b.bottom);
    return targhe.filter(t => fumetti.some(f =>
      tocca(t.getBoundingClientRect(), f.getBoundingClientRect())))
      .map(t => t.querySelector('.rt-nome')?.textContent);
  });
  ok(coperti.length === 0, 'nessun cartellino finisce sotto un fumetto',
     coperti.length ? coperti.join(', ') : 'nessuno');

  // E nessuno fuori dalla scena: spinto in basso da un fumetto alto, un
  // cartellino poteva uscire dal bordo.
  const fuori = await page.evaluate(() => {
    const palco = document.querySelector('.rg-palco').getBoundingClientRect();
    return [...document.querySelectorAll('.regia-targa')]
      .filter(e => e.style.display !== 'none')
      .filter(e => { const b = e.getBoundingClientRect();
                     return b.bottom > palco.bottom + 1 || b.top < palco.top - 1
                         || b.left < palco.left - 1 || b.right > palco.right + 1; })
      .map(e => e.querySelector('.rt-nome')?.textContent);
  });
  ok(fuori.length === 0, 'e nessuno esce dal riquadro',
     fuori.length ? fuori.join(', ') : 'nessuno');

  ok(errori.length === 0, 'nessun errore in pagina', errori.join(' | '));
  await page.screenshot({ path: path.join(BANCO, 'pieno.png') });
  await b.close();
  console.log(falliti ? `\n${falliti} controlli falliti.` : '\nLa giornata piena ci sta in una schermata.');
  process.exit(falliti ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
