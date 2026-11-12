/**
 * Apre ogni pannello della Regia e guarda se qualcosa esplode.
 * Un pannello che solleva un errore in console non fallisce da solo:
 * resta mezzo disegnato e l'utente non capisce perche'.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };

const TASTI = [
  ['Direzione', '#rg-btn-direzione'],
  ['Cervello', '#rg-btn-cervello'],
  ['Le tue foto', '#rg-btn-avatar'],
  ['Newsletter', '#rg-btn-newsletter'],
];
const VISTE = [['Calendario','[data-vista="calendario"]'], ['Risultati','[data-vista="risultati"]'],
               ['Sala','[data-vista="sala"]']];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 }, timezoneId: 'Asia/Dubai' });
  const errori = [];
  page.on('pageerror', e => errori.push('[eccezione] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errori.push('[console] ' + m.text().slice(0, 160)); });
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()); const s = SOST[u.pathname];
    if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
    if (u.hostname.includes('cloudinary')) return r.fulfill({ status:200, contentType:'video/mp4', body:'' });
    r.continue();
  });
  await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2800);

  let ko = 0;
  const conta = (nome) => {
    if (errori.length) { ko++; console.log(`  KO  ${nome}: ${errori.join(' | ')}`); errori.length = 0; }
    else console.log(`  ok  ${nome}`);
  };

  for (const [nome, sel] of VISTE) {
    await page.click(sel); await page.waitForTimeout(900); conta('vista ' + nome);
  }
  for (const [nome, sel] of TASTI) {
    await page.click(sel); await page.waitForTimeout(1100);
    const aperto = await page.locator('#rg-pan-titolo').textContent().catch(() => '');
    await page.click('#rg-pan-chiudi').catch(() => {});
    await page.waitForTimeout(400);
    conta(`pannello ${nome} (titolo: "${(aperto || '').trim()}")`);
  }
  // Il contenuto, con il tasto Butta
  await page.locator('.regia-fumetto button', { hasText: 'Guarda' }).first().click().catch(() => {});
  await page.waitForTimeout(1300);
  const butta = await page.locator('#rg-butta').count();
  conta(`pannello Contenuto (tasto Butta: ${butta ? 'c\'e\'' : 'MANCA'})`);
  if (!butta) ko++;

  // ── Dove esce ──────────────────────────────────────────
  // Si vede dove andra' a finire, e si puo' cambiare. La colonna
  // piattaforme e' rimasta morta per mesi proprio perche' nessuna
  // schermata la mostrava.
  await page.waitForTimeout(700);
  const dove = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[data-piat]')];
    return t.map((b) => ({
      id: b.dataset.piat,
      scelta: b.getAttribute('aria-pressed') === 'true',
      nota: b.querySelector('.rg-piat-nota')?.textContent?.trim(),
      collegato: !b.classList.contains('non-collegato'),
    }));
  });
  if (dove.length !== 5) { ko++; console.log(`  KO  dove esce: ${dove.length} piattaforme`); }
  else {
    const ig = dove.find(d => d.id === 'instagram');
    const tk = dove.find(d => d.id === 'tiktok');
    const ok = ig?.scelta && ig?.collegato && ig?.nota === 'indubait'
            && tk?.collegato && !tk?.scelta;
    if (!ok) { ko++; console.log(`  KO  dove esce: ${JSON.stringify(dove)}`); }
    else console.log(`  ok  dove esce (${dove.filter(d => d.scelta).map(d => d.id).join(', ')}`
      + `; collegati: ${dove.filter(d => d.collegato).length}/5)`);
  }
  // Un clic cambia davvero la scelta.
  await page.locator('[data-piat="linkedin"]').click();
  await page.waitForTimeout(900);
  const dopo = await page.evaluate(() =>
    [...document.querySelectorAll('[data-piat]')]
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.piat));
  if (!dopo.includes('linkedin')) {
    ko++; console.log(`  KO  il clic non ha aggiunto LinkedIn: ${dopo.join(', ')}`);
  } else console.log(`  ok  si puo' cambiare (${dopo.join(', ')})`);

  await b.close();
  console.log(ko ? `\n${ko} pannelli con problemi\n` : '\nTutti i pannelli si aprono puliti.\n');
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
