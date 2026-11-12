/**
 * Apre la Regia in un browser vero, con dati finti al posto del database.
 * Serve a guardarla: la scena, il pannello, l'anteprima.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BANCO = __dirname;
const SOSTITUTI = {
  '/js/supabase.js': 'stub-supabase.js',
  '/js/app.js': 'stub-app.js',
  '/js/notify.js': 'stub-notify.js',
  '/js/regia-dati.js': 'stub-regia-dati.js',
};

(async () => {
  const larghezza = Number(process.argv[2]) || 1440;
  const altezza = Number(process.argv[3]) || 900;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ viewport: { width: larghezza, height: altezza }, deviceScaleFactor: 1 });

  const errori = [];
  page.on('console', m => { if (m.type() === 'error') errori.push(m.text()); if (m.text().includes('[SONDA]')) console.log(m.text()); });
  page.on('pageerror', e => errori.push('ECCEZIONE: ' + e.message));

  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    const s = SOSTITUTI[u.pathname];
    if (s) return route.fulfill({ contentType: 'application/javascript',
      body: fs.readFileSync(path.join(BANCO, s), 'utf8') });
    route.continue();
  });

  await page.goto('http://127.0.0.1:8099/regia.html' + (process.argv[4] ? '?' + process.argv[4] : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  const misure = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height),
        top: Math.round(b.top), left: Math.round(b.left) }; };
    return {
      finestra: { w: innerWidth, h: innerHeight },
      scena: r('#rg-scena'), canvas: r('#rg-scena canvas'),
      sala: r('.rg-sala') || r('#rg-sala'),
      scrollBody: document.body.scrollHeight,
      calma: (() => { const e = document.getElementById('rg-calma');
        return e ? { visibile: !e.hidden, testo: e.textContent.replace(/\s+/g,' ').trim().slice(0,110) } : null; })(),
      canvasC: document.querySelectorAll('#rg-scena canvas').length,
    };
  });
  console.log(JSON.stringify(misure, null, 1));
  if (errori.length) console.log('ERRORI:\n' + errori.slice(0, 12).join('\n'));

  await page.screenshot({ path: path.join(BANCO, `sala-${larghezza}x${altezza}${process.argv[4] ? '-' + process.argv[4].split('=')[0] : ''}.png`) });
  await browser.close();
})().catch(e => { console.error('BANCO KO:', e.message); process.exit(1); });
