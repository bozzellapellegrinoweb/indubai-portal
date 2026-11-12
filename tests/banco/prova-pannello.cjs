const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };
(async () => {
  const tasto = process.argv[2] || 'rg-btn-newsletter';
  const poi = process.argv[3];
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Dubai' });
  const errori = []; page.on('pageerror', e => errori.push(e.message));
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()); const s = SOST[u.pathname];
    if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
    r.continue();
  });
  await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.click('#' + tasto);
  await page.waitForTimeout(1200);
  if (poi) { await page.click(poi).catch(()=>{}); await page.waitForTimeout(1200); }
  await page.screenshot({ path: path.join(BANCO, `pannello-${tasto}.png`) });
  console.log('fatto.', errori.length ? 'ERRORI: ' + errori.join(' | ') : 'nessun errore');
  await b.close();
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
