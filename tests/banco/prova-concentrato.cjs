/**
 * "Schermo intero": la Regia si prende tutta la pagina.
 *
 * Misura quello che si guadagna e verifica le tre cose che prima erano
 * rotte: la barra della Zona che restava accesa fuori dalla Sala, il
 * lettore video senza tetto d'altezza, il pannello laterale fisso a 480
 * pixel su qualunque schermo.
 *
 *   node tests/banco/prova-concentrato.cjs
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

const MISURE = [{ width: 1366, height: 768 }, { width: 1440, height: 900 },
                { width: 1920, height: 1080 }];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });

  for (const viewport of MISURE) {
    const page = await b.newPage({ viewport, timezoneId: 'Asia/Dubai' });
    await page.route('**/*', async r => {
      const u = new URL(r.request().url()); const s = SOST[u.pathname];
      if (s) return r.fulfill({ contentType:'application/javascript', body: fs.readFileSync(path.join(BANCO,s),'utf8') });
      r.continue();
    });
    await page.goto('http://127.0.0.1:8099/regia.html', { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(2500);

    const etichetta = `${viewport.width}x${viewport.height}`;
    console.log(`\n${etichetta}`);

    const scena = () => page.evaluate(() => {
      const r = document.getElementById('rg-palco').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) };
    });

    const prima = await scena();
    await page.locator('#rg-solo').click();
    await page.waitForTimeout(400);
    const dopo = await scena();

    const areaPrima = prima.w * prima.h, areaDopo = dopo.w * dopo.h;
    const finestra = viewport.width * viewport.height;
    // Non basta "cresce di una percentuale": premierebbe anche un passaggio
    // da minuscolo a piccolo. E non basta l'area: su un portatile a 1366
    // la pagina normale da' alla scena 1054x360, che e' grande ma e' una
    // striscia 3:1 — per una stanza isometrica e' la forma sbagliata, si
    // vedono i tavoli e non chi ci sta. Quindi tre condizioni: non
    // rimpicciolisce, vale almeno il 38 per cento della finestra, e non e'
    // una striscia.
    const formaPrima = prima.w / prima.h, formaDopo = dopo.w / dopo.h;
    dice(areaDopo >= areaPrima * 0.98 && areaDopo > finestra * 0.38
         && formaDopo < 2.2,
         'la scena non rimpicciolisce, vale almeno il 38% e non e una striscia',
         `${prima.w}x${prima.h} ${formaPrima.toFixed(2)}:1 `
         + `(${(areaPrima/finestra*100).toFixed(1)}%) -> `
         + `${dopo.w}x${dopo.h} ${formaDopo.toFixed(2)}:1 `
         + `(${(areaDopo/finestra*100).toFixed(1)}%)`);

    const stato = await page.evaluate(() => {
      const comandi = document.querySelector('.topbar-actions');
      const barra = document.querySelector('.rg-barra');
      return {
        classe: document.body.classList.contains('rg-solo'),
        premuto: document.getElementById('rg-solo').getAttribute('aria-pressed'),
        testo: document.getElementById('rg-solo').textContent,
        // I comandi della testata devono essere finiti dentro la barra
        // delle linguette, non duplicati e non persi.
        comandiNellaBarra: !!(comandi && barra && barra.contains(comandi)),
        quantiInterruttori: document.querySelectorAll('#rg-interruttore').length,
        margine: getComputedStyle(document.querySelector('.main-content')).marginLeft,
        testata: getComputedStyle(document.querySelector('.topbar')).display,
        scrollDiAvanzo: document.body.scrollHeight - window.innerHeight,
      };
    });
    dice(stato.classe, 'la pagina e in modalita concentrata');
    dice(stato.premuto === 'true', 'il tasto dice di esserlo');
    dice(/Esci/.test(stato.testo), 'e dice come si esce', stato.testo);
    dice(stato.comandiNellaBarra, 'il fermo d emergenza e raggiungibile');
    dice(stato.quantiInterruttori === 1, 'un interruttore solo, non due',
         `trovati ${stato.quantiInterruttori}`);
    dice(stato.margine === '0px', 'il menu del portale non occupa piu spazio', stato.margine);
    dice(stato.testata === 'none', 'la testata e via');
    dice(stato.scrollDiAvanzo <= 4, 'la pagina non scorre per pochi pixel',
         `${stato.scrollDiAvanzo}px`);

    await page.screenshot({ path: path.join(BANCO, `concentrato-${etichetta}.png`) });

    // Esc riporta indietro, ed e' l'ultimo gradino: col pannello aperto
    // deve chiudere il pannello e lasciare la modalita' dov'e'.
    await page.locator('#rg-btn-newsletter').click();
    await page.waitForTimeout(600);
    const larghezzaPan = await page.evaluate(() =>
      Math.round(document.getElementById('rg-pannello').getBoundingClientRect().width));
    const atteso = Math.min(Math.max(480, viewport.width * 0.42), 820);
    dice(Math.abs(larghezzaPan - atteso) < 2,
         'il pannello cresce con lo schermo', `${larghezzaPan}px su ${viewport.width}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const dopoEsc = await page.evaluate(() => ({
      pannello: document.getElementById('rg-pannello').classList.contains('aperto'),
      solo: document.body.classList.contains('rg-solo'),
    }));
    dice(!dopoEsc.pannello && dopoEsc.solo,
         'Esc chiude il pannello e non la modalita');
    await page.locator('[data-vista="sala"]').click();
    await page.waitForTimeout(500);

    // ── La stanza si legge e si preme ──────────────────────
    // Questo e' il controllo che mancava, e per questo il difetto e'
    // sopravvissuto: il fumetto e' l'unico punto della scena da cui si
    // avvia un'azione, e il suo tasto finiva sotto il fumetto di un altro
    // agente. Non e' una questione estetica: il tasto non si poteva
    // premere, quindi il 3D non si usava.
    const stanza = await page.evaluate(() => {
      const fumetti = [...document.querySelectorAll('.regia-fumetto')];
      return fumetti.map((f) => {
        const b = f.querySelector('button');
        const rb = b && b.getBoundingClientRect();
        const sopra = rb && document.elementFromPoint(rb.x + rb.width / 2, rb.y + rb.height / 2);
        const testo = f.querySelector('.rf-testo');
        const rt = testo && testo.getBoundingClientRect();
        return {
          chi: f.querySelector('.rf-nome')?.textContent || '?',
          // Misure rese, non di layout: la scala le cambia tutte.
          altezzaTasto: rb ? Math.round(rb.height) : null,
          suoIlTasto: !!(sopra && f.contains(sopra)),
          // L'altezza di una riga sta al testo come 1.35 a 1 (line-height).
          pixelTesto: rt && testo.textContent
            ? +(rt.height / (Math.round(rt.height / 18) || 1) / 1.35).toFixed(1) : null,
        };
      });
    });
    dice(stanza.length > 0, 'ci sono fumetti da controllare', `${stanza.length}`);
    for (const f of stanza) {
      dice(f.suoIlTasto, `il tasto di ${f.chi} si puo premere`,
           f.suoIlTasto ? '' : 'coperto da un altro fumetto');
      dice(f.altezzaTasto >= 24, `il tasto di ${f.chi} e abbastanza alto`,
           `${f.altezzaTasto}px`);
      if (f.pixelTesto !== null) {
        dice(f.pixelTesto >= 11, `il testo di ${f.chi} si legge`, `${f.pixelTesto}px`);
      }
    }
    const targhe = await page.evaluate(() =>
      [...document.querySelectorAll('.regia-targa')]
        .filter((t) => t.style.display !== 'none')
        .map((t) => t.querySelector('.rt-nome')?.textContent));
    dice(targhe.length > 0, 'gli agenti hanno un nome scritto nella stanza',
         targhe.slice(0, 3).join(', '));

    // I numeri della riga di stato devono tornare con quelli della fascia:
    // erano dieci soggetti per otto agenti, e l'agente con la mano alzata
    // era contato due volte.
    const conti = await page.evaluate(() => {
      const r = window.regiaDati?.riepilogo?.();
      const testa = document.getElementById('rg-fascia-agenti')?.textContent || '';
      const inSala = /IN SALA \((\d+)\)/i.exec(testa.replace(/\s+/g, ' '));
      return r ? { ...r, inSala: inSala ? Number(inSala[1]) : null } : null;
    });
    if (conti) {
      const somma = conti.domande + conti.lavorano + conti.inCoda + conti.liberi + conti.spenti;
      dice(somma === conti.totale, 'le persone contate fanno il totale',
           `${conti.domande}+${conti.lavorano}+${conti.inCoda}+${conti.liberi}`
           + `+${conti.spenti} = ${somma}, totale ${conti.totale}`);
      if (conti.inSala !== null) {
        dice(conti.inSala === conti.totale, 'e lo stesso numero della fascia',
             `fascia ${conti.inSala}, riga ${conti.totale}`);
      }
    }
    const zone = await page.evaluate(() =>
      [...document.querySelectorAll('.regia-zona')]
        .filter((z) => z.style.display !== 'none').map((z) => z.textContent));
    dice(zone.length > 0, 'le zone sono scritte sul pavimento', zone.join(', '));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    dice(!(await page.evaluate(() => document.body.classList.contains('rg-solo'))),
         'il secondo Esc esce dalla modalita');

    // La barra della Zona fuori dalla Sala: display:flex batteva hidden.
    for (const vista of ['calendario', 'risultati']) {
      await page.locator(`[data-vista="${vista}"]`).click();
      await page.waitForTimeout(400);
      const barra = await page.evaluate(() => {
        const e = document.getElementById('rg-barra-vista');
        const r = e.getBoundingClientRect();
        return { display: getComputedStyle(e).display, h: Math.round(r.height) };
      });
      dice(barra.display === 'none' && barra.h === 0,
           `niente comandi di zona in ${vista}`, `${barra.display} ${barra.h}px`);
    }

    // Il lettore: con un file 9:16 vero non deve mangiarsi la schermata.
    await page.locator('[data-vista="sala"]').click();
    await page.waitForTimeout(500);
    const tetto = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const p = document.createElement('div');
      p.className = 'rg-lettore';
      p.innerHTML = '<video></video>';
      document.body.appendChild(p);
      const v = getComputedStyle(p.querySelector('video'));
      const r = { maxH: v.maxHeight, w: v.width };
      p.remove();
      return r;
    });
    dice(tetto.maxH !== 'none', 'il lettore ha un tetto d altezza', tetto.maxH);

    await page.close();
  }

  await b.close();
  console.log(falliti ? `\n${falliti} controlli falliti\n` : '\nTutto in ordine.\n');
  process.exit(falliti ? 1 : 0);
})().catch(e => { console.error('KO:', e.message); process.exit(1); });
