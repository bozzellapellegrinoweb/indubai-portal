/**
 * Controlli sulla pagina della Regia che non hanno bisogno di un browser.
 *
 * Due sono qui per un motivo preciso: sono errori gia' successi, silenziosi,
 * e nessuno dei due fa fallire niente al momento in cui li scrivi.
 *
 *   1. display: flex (o grid) su una classe batte l'attributo hidden. Un
 *      elemento "nascosto" resta li', prende i clic o occupa spazio, e tu
 *      non capisci perche'. E' successo con .rg-fatica, che si mangiava i
 *      clic sulla scena, e con .rg-pan-piede, che lasciava la casella
 *      "Scrivi" in fondo a pannelli dove non si scrive a nessuno.
 *
 *   2. due elementi con lo stesso id: getElementById ne trova uno solo, e
 *      l'altro tasto non risponde. E' successo con rg-cam-reset.
 *
 *   node tests/regia-pagina.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'regia.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const corpo = html.slice(html.indexOf('<body'));

let passati = 0, falliti = 0;
const test = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${nome}`); passati++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${nome}\n      ${e.message}`); falliti++; }
};

console.log('\nControlli sulla pagina della Regia\n');

test('nessun id ripetuto', () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const doppi = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (doppi.length) throw new Error('id ripetuti: ' + [...new Set(doppi)].join(', '));
});

test('ogni elemento nascosto resta nascosto davvero', () => {
  const guai = [];
  // Un tag per volta: una sola espressione che cerca "hidden" dentro
  // <...> finisce per scavalcare il > di chiusura e raccogliere le classi
  // dell'elemento dopo. Mi e' successo scrivendo questo test.
  for (const tag_ of corpo.match(/<\w+[^>]*>/g) || []) {
    if (!/\shidden[\s>]/.test(tag_.replace(/aria-hidden/g, ''))) continue;
    const tag = tag_.match(/<(\w+)/)[1];
    const attr = tag_;
    const classi = (attr.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean);
    const id = (attr.match(/id="([^"]*)"/) || [])[1];
    const selettori = [...classi.map(c => '.' + c), ...(id ? ['#' + id] : [])];

    const imponeDisplay = selettori.some(s => {
      const re = new RegExp(s.replace(/[.#]/g, '\\$&') + '(?![\\w-])([^{]*)\\{([^}]*)\\}', 'g');
      return [...css.matchAll(re)].some(m =>
        /display\s*:/.test(m[2]) && !m[1].includes('[hidden]'));
    });
    const protetto = selettori.some(s => css.includes(`${s}[hidden]`));
    if (imponeDisplay && !protetto) {
      guai.push(`<${tag}${id ? ' #' + id : ''}>: il CSS gli impone un display e manca la regola [hidden]{display:none}`);
    }
  }
  if (guai.length) throw new Error(guai.join('\n      '));
});

test('la scala dei livelli non ha due piani uguali', () => {
  const livelli = [...css.matchAll(/--liv-([a-z]+)\s*:\s*(\d+)/g)].map(m => [m[1], Number(m[2])]);
  if (livelli.length < 3) throw new Error('la scala dei livelli non c\'e\' piu\'');
  const valori = livelli.map(l => l[1]);
  const doppi = valori.filter((x, i) => valori.indexOf(x) !== i);
  if (doppi.length) throw new Error('due livelli allo stesso piano: ' + livelli.map(l => l.join('=')).join(', '));
});

test('ogni elemento che il codice cerca per id esiste da qualche parte', () => {
  // Alcuni nascono nelle finestre costruite dal codice, quindi valgono
  // anche gli id scritti dentro il JavaScript. Quello che si vuole
  // scoprire e' l'id che non esiste da nessuna parte: $('rg-comandi')
  // rispondeva null perche' quel blocco aveva solo la classe.
  const ui = readFileSync(join(ROOT, 'js/regia-ui.js'), 'utf8');
  const cercati = [...ui.matchAll(/\$\('(rg-[a-z0-9-]+)'\)/g)].map(m => m[1]);
  const presenti = new Set([
    ...[...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]),
    ...[...ui.matchAll(/id="([^"${}]+)"/g)].map(m => m[1]),
    ...[...ui.matchAll(/\.id\s*=\s*'([^']+)'/g)].map(m => m[1]),
  ]);
  const mancanti = [...new Set(cercati)].filter(x => !presenti.has(x));
  if (mancanti.length) throw new Error('il codice li cerca ma non ci sono: ' + mancanti.join(', '));
});

test('i gestori dei clic hanno a chi attaccarsi', () => {
  // Un ascoltatore si attacca a un elemento trovato per classe. Se quella
  // classe non viene scritta da nessuna parte, querySelector risponde null,
  // non si attacca niente, e i tasti smettono di rispondere senza che
  // niente fallisca: e' il genere di errore che si scopre cliccando.
  const ui = readFileSync(join(ROOT, 'js/regia-ui.js'), 'utf8');
  const bersagli = [...ui.matchAll(/querySelector\('\.(rg-[a-z0-9-]+)'\)/g)].map(m => m[1]);
  const classi = new Set(
    [...ui.matchAll(/class="([^"${}]+)"/g), ...html.matchAll(/class="([^"]+)"/g)]
      .flatMap(m => m[1].split(/\s+/)));
  const mancanti = [...new Set(bersagli)].filter(c => !classi.has(c));
  if (mancanti.length) throw new Error('cercate ma mai scritte: ' + mancanti.join(', '));
});

test('ogni classe che il pannello usa ha uno stile', () => {
  // Una classe senza stile non rompe niente, si vede male e basta: che e'
  // il modo piu' facile per accorgersene tardi.
  const ui = readFileSync(join(ROOT, 'js/regia-ui.js'), 'utf8');
  const usate = new Set([...ui.matchAll(/class="(rg-foto[^"${}]*)"/g)]
    .flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('rg-foto')));
  const mancanti = [...usate].filter(c => !css.includes('.' + c));
  if (mancanti.length) throw new Error('senza stile: ' + mancanti.join(', '));
});

test('i video dell\'anteprima vanno in ordine di pagina', () => {
  // L'elenco arriva ordinato per created_at, ma i file di un rendering
  // nascono nello stesso secondo: l'ordine era quello del caso, e il
  // lettore prendeva comunque sempre il primo. Si vedeva una pagina sola.
  const ui = readFileSync(join(ROOT, 'js/regia-ui.js'), 'utf8');
  const sorgente = ui.slice(ui.indexOf('function videoInOrdine'),
                            ui.indexOf('function linguetteVideo'));
  const videoInOrdine = new Function(`${sorgente}; return videoInOrdine;`)();

  const m = (n) => ({ nome_file: `story_abc_${n}`, mime: 'video/mp4', ruolo: 'derivato' });
  const dati = [m(3), m(1), m(10), m(2)];
  const fuori = videoInOrdine(dati).map(x => x.nome_file.split('_').pop());
  if (fuori.join(',') !== '1,2,3,10') throw new Error('ordine: ' + fuori.join(','));

  const misti = [m(2), { mime: 'image/jpeg', nome_file: 'x_1', ruolo: 'derivato' },
                 { mime: 'video/mp4', nome_file: 'r_9', ruolo: 'reference' }, m(1)];
  const soli = videoInOrdine(misti);
  if (soli.length !== 2) throw new Error('immagini o reference passate: ' + soli.length);
});

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exit(falliti ? 1 : 0);
