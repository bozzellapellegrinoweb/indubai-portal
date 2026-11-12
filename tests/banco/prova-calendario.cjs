/**
 * Il calendario, visto da fusi orari diversi.
 *
 * Il difetto: la chiave del giorno si ricavava con toISOString() da una
 * mezzanotte locale. In un fuso a est di Greenwich quella mezzanotte cade
 * nel giorno prima, quindi la casella che diceva "12/11" portava scritto
 * 11/11 e un contenuto lasciato su "oggi" finiva programmato a ieri.
 *
 *   node tests/banco/prova-calendario.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BANCO = __dirname;
const SOST = { '/js/supabase.js':'stub-supabase.js', '/js/app.js':'stub-app.js',
  '/js/notify.js':'stub-notify.js', '/js/regia-dati.js':'stub-regia-dati.js' };

const FUSI = ['Asia/Dubai', 'America/Los_Angeles', 'Europe/Rome', 'Pacific/Kiritimati'];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  let ko = 0;

  for (const fuso of FUSI) {
    const page = await b.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: fuso });
    await page.route('**/*', async r => {
      const u = new URL(r.request().url()); const s = SOST[u.pathname];
      if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
      r.continue();
    });
    await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.locator('#rg-tab-calendario, [data-vista="calendario"]').first().click().catch(() => {});
    await page.waitForTimeout(1200);

    const esito = await page.evaluate(() => {
      const oggi = document.querySelector('.rg-giorno.oggi');
      const dubai = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const passati = [...document.querySelectorAll('.rg-giorno')]
        .filter(g => g.dataset.giorno < dubai).length;
      return {
        chiave: oggi?.dataset.giorno ?? null,
        etichetta: oggi?.querySelector('.rg-giorno-et')?.textContent.trim() ?? null,
        giornoDubai: dubai,
        caselle: document.querySelectorAll('.rg-giorno').length,
        passatiSegnati: [...document.querySelectorAll('.rg-giorno.passato')].length,
        passatiVeri: passati,
      };
    });

    const giusto = esito.chiave === esito.giornoDubai;
    const [, m, g] = (esito.giornoDubai || '--').split('-');
    const etichettaGiusta = (esito.etichetta || '').endsWith(`${Number(g)}/${Number(m)}`);
    const passatiGiusti = esito.passatiSegnati === esito.passatiVeri;
    if (!giusto || !etichettaGiusta || !passatiGiusti) ko++;
    console.log(`${giusto && etichettaGiusta && passatiGiusti ? '  ok' : '  KO'}  ${fuso.padEnd(22)}` +
      ` oggi=${esito.chiave} (Dubai ${esito.giornoDubai}) etichetta="${esito.etichetta}"` +
      ` caselle=${esito.caselle} passati=${esito.passatiSegnati}/${esito.passatiVeri}`);
    await page.close();
  }

  await b.close();
  console.log(ko ? `\n${ko} fusi sbagliati su ${FUSI.length}\n`
                 : `\nIl giorno e' lo stesso da tutti i fusi: e' quello di Dubai.\n`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
