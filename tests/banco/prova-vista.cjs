const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };
(async () => {
  const vista = process.argv[2] || 'calendario';
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Dubai' });
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()); const s = SOST[u.pathname];
    if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
    r.continue();
  });
  await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.locator(`[data-vista="${vista}"]`).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(BANCO, `vista-${vista}.png`), fullPage: true });
  console.log('fatto:', vista);
  await b.close();
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
