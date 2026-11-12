const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errori = [];
  page.on('pageerror', e => errori.push('ECCEZIONE: ' + e.message));
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()); const s = SOST[u.pathname];
    if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
    if (u.hostname.includes('cloudinary')) return r.fulfill({ status: 200, contentType:'video/mp4', body: '' });
    r.continue();
  });
  await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Apre il contenuto dal fumetto del Grafico
  const guarda = page.locator('.regia-fumetto button', { hasText: 'Guarda' }).first();
  await guarda.click();
  await page.waitForTimeout(1200);

  const leggi = () => page.evaluate(() => {
    const v = document.getElementById('rg-video');
    const t = [...document.querySelectorAll('.rg-slide-strip [data-video]')];
    return { src: v ? (v.getAttribute('src')||'').split('/').pop() : null,
             linguette: t.length,
             scelta: t.findIndex(x => x.getAttribute('aria-current') === 'true'),
             etichette: t.map(x => x.textContent.trim().slice(0, 18)) };
  });

  console.log('all\'apertura:', JSON.stringify(await leggi()));
  for (const k of [2, 0, 1]) {
    const t = page.locator(`.rg-slide-strip [data-video="${k}"]`);
    if (await t.count() === 0) { console.log(`linguetta ${k}: non c'e'`); continue; }
    await t.click(); await page.waitForTimeout(600);
    console.log(`dopo la linguetta ${k}:`, JSON.stringify(await leggi()));
  }
  if (errori.length) console.log('ERRORI:', errori.slice(0,5).join(' | '));
  await page.screenshot({ path: path.join(BANCO, 'anteprima.png') });
  await b.close();
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
