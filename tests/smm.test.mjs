#!/usr/bin/env node
/**
 * Test della Regia SMM — le parti in cui un errore si paga.
 *
 * Gira su un PostgreSQL vero, non su mock: le policy RLS e i trigger sono
 * codice del database, e un mock non li esegue. Il banco di prova
 * (tests/smm/00_harness.sql) ricostruisce il minimo del portale che la
 * migrazione presuppone, poi si applicano le migrazioni vere e si prova.
 *
 *   node tests/smm.test.mjs
 *
 * Variabili d'ambiente:
 *   PGHOST  socket o host (default: cerca una socket locale)
 *   PGPORT  porta (default 5433)
 *   PGUSER  utente (default postgres)
 *
 * Se non trova un PostgreSQL, il test lo dice e si ferma con esito 0: non
 * fallisce il CI di chi non ha un database a portata di mano.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'smm_test_' + Math.random().toString(36).slice(2, 8);

const PSQL = ['/usr/lib/postgresql/16/bin/psql', '/usr/bin/psql', 'psql']
  .find(p => p === 'psql' || existsSync(p)) || 'psql';

const HOST = process.env.PGHOST || '/var/lib/postgresql/smmsock';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';

function psql(db, args, input) {
  return execFileSync(PSQL, ['-h', HOST, '-p', PORT, '-U', USER, '-d', db,
                             '-v', 'ON_ERROR_STOP=1', '-q', ...args],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

// ── Esecuzione di una query, righe come array di array ──────
function q(sql) {
  const out = psql(DB, ['-tA', '-F', '\u0001', '-c', sql]);
  return out.trim() === '' ? [] : out.trim().split('\n').map(r => r.split('\u0001'));
}
function one(sql) { const r = q(sql); return r.length ? r[0][0] : null; }

/** Esegue SQL che deve fallire, e restituisce il messaggio d'errore. */
function mustFail(sql, attesa) {
  let msg = null;
  try { psql(DB, ['-c', sql]); }
  catch (e) { msg = ((e.stderr || '') + (e.stdout || '')).trim(); }
  if (msg === null) throw new Error(`doveva fallire e non e' fallito:\n  ${sql}`);
  if (attesa && !msg.toLowerCase().includes(attesa.toLowerCase())) {
    throw new Error(`e' fallito per il motivo sbagliato.\n  atteso: ${attesa}\n  avuto:  ${msg.split('\n')[0]}`);
  }
  return msg;
}

// ── Mini runner ─────────────────────────────────────────────
let passati = 0, falliti = 0;
const soloQuesto = process.argv[2];

function test(nome, fn) {
  if (soloQuesto && !nome.includes(soloQuesto)) return;
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${nome}`); passati++; }
  catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${nome}`);
    console.log(`      ${String(e.message).split('\n').join('\n      ')}`);
    falliti++;
  }
}
function gruppo(nome) { console.log(`\n\x1b[1m${nome}\x1b[0m`); }
function eq(avuto, atteso, che = '') {
  if (String(avuto) !== String(atteso)) {
    throw new Error(`${che || 'valore'}: atteso ${JSON.stringify(atteso)}, avuto ${JSON.stringify(avuto)}`);
  }
}
function vero(x, che) { if (!(x === true || x === 't' || x === 'true')) throw new Error(`${che}: atteso vero, avuto ${JSON.stringify(x)}`); }
function falso(x, che) { if (x === true || x === 't' || x === 'true') throw new Error(`${che}: atteso falso, avuto ${JSON.stringify(x)}`); }

// ── Preparazione ────────────────────────────────────────────
console.log('Test della Regia SMM\n');

try {
  psql('postgres', ['-c', `create database ${DB}`]);
} catch (e) {
  console.log('Nessun PostgreSQL raggiungibile su ' + HOST + ':' + PORT + '.');
  console.log('Il test ha bisogno di un database vero: le policy RLS e i trigger');
  console.log('sono codice del database e un mock non li esegue.\n');
  console.log('Per farlo partire in locale:');
  console.log('  initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-p 5433 -k /tmp" start\n');
  process.exit(0);
}

const PULIZIA = () => { try { psql('postgres', ['-c', `drop database if exists ${DB}`]); } catch {} };
process.on('exit', PULIZIA);

try {
  psql(DB, ['-f', join(ROOT, 'tests/smm/00_harness.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261110_ruolo_smm.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261110_smm_regia.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261110_smm_seed.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261111_smm_direzione.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261111_smm_motore.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_knowledge_intera.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_brief_copywriter.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_cervello_quote.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_montaggio_automatico.sql')]);
  // La pianificazione vive in una migrazione a parte perche' ha bisogno di
  // pg_cron e pg_net. Sul banco di prova quelli non ci sono: si prende solo
  // la funzione che mette in coda le uscite arrivate a scadenza, che e' la
  // parte da provare.
  psql(DB, ['-f', join(ROOT, 'tests/smm/10_cron_senza_estensioni.sql')]);
} catch (e) {
  console.error('Le migrazioni non si applicano:\n' + (e.stderr || e.stdout || e.message));
  process.exit(1);
}

// Utenti di prova. Gli id sono fissi per poterli citare nelle query.
const ADMIN   = '11111111-1111-1111-1111-111111111111';
const MANAGER = '22222222-2222-2222-2222-222222222222';
const JUNIOR  = '33333333-3333-3333-3333-333333333333';

psql(DB, ['-c', `
  insert into profiles (id, full_name, role) values
    ('${ADMIN}',   'Pellegrino', 'admin'),
    ('${MANAGER}', 'Social Media Manager', 'smm'),
    ('${JUNIOR}',  'Contabile Junior', 'junior');
`]);

const BRAND = one(`select id from smm_brands where slug = 'indubai'`);

/** Query eseguita impersonando un utente, con RLS attiva. */
function come(uid, sql) {
  const out = psql(DB, ['-tA', '-F', '\u0001', '-c',
    `set role authenticated; set local test.uid = '${uid}'; ${sql}`]);
  return out.trim() === '' ? [] : out.trim().split('\n').map(r => r.split('\u0001'));
}
function comeUno(uid, sql) { const r = come(uid, sql); return r.length ? r[0][0] : null; }
function comeFallisce(uid, sql, attesa) {
  return mustFail(`set role authenticated; set local test.uid = '${uid}'; ${sql}`, attesa);
}

/** Crea un contenuto pronto per la revisione. Restituisce l'id. */
function nuovoContenuto(opts = {}) {
  const {
    titolo = 'Corporate Tax: la soglia che tutti sbagliano',
    caption = 'La Corporate Tax negli Emirati e al 9 per cento sopra 375.000 AED. Approfondisci su InDubai.it',
    categoria = 'normativa', sensibile = false, stato = 'in_lavorazione',
  } = opts;
  return one(`
    insert into smm_contents (brand_id, titolo, caption, categoria, sensibile, stato, created_by)
    values ('${BRAND}', $$${titolo}$$, $$${caption}$$, '${categoria}', ${sensibile}, '${stato}', '${MANAGER}')
    returning id`);
}

// ============================================================
gruppo('Permessi: li fa rispettare il database, non il menu');

test('il manager con ruolo smm vede la Regia', () => {
  vero(comeUno(MANAGER, `select can_see_smm()`), 'can_see_smm per smm');
});

test("l'admin vede la Regia sempre, senza configurazione", () => {
  vero(comeUno(ADMIN, `select can_see_smm()`), 'can_see_smm per admin');
});

test('un contabile junior non vede la Regia', () => {
  falso(comeUno(JUNIOR, `select can_see_smm()`), 'can_see_smm per junior');
});

test('chi non vede la Regia non legge gli agenti, nemmeno via API', () => {
  eq(comeUno(JUNIOR, `select count(*) from smm_agents`), '0', 'agenti letti da junior');
  eq(comeUno(MANAGER, `select count(*) from smm_agents`), '8', 'agenti letti dal manager');
});

test('chi non vede la Regia non legge i contenuti', () => {
  nuovoContenuto({ titolo: 'Contenuto riservato alla Regia' });
  eq(comeUno(JUNIOR, `select count(*) from smm_contents`), '0', 'contenuti letti da junior');
});

test('chi non vede la Regia non scrive nemmeno', () => {
  comeFallisce(JUNIOR,
    `insert into smm_contents (brand_id, titolo) values ('${BRAND}', 'intruso')`,
    'row-level security');
});

test('concedere la pagina dalla matrice da accesso al junior', () => {
  psql(DB, ['-c', `insert into role_permissions (role, allowed_pages)
                   values ('junior', array['index','regia'])
                   on conflict (role) do update set allowed_pages = excluded.allowed_pages`]);
  vero(comeUno(JUNIOR, `select can_see_smm()`), 'can_see_smm dopo la concessione');
  eq(comeUno(JUNIOR, `select count(*) from smm_agents`), '8', 'agenti dopo la concessione');
});

test('togliere la pagina dalla matrice revoca l accesso', () => {
  psql(DB, ['-c', `update role_permissions set allowed_pages = array['index']
                   where role = 'junior'`]);
  falso(comeUno(JUNIOR, `select can_see_smm()`), 'can_see_smm dopo la revoca');
  eq(comeUno(JUNIOR, `select count(*) from smm_agents`), '0', 'agenti dopo la revoca');
});

test('una configurazione vuota vale "tutte le pagine", come in app.js', () => {
  psql(DB, ['-c', `update role_permissions set allowed_pages = '{}' where role = 'junior'`]);
  vero(comeUno(JUNIOR, `select can_see_smm()`), 'array vuoto = tutte le pagine');
  psql(DB, ['-c', `delete from role_permissions where role = 'junior'`]);
});

test('il budget e l interruttore li cambia solo l admin', () => {
  // Su UPDATE la RLS non solleva un errore: filtra le righe, e la modifica
  // tocca zero righe. E' la stessa trappola raccontata in
  // 20261016_permessi_utenti.sql, dove un admin cambiava il ruolo di
  // qualcuno, riceveva 200 con zero righe toccate e il portale diceva
  // "aggiornato". Quindi qui non si verifica l'errore: si verifica che non
  // sia cambiato niente. Nell'interfaccia quei comandi li vede solo l'admin,
  // e dopo un salvataggio si rilegge il valore invece di fidarsi.
  const tocche = comeUno(MANAGER,
    `with u as (update smm_settings set stop_tutto = true
                 where brand_id = '${BRAND}' returning 1)
     select count(*) from u`);
  eq(tocche, '0', 'righe toccate dal manager');
  falso(one(`select stop_tutto from smm_settings where brand_id = '${BRAND}'`),
        'interruttore dopo il tentativo del manager');

  // l'admin si', e il manager lo legge
  const tocche2 = comeUno(ADMIN,
    `with u as (update smm_settings set budget_giorno_usd = 12
                 where brand_id = '${BRAND}' returning 1)
     select count(*) from u`);
  eq(tocche2, '1', 'righe toccate dall admin');
  eq(comeUno(MANAGER, `select budget_giorno_usd from smm_settings where brand_id = '${BRAND}'`),
     '12.0000', 'budget letto dal manager');
});

test('un contenuto di un altro brand non si legge se non si vede la Regia', () => {
  // La RLS filtra, non spiega: verificare "zero righe" e' l'unico modo
  // onesto di provarlo su SELECT.
  eq(comeUno(JUNIOR, `select count(*) from smm_settings`), '0', 'impostazioni lette da junior');
});

// ============================================================
gruppo('Non si pubblica senza approvazione');

test('senza il via libera del Revisore non si va in approvazione', () => {
  const c = nuovoContenuto();
  mustFail(`update smm_contents set stato = 'da_approvare' where id = '${c}'`,
           'Revisore di conformit');
});

test('col via libera del Revisore si va in approvazione', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set revisore_ok = true, revisore_at = now() where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'da_approvare', 'stato');
});

test('non si pubblica un contenuto che il Revisore non ha passato', () => {
  const c = nuovoContenuto();
  mustFail(`update smm_contents set stato = 'programmato',
              approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`,
           'che il Revisore non ha passato');
});

test('non si pubblica senza un approvazione umana registrata', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  mustFail(`update smm_contents set stato = 'programmato' where id = '${c}'`,
           'approvazione umana registrata');
});

test('con revisione e approvazione si programma', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents
                      set stato = 'programmato', approvato_da = '${MANAGER}',
                          approvato_at = now(), slot_at = now() + interval '1 day'
                    where id = '${c}'`]);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'programmato', 'stato');
});

test('lo stesso vale per "pubblicato", non solo per "programmato"', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  mustFail(`update smm_contents set stato = 'pubblicato' where id = '${c}'`,
           'approvazione umana registrata');
});

test('non si approva saltando il Revisore', () => {
  // Il presidio guardava solo il passaggio a "da_approvare": passando
  // direttamente ad "approvato" si scavalcava. La pubblicazione restava
  // bloccata piu' avanti, ma lo stato diceva una cosa falsa.
  const c = nuovoContenuto({ stato: 'respinto' });
  mustFail(`update smm_contents set stato = 'approvato',
              approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`,
           'Revisore di conformit');
});

test('un agente non puo firmare l approvazione a nome del manager', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  comeFallisce(MANAGER,
    `update smm_contents set approvato_da = '${ADMIN}', approvato_at = now() where id = '${c}'`,
    'firmata da chi la sta dando');
});

// ============================================================
gruppo('Secondo livello di approvazione sulle categorie sensibili');

test('spento, una categoria sensibile si pubblica con la sola firma del manager', () => {
  const c = nuovoContenuto({ categoria: 'normativa' });
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'programmato',
                     approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`]);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'programmato', 'stato');
});

test('acceso, una categoria sensibile chiede anche l admin', () => {
  psql(DB, ['-c', `update smm_settings set doppia_approvazione = true where brand_id = '${BRAND}'`]);
  const c = nuovoContenuto({ categoria: 'normativa' });
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  mustFail(`update smm_contents set stato = 'programmato',
              approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`,
           'seconda approvazione');
});

test('acceso, una categoria non sensibile passa comunque', () => {
  const c = nuovoContenuto({ categoria: 'lifestyle' });
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'programmato',
                     approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`]);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'programmato', 'stato');
});

test('la seconda approvazione la da solo un admin', () => {
  const c = nuovoContenuto({ categoria: 'normativa' });
  comeFallisce(MANAGER,
    `update smm_contents set approvato_admin_da = '${MANAGER}', approvato_admin_at = now()
      where id = '${c}'`,
    'solo un amministratore');
});

test('con le due firme la categoria sensibile si programma', () => {
  const c = nuovoContenuto({ categoria: 'normativa' });
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  come(ADMIN, `update smm_contents set approvato_admin_da = '${ADMIN}',
                 approvato_admin_at = now() where id = '${c}'`);
  come(MANAGER, `update smm_contents set stato = 'programmato',
                   approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'programmato', 'stato');
  psql(DB, ['-c', `update smm_settings set doppia_approvazione = false where brand_id = '${BRAND}'`]);
});

// ============================================================
gruppo('Il Revisore sulle parole vietate: due reti, non una');

const VIETATI = [
  ['avvocato nel testo',        'Parla con il nostro avvocato di fiducia'],
  ['studio legale nel testo',   'Siamo uno studio legale a Dubai'],
  ['studiolegale come hashtag', 'Contenuto pulito. #dubai #studiolegale'],
  ['lawyer in inglese',         'Our lawyer will help you'],
  ['law firm in inglese',       'A top law firm in the UAE'],
  ['consulente legale',         'Il consulente legale ti assiste'],
  ['avv. abbreviato',           'Scritto da Avv. Rossi'],
  ['studio.legale con il punto','Contatta studio.legale Rossi'],
];

for (const [che, testo] of VIETATI) {
  test(`la funzione riconosce: ${che}`, () => {
    const n = one(`select cardinality(smm_termini_vietati($$${testo}$$))`);
    if (Number(n) < 1) throw new Error(`non ha trovato niente in: ${testo}`);
  });
}

test('non segnala falsi positivi su testo corretto', () => {
  const ok = [
    'Consulente fiscale e societario specializzato negli Emirati',
    'Lo studio del commercialista apre alle nove',
    'Strutturazione societaria e redazione di contratti commerciali',
    'La legale rappresentante della societa ha firmato',
  ];
  for (const t of ok) {
    const n = one(`select cardinality(smm_termini_vietati($$${t}$$))`);
    eq(n, '0', `falso positivo su: ${t}`);
  }
});

test('il via libera del Revisore non si registra se c e una parola vietata', () => {
  const c = nuovoContenuto({ caption: 'Il nostro studio legale ti assiste a Dubai' });
  mustFail(`update smm_contents set revisore_ok = true where id = '${c}'`,
           'Termini vietati');
});

test('la parola vietata viene trovata anche dentro le slide', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set slides =
    '[{"type":"standard","title":"Chi siamo","body":"Un avvocato al tuo fianco"}]'::jsonb
    where id = '${c}'`]);
  mustFail(`update smm_contents set revisore_ok = true where id = '${c}'`, 'Termini vietati');
});

test('la parola vietata viene trovata anche negli hashtag', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set hashtags = array['#dubai','#studiolegale']
                   where id = '${c}'`]);
  mustFail(`update smm_contents set revisore_ok = true where id = '${c}'`, 'Termini vietati');
});

test('un contenuto pulito ottiene il via libera', () => {
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set slides =
    '[{"type":"standard","title":"La soglia","body":"Nove per cento sopra 375.000 AED"}]'::jsonb,
      hashtags = array['#dubai','#fiscalita'] where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  vero(one(`select revisore_ok from smm_contents where id = '${c}'`), 'revisore_ok');
});

test('in bozza una parola vietata non blocca la scrittura', () => {
  // Durante il lavoro un testo puo' contenere qualsiasi cosa: il presidio
  // scatta al via libera, non a ogni salvataggio.
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set caption = 'bozza con avvocato dentro' where id = '${c}'`]);
  eq(one(`select caption like '%avvocato%' from smm_contents where id = '${c}'`), 't', 'bozza salvata');
});

// ============================================================
gruppo('Il Cervello');

test('il seed ha caricato le regole con le fonti', () => {
  eq(one(`select count(*) from smm_brain where tipo = 'regola'`), '113', 'regole');
  eq(one(`select count(*) from smm_brain where tipo = 'regola' and fonte is null`), '0',
     'regole senza fonte');
});

test('le regole vincolanti sono marcate', () => {
  const n = Number(one(`select count(*) from smm_brain where vincolante`));
  if (n < 40) throw new Error(`troppe poche regole vincolanti: ${n}`);
});

test('la ricerca per rilevanza trova per argomento', () => {
  const r = come(MANAGER,
    `select codice from smm_cervello_cerca('${BRAND}', 'golden visa investimento minimo', array['regola'], 6)`);
  const codici = r.map(x => x[0]);
  if (!codici.some(c => c && c.startsWith('R-FACT-0'))) {
    throw new Error('non ha trovato le regole sul Golden Visa: ' + codici.join(','));
  }
});

test('le regole vincolanti arrivano anche se la ricerca non le cita', () => {
  const r = come(MANAGER,
    `select codice, vincolante from smm_cervello_cerca('${BRAND}', 'lifestyle costo della vita', array['regola'], 80)`);
  if (!r.some(x => x[1] === 't')) {
    throw new Error('nessuna regola vincolante nei risultati');
  }
});

test('la ricerca trova anche per tag', () => {
  const r = come(MANAGER,
    `select codice from smm_cervello_cerca('${BRAND}', 'termini-vietati', array['regola'], 10)`);
  if (!r.some(x => x[0] === 'R-QUAL-02')) {
    throw new Error('il tag termini-vietati non ha portato R-QUAL-02');
  }
});

test('la ricerca non esce dal brand', () => {
  const altro = one(`insert into smm_brands (slug, nome) values ('keyprime','KeyPrime') returning id`);
  psql(DB, ['-c', `insert into smm_settings (brand_id) values ('${altro}')`]);
  psql(DB, ['-c', `insert into smm_brain (brand_id, tipo, codice, testo, fonte)
                   values ('${altro}', 'regola', 'KP-01', 'Regola solo di KeyPrime', 'test')`]);
  const r = come(MANAGER, `select codice from smm_cervello_cerca('${BRAND}', 'KeyPrime', null, 20)`);
  if (r.some(x => x[0] === 'KP-01')) throw new Error('una regola di un altro brand e trapelata');
});

test('le voci non confermate non entrano nella ricerca', () => {
  psql(DB, ['-c', `insert into smm_brain (brand_id, tipo, testo, fonte, confermata)
                   values ('${BRAND}', 'nota', 'Nota in attesa di conferma sul tono', 'test', false)`]);
  const r = come(MANAGER, `select testo from smm_cervello_cerca('${BRAND}', 'attesa di conferma tono', null, 20)`);
  if (r.some(x => (x[0] || '').includes('in attesa di conferma'))) {
    throw new Error('una nota non confermata e finita nei risultati');
  }
});

// ============================================================
gruppo('Una correzione del manager diventa una nota nel Cervello');

test('la nota del manager crea una voce non confermata', () => {
  const c = nuovoContenuto();
  const prima = Number(one(`select count(*) from smm_brain where tipo = 'nota'`));
  come(MANAGER, `insert into smm_notes (content_id, autore, testo, ancora)
    values ('${c}', '${MANAGER}', 'Qui il tono e troppo commerciale, serve piu sobrieta',
            '{"tipo":"slide","slide":2}'::jsonb)`);
  const dopo = Number(one(`select count(*) from smm_brain where tipo = 'nota'`));
  eq(dopo, prima + 1, 'note nel Cervello');
  eq(one(`select confermata from smm_brain where tipo='nota'
            order by created_at desc limit 1`), 'f', 'confermata');
});

test('la nota porta con se la fonte e il legame con la revisione', () => {
  const r = q(`select fonte, origine_note_id is not null from smm_brain
                where tipo='nota' order by created_at desc limit 1`);
  if (!r[0][0] || !r[0][0].startsWith('Revisione del ')) {
    throw new Error('fonte assente o sbagliata: ' + r[0][0]);
  }
  eq(r[0][1], 't', 'legame con la nota di revisione');
});

test('parte il lavoro che la generalizza', () => {
  eq(one(`select count(*) from smm_jobs where tipo = 'nota_cervello'`), '1', 'lavori di generalizzazione');
});

test('una nota quasi identica alza il peso invece di duplicare', () => {
  const c = nuovoContenuto();
  const prima = Number(one(`select count(*) from smm_brain where tipo = 'nota'`));
  const peso0 = Number(one(`select peso from smm_brain where tipo='nota'
                             order by created_at desc limit 1`));
  come(MANAGER, `insert into smm_notes (content_id, autore, testo)
    values ('${c}', '${MANAGER}', 'Qui il tono e troppo commerciale, serve piu sobrieta.')`);
  const dopo = Number(one(`select count(*) from smm_brain where tipo = 'nota'`));
  eq(dopo, prima, 'nessun duplicato');
  const peso1 = Number(one(`select max(peso) from smm_brain where tipo='nota'`));
  if (peso1 <= peso0) throw new Error(`il peso non e salito: ${peso0} -> ${peso1}`);
});

test('una nota di un agente non entra nel Cervello', () => {
  const c = nuovoContenuto();
  const ag = one(`select id from smm_agents where slug = 'revisore'`);
  const prima = Number(one(`select count(*) from smm_brain where tipo = 'nota'`));
  psql(DB, ['-c', `insert into smm_notes (content_id, autore_agent_id, testo)
                   values ('${c}', '${ag}', 'Nota automatica del Revisore')`]);
  eq(one(`select count(*) from smm_brain where tipo = 'nota'`), String(prima),
     'le note degli agenti non entrano');
});

// ============================================================
gruppo('La coda dei lavori');

test('un lavoro viene preso una volta sola', () => {
  psql(DB, ['-c', `delete from smm_jobs`]);
  const ag = one(`select id from smm_agents where slug = 'copywriter'`);
  psql(DB, ['-c', `insert into smm_jobs (brand_id, agent_id, titolo, richiesta)
                   values ('${BRAND}', '${ag}', 'Scrivi una caption', 'Tema: Corporate Tax')`]);
  const primo  = one(`select (smm_claim_job()).id`);
  const secondo = one(`select (smm_claim_job()).id`);
  if (!primo) throw new Error('il primo worker non ha preso niente');
  if (secondo) throw new Error('il secondo worker ha preso un lavoro gia preso');
  eq(one(`select stato from smm_jobs where id = '${primo}'`), 'in_corso', 'stato');
});

test("l interruttore generale ferma la coda", () => {
  psql(DB, ['-c', `delete from smm_jobs`]);
  psql(DB, ['-c', `update smm_settings set stop_tutto = true where brand_id = '${BRAND}'`]);
  psql(DB, ['-c', `insert into smm_jobs (brand_id, titolo, richiesta)
                   values ('${BRAND}', 'Lavoro bloccato', 'niente')`]);
  if (one(`select (smm_claim_job()).id`)) throw new Error('ha preso un lavoro con l interruttore alzato');
  psql(DB, ['-c', `update smm_settings set stop_tutto = false where brand_id = '${BRAND}'`]);
  if (!one(`select (smm_claim_job()).id`)) throw new Error('non riparte dopo aver abbassato l interruttore');
});

test('il budget giornaliero esaurito ferma la coda', () => {
  psql(DB, ['-c', `delete from smm_jobs`]);
  psql(DB, ['-c', `update smm_settings
                      set speso_oggi_usd = budget_giorno_usd, speso_oggi_data = current_date
                    where brand_id = '${BRAND}'`]);
  psql(DB, ['-c', `insert into smm_jobs (brand_id, titolo, richiesta)
                   values ('${BRAND}', 'Lavoro oltre budget', 'niente')`]);
  if (one(`select (smm_claim_job()).id`)) throw new Error('ha preso un lavoro a budget esaurito');
});

test('il contatore di spesa si azzera il giorno dopo', () => {
  psql(DB, ['-c', `update smm_settings set speso_oggi_data = current_date - 1
                   where brand_id = '${BRAND}'`]);
  const residuo = Number(one(`select smm_budget_residuo('${BRAND}')`));
  if (residuo <= 0) throw new Error(`il residuo non si e azzerato: ${residuo}`);
  eq(one(`select speso_oggi_usd from smm_settings where brand_id = '${BRAND}'`), '0.0000', 'speso azzerato');
});

test('la priorita conta', () => {
  psql(DB, ['-c', `delete from smm_jobs`]);
  psql(DB, ['-c', `insert into smm_jobs (brand_id, titolo, richiesta, priorita)
                   values ('${BRAND}', 'Poco urgente', 'x', 10),
                          ('${BRAND}', 'Urgente', 'x', 90)`]);
  const id = one(`select (smm_claim_job()).id`);
  eq(one(`select titolo from smm_jobs where id = '${id}'`), 'Urgente', 'lavoro scelto');
});

// ============================================================
gruppo('Log attivita');

test('creare un contenuto finisce in activity_log', () => {
  psql(DB, ['-c', `delete from activity_log`]);
  nuovoContenuto({ titolo: 'Contenuto da tracciare' });
  const n = Number(one(`select count(*) from activity_log where action = 'smm_contenuto_creato'`));
  if (n < 1) throw new Error('nessuna riga di log');
});

test('ogni passaggio di stato finisce in activity_log', () => {
  psql(DB, ['-c', `delete from activity_log`]);
  const c = nuovoContenuto();
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  eq(one(`select count(*) from activity_log where action = 'smm_contenuto_da_approvare'`), '1', 'log di stato');
});

test('una voce nuova nel Cervello finisce in activity_log', () => {
  psql(DB, ['-c', `delete from activity_log`]);
  psql(DB, ['-c', `insert into smm_brain (brand_id, tipo, testo, fonte)
                   values ('${BRAND}', 'studio', 'Studio di prova', 'test')`]);
  eq(one(`select count(*) from activity_log where action = 'smm_cervello_nuova_voce'`), '1', 'log cervello');
});

// ============================================================
gruppo('Multi-brand');

test('ogni tabella porta brand_id', () => {
  const senza = q(`
    select t.table_name from information_schema.tables t
     where t.table_schema = 'public' and t.table_name like 'smm_%'
       and t.table_type = 'BASE TABLE'
       and t.table_name <> 'smm_brands'
       and not exists (select 1 from information_schema.columns c
                        where c.table_name = t.table_name and c.column_name = 'brand_id')`);
  // le tabelle figlie risalgono al brand dal padre: elencate qui per scelta
  const ammesse = ['smm_content_versions', 'smm_notes'];
  const mancanti = senza.map(r => r[0]).filter(t => !ammesse.includes(t));
  eq(mancanti.join(','), '', 'tabelle senza brand_id');
});

test('un secondo brand si aggiunge con una riga', () => {
  const n = Number(one(`select count(*) from smm_brands`));
  if (n < 2) throw new Error('il test precedente doveva aver creato KeyPrime');
  const kp = one(`select id from smm_brands where slug = 'keyprime'`);
  psql(DB, ['-c', `insert into smm_agents (brand_id, slug, nome, ruolo, system_prompt)
                   values ('${kp}', 'direttore', 'Direttore', 'Direttore', 'prompt')`]);
  eq(one(`select count(*) from smm_agents where brand_id = '${kp}'`), '1', 'agente del secondo brand');
  // lo stesso slug su due brand non va in conflitto
  eq(one(`select count(*) from smm_agents where slug = 'direttore'`), '2', 'slug ripetuto fra brand');
});

// ============================================================
gruppo('Dall idea alla programmazione: il giro completo');

test('un contenuto attraversa tutti i passaggi, e nessuno si puo saltare', () => {
  // E' il percorso descritto nella definizione di "finito": il manager
  // scrive al Direttore, l'agente produce, il Revisore passa, il manager
  // corregge e approva, il contenuto va in calendario e viene programmato.
  // Qui si prova la parte che vive nel database. La chiamata vera a
  // GoHighLevel sta in smm-publish e ha bisogno delle chiavi.
  const ag = one(`select id from smm_agents where slug = 'copywriter'`);
  const rev = one(`select id from smm_agents where slug = 'revisore'`);

  // 1. il manager scrive al Direttore: nasce un lavoro
  const job = one(`insert into smm_jobs (brand_id, agent_id, titolo, richiesta, richiesto_da)
                   values ('${BRAND}', '${ag}', 'Carosello sulla soglia',
                           'Un carosello sulla soglia dei 375.000 AED', '${MANAGER}')
                   returning id`);
  eq(one(`select stato from smm_jobs where id = '${job}'`), 'in_coda', 'lavoro in coda');

  // 2. il worker lo prende
  eq(one(`select (smm_claim_job()).id`), job, 'lavoro preso dal worker');

  // 3. l'agente produce il contenuto
  const c = one(`insert into smm_contents
                   (brand_id, titolo, tipo, stato, caption, hashtags, slides, categoria, created_by)
                 values ('${BRAND}', 'La soglia dei 375.000 AED', 'carosello', 'in_lavorazione',
                   'La Corporate Tax negli Emirati e al nove per cento sopra i 375.000 AED. Approfondisci su InDubai.it',
                   array['#dubai','#fiscalita'],
                   '[{"type":"standard","title":"La soglia","body":"Nove per cento sopra 375.000 AED"}]'::jsonb,
                   'normativa', '${MANAGER}')
                 returning id`);

  // 4. non si salta il Revisore
  mustFail(`update smm_contents set stato = 'da_approvare' where id = '${c}'`,
           'Revisore di conformit');

  // 5. il Revisore passa il contenuto
  psql(DB, ['-c', `update smm_contents set revisore_ok = true, revisore_at = now(),
                     revisore_note = '{"violazioni":[],"commento":"Tutto in regola."}'::jsonb
                   where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);

  // 6. il manager lascia una nota: entra nel Cervello
  const noteCervelloPrima = Number(one(`select count(*) from smm_brain where tipo = 'nota'`));
  come(MANAGER, `insert into smm_notes (content_id, autore, testo, ancora)
    values ('${c}', '${MANAGER}', 'Nella prima slide il numero va scritto in parole.',
            '{"tipo":"slide","slide":0}'::jsonb)`);
  eq(one(`select count(*) from smm_brain where tipo = 'nota'`),
     String(noteCervelloPrima + 1), 'la correzione e nel Cervello');

  // 7. non si pubblica senza approvazione
  mustFail(`update smm_contents set stato = 'programmato' where id = '${c}'`,
           'approvazione umana registrata');

  // 8. il manager approva, con la sua firma
  come(MANAGER, `update smm_contents set stato = 'approvato',
                   approvato_da = '${MANAGER}', approvato_at = now() where id = '${c}'`);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'approvato', 'approvato');

  // 9. trascinato nel calendario
  come(MANAGER, `update smm_contents set slot_at = now() + interval '2 days',
                   stato = 'in_calendario' where id = '${c}'`);

  // 10. arrivata l'ora, il cron mette in coda la pubblicazione
  psql(DB, ['-c', `update smm_contents set slot_at = now() - interval '1 minute'
                   where id = '${c}'`]);
  const messi = one(`select smm_programmati_in_scadenza()`);
  if (Number(messi) < 1) throw new Error('il cron non ha messo in coda la pubblicazione');
  eq(one(`select count(*) from smm_jobs where content_id = '${c}' and tipo = 'pubblicazione'`),
     '1', 'lavoro di pubblicazione');

  // 11. e il contenuto si puo programmare, perche ha tutte le firme
  psql(DB, ['-c', `update smm_contents set stato = 'programmato' where id = '${c}'`]);
  eq(one(`select stato from smm_contents where id = '${c}'`), 'programmato', 'programmato');
});

// ============================================================
gruppo('Direzione: il piano della settimana');

// Il piano serve a una cosa sola: far sapere agli agenti quanto deve uscire
// e quanto manca. Se il conteggio sbaglia, il Direttore lancia il doppio del
// lavoro o non ne lancia nessuno, e in entrambi i casi spende male.

const PIANO = one(`select id from smm_piano where brand_id = '${BRAND}' and nome = 'Storie quotidiane'`);

/** Una uscita di quel tipo, con le date che decido io. */
function uscita(opts = {}) {
  const { tipo = 'storia', pillar = null, stato = 'idea',
          pubblicato = null, slot = null, creato = 'now()' } = opts;
  return one(`
    insert into smm_contents (brand_id, titolo, tipo, pillar, stato,
                              pubblicato_at, slot_at, created_at, created_by)
    values ('${BRAND}', 'Prova del piano', '${tipo}',
            ${pillar ? `'${pillar}'` : 'null'}, '${stato}',
            ${pubblicato || 'null'}, ${slot || 'null'}, ${creato}, '${MANAGER}')
    returning id`);
}
const settimana = (campo = 'mancanti', piano = PIANO) =>
  comeUno(MANAGER, `select ${campo} from smm_piano_settimana('${BRAND}', 0) where id = '${piano}'`);
const pulisciUscite = () => psql(DB, ['-c', `delete from smm_contents where titolo = 'Prova del piano'`]);

test('il piano di partenza dice sette storie a settimana, e le fa il Copywriter', () => {
  eq(one(`select quanti_a_settimana from smm_piano where id = '${PIANO}'`), '7', 'quante a settimana');
  eq(one(`select a.slug from smm_piano p join smm_agents a on a.id = p.agente_id
           where p.id = '${PIANO}'`), 'copywriter', 'chi le fa');
});

test('senza niente fatto mancano tutte e sette', () => {
  pulisciUscite();
  eq(settimana('mancanti'), '7', 'mancanti a settimana vuota');
});

test('una storia uscita questa settimana conta come fatta', () => {
  pulisciUscite();
  uscita({ pubblicato: 'now()', stato: 'pubblicato' });
  eq(settimana('usciti'), '1', 'usciti');
  eq(settimana('mancanti'), '6', 'mancanti');
});

test('una storia con un posto in calendario questa settimana conta', () => {
  pulisciUscite();
  uscita({ slot: `date_trunc('week', now() at time zone 'Asia/Dubai') + interval '3 days 18 hours'`,
           stato: 'in_calendario' });
  eq(settimana('in_calendario'), '1', 'in calendario');
  eq(settimana('mancanti'), '6', 'mancanti');
});

test('una storia in lavorazione senza data conta: il Direttore non ne lancia altre sette', () => {
  pulisciUscite();
  uscita({ stato: 'in_lavorazione' });
  eq(settimana('in_lavorazione'), '1', 'in lavorazione');
  eq(settimana('mancanti'), '6', 'mancanti');
});

test('una storia respinta non conta come lavoro in corso', () => {
  pulisciUscite();
  uscita({ stato: 'respinto' });
  eq(settimana('in_lavorazione'), '0', 'in lavorazione');
  eq(settimana('mancanti'), '7', 'mancanti');
});

test('una storia uscita la settimana scorsa non conta in questa', () => {
  pulisciUscite();
  uscita({ pubblicato: `now() - interval '8 days'`, stato: 'pubblicato',
           creato: `now() - interval '8 days'` });
  eq(settimana('usciti'), '0', 'usciti');
  eq(settimana('mancanti'), '7', 'mancanti');
});

test('un carosello non conta nella riga delle storie', () => {
  pulisciUscite();
  uscita({ tipo: 'carosello', pubblicato: 'now()', stato: 'pubblicato' });
  eq(settimana('usciti'), '0', 'usciti');
});

test('la settimana scorsa si guarda indietro, non si perde', () => {
  pulisciUscite();
  uscita({ pubblicato: `now() - interval '8 days'`, stato: 'pubblicato',
           creato: `now() - interval '8 days'` });
  eq(comeUno(MANAGER, `select usciti from smm_piano_settimana('${BRAND}', -1) where id = '${PIANO}'`), '1',
     'usciti la settimana scorsa');
});

test('il pillar della riga filtra: quello che non lo rispetta non conta', () => {
  pulisciUscite();
  const soloFiscale = one(`
    insert into smm_piano (brand_id, nome, tipo, quanti_a_settimana, pillar)
    values ('${BRAND}', 'Caroselli fiscali', 'carosello', 2, '{fiscale}')
    returning id`);
  uscita({ tipo: 'carosello', pillar: 'lifestyle', pubblicato: 'now()', stato: 'pubblicato' });
  eq(settimana('usciti', soloFiscale), '0', 'un carosello lifestyle nella riga fiscale');
  uscita({ tipo: 'carosello', pillar: 'fiscale', pubblicato: 'now()', stato: 'pubblicato' });
  eq(settimana('usciti', soloFiscale), '1', 'un carosello fiscale nella riga fiscale');
  eq(settimana('mancanti', soloFiscale), '1', 'mancanti');
  psql(DB, ['-c', `delete from smm_piano where id = '${soloFiscale}'`]);
});

test('i mancanti non vanno sotto zero se si produce piu del previsto', () => {
  pulisciUscite();
  for (let i = 0; i < 9; i++) uscita({ pubblicato: 'now()', stato: 'pubblicato' });
  eq(settimana('usciti'), '9', 'usciti');
  eq(settimana('mancanti'), '0', 'mancanti');
  pulisciUscite();
});

test('il piano in parole dice il numero, chi lo fa e quanto manca', () => {
  pulisciUscite();
  const testo = comeUno(MANAGER, `select smm_piano_in_parole('${BRAND}')`);
  if (!testo.includes('7 storia')) throw new Error(`manca la quantita: ${testo}`);
  if (!testo.includes('Copywriter')) throw new Error(`manca chi lo fa: ${testo}`);
  if (!testo.includes('Mancano: 7')) throw new Error(`manca il mancante: ${testo}`);
  if (!testo.includes('Come:')) throw new Error(`mancano le istruzioni: ${testo}`);
});

test('una riga spenta non entra nel piano in parole', () => {
  psql(DB, ['-c', `update smm_piano set attivo = false where id = '${PIANO}'`]);
  // Fra parentesi quadre perche' psql stampa il vuoto come niente, e il
  // lettore dei test non distingue "stringa vuota" da "nessuna riga".
  eq(comeUno(MANAGER, `select '[' || smm_piano_in_parole('${BRAND}') || ']'`), '[]',
     'piano con la riga spenta');
  psql(DB, ['-c', `update smm_piano set attivo = true where id = '${PIANO}'`]);
});

test('il manager puo leggere e scrivere la tabella del piano, non solo la funzione', () => {
  // La RLS dice quali righe, i grant dicono se puoi toccare la tabella.
  // Senza il grant la policy e' perfetta e il browser risponde lo stesso
  // "permission denied": e' successo, la tabella era nata dopo il ciclo
  // che li assegna.
  const riga = comeUno(MANAGER, `insert into smm_piano (brand_id, nome, tipo, quanti_a_settimana)
                                 values ('${BRAND}', 'Prova permessi', 'post', 1) returning id`);
  if (!riga) throw new Error('il manager non riesce a inserire nel piano');
  eq(comeUno(MANAGER, `select nome from smm_piano where id = '${riga}'`), 'Prova permessi', 'rilettura');
  come(MANAGER, `update smm_piano set quanti_a_settimana = 3 where id = '${riga}'`);
  eq(one(`select quanti_a_settimana from smm_piano where id = '${riga}'`), '3', 'aggiornamento');
  come(MANAGER, `delete from smm_piano where id = '${riga}'`);
  eq(one(`select count(*) from smm_piano where id = '${riga}'`), '0', 'cancellazione');
});

test('un contabile junior non puo toccare la tabella del piano', () => {
  // Su INSERT la policy alza un errore, non filtra in silenzio come fa su
  // UPDATE: il with check non ha righe da nascondere, ha una riga nuova da
  // rifiutare.
  comeFallisce(JUNIOR, `insert into smm_piano (brand_id, nome, tipo, quanti_a_settimana)
                        values ('${BRAND}', 'Non deve entrare', 'post', 1)`,
               'row-level security');
  eq(one(`select count(*) from smm_piano where nome = 'Non deve entrare'`), '0',
     'righe inserite da un junior');
});

test('un contabile junior non vede il piano', () => {
  eq(come(JUNIOR, `select count(*) from smm_piano_settimana('${BRAND}', 0)`)[0][0], '0',
     'righe del piano per un junior');
});

test('il manager vede il piano', () => {
  if (Number(comeUno(MANAGER, `select count(*) from smm_piano_settimana('${BRAND}', 0)`)) < 1) {
    throw new Error('il manager non vede nessuna riga del piano');
  }
});

// ============================================================
gruppo('Interruttori: attiva e spegni');

/** Mette un lavoro in coda per un agente, e restituisce l'id. */
function lavoroPer(slug, priorita = 50) {
  const agente = slug
    ? one(`select id from smm_agents where brand_id = '${BRAND}' and slug = '${slug}'`)
    : null;
  return one(`
    insert into smm_jobs (brand_id, agent_id, tipo, titolo, richiesta, priorita, richiesto_da)
    values ('${BRAND}', ${agente ? `'${agente}'` : 'null'}, 'agente',
            'Prova interruttore', 'niente', ${priorita}, '${MANAGER}')
    returning id`);
}
// Tutti i lavori ancora in coda, non solo i miei: i gruppi precedenti ne
// lasciano, e "ho preso un lavoro" non dice quale.
const svuotaCoda = () => psql(DB, ['-c', `delete from smm_jobs where stato = 'in_coda'`]);
const prendi = () => one(`select (smm_claim_job()).id`);

test('il fermo generale lo puo alzare il manager, non serve l admin', () => {
  vero(comeUno(MANAGER, `select smm_interruttore('${BRAND}', true)`), 'il manager alza il fermo');
  vero(one(`select stop_tutto from smm_settings where brand_id = '${BRAND}'`), 'stop_tutto');
});

test('col fermo alzato la coda non da lavori', () => {
  svuotaCoda();
  lavoroPer('copywriter');
  eq(prendi(), null, 'un lavoro preso col fermo alzato');
});

test('abbassando il fermo il lavoro e ancora li: non si perde, riparte', () => {
  comeUno(MANAGER, `select smm_interruttore('${BRAND}', false)`);
  falso(one(`select stop_tutto from smm_settings where brand_id = '${BRAND}'`), 'stop_tutto');
  if (!prendi()) throw new Error('il lavoro non riparte dopo la ripartenza');
  svuotaCoda();
});

test('alzare e abbassare il fermo finisce in activity_log', () => {
  eq(one(`select count(*) from activity_log where action = 'smm_fermo_generale'`), '1', 'fermo');
  eq(one(`select count(*) from activity_log where action = 'smm_ripartenza'`), '1', 'ripartenza');
});

test('un contabile junior non puo toccare l interruttore', () => {
  comeFallisce(JUNIOR, `select smm_interruttore('${BRAND}', true)`, 'non hai accesso alla regia');
  falso(one(`select stop_tutto from smm_settings where brand_id = '${BRAND}'`), 'stop_tutto');
});

test('un agente spento non riceve lavori', () => {
  svuotaCoda();
  const lavoro = lavoroPer('copywriter');
  psql(DB, ['-c', `update smm_agents set attivo = false where brand_id = '${BRAND}' and slug = 'copywriter'`]);
  eq(prendi(), null, 'lavoro preso da un agente spento');
  eq(one(`select stato from smm_jobs where id = '${lavoro}'`), 'in_coda', 'il lavoro resta in coda');
});

test('gli altri agenti continuano a lavorare mentre uno e spento', () => {
  const altro = lavoroPer('grafico', 90);
  eq(prendi(), altro, 'il lavoro del grafico');
});

test('un lavoro senza agente parte comunque: la pubblicazione non ha una persona', () => {
  const senzaAgente = one(`
    insert into smm_jobs (brand_id, tipo, titolo, richiesta, priorita, richiesto_da)
    values ('${BRAND}', 'pubblicazione', 'Prova interruttore', 'niente', 95, '${MANAGER}')
    returning id`);
  eq(prendi(), senzaAgente, 'il lavoro senza agente');
});

test('riaccendendo l agente il suo lavoro riparte', () => {
  psql(DB, ['-c', `update smm_agents set attivo = true where brand_id = '${BRAND}' and slug = 'copywriter'`]);
  if (!prendi()) throw new Error('il lavoro del copywriter non riparte');
  svuotaCoda();
});

test('il manager puo spegnere e riaccendere un agente', () => {
  const copy = one(`select id from smm_agents where brand_id = '${BRAND}' and slug = 'copywriter'`);
  come(MANAGER, `update smm_agents set attivo = false where id = '${copy}'`);
  falso(one(`select attivo from smm_agents where id = '${copy}'`), 'spento dal manager');
  come(MANAGER, `update smm_agents set attivo = true where id = '${copy}'`);
  vero(one(`select attivo from smm_agents where id = '${copy}'`), 'riaccesso dal manager');
});

test('un contabile junior non puo spegnere un agente', () => {
  const copy = one(`select id from smm_agents where brand_id = '${BRAND}' and slug = 'copywriter'`);
  come(JUNIOR, `update smm_agents set attivo = false where id = '${copy}'`);
  vero(one(`select attivo from smm_agents where id = '${copy}'`), 'l agente dopo il tentativo del junior');
});

// ============================================================
gruppo('La settimana si copre da sola');

// E' la parte che fa andare avanti la Regia quando nessuno guarda. Gira
// sotto pg_cron, cioe' senza nessun utente autenticato: e' li' che si
// nasconde l'errore, perche' un permesso mancante non da' un errore, da'
// zero righe e un silenzio.

test('il conteggio interno risponde anche senza nessun utente', () => {
  // E' il contesto di pg_cron: nessun JWT, nessuno autenticato. Il guscio
  // pubblico qui risponde vuoto ed e' giusto; la funzione interna no, ed e'
  // quella che usa il lavoro quotidiano.
  if (Number(one(`select count(*) from smm_piano_settimana_interna('${BRAND}', 0)`)) < 1) {
    throw new Error('il conteggio interno e vuoto: il lavoro quotidiano non partirebbe mai');
  }
});

test('la funzione interna non e chiamabile da un utente qualunque', () => {
  comeFallisce(JUNIOR, `select count(*) from smm_piano_settimana_interna('${BRAND}', 0)`,
               'permission denied');
  comeFallisce(MANAGER, `select count(*) from smm_piano_settimana_interna('${BRAND}', 0)`,
               'permission denied');
});

test('se manca qualcosa, il Direttore riceve l incarico', () => {
  psql(DB, ['-c', `delete from smm_jobs where tipo = 'piano'`]);
  eq(one(`select smm_piano_quotidiano()`), '1', 'brand incaricati');
  eq(one(`select count(*) from smm_jobs where tipo = 'piano' and stato = 'in_coda'`), '1', 'lavori creati');
  eq(one(`select a.slug from smm_jobs j join smm_agents a on a.id = j.agent_id
           where j.tipo = 'piano'`), 'direttore', 'a chi tocca');
});

test('non si chiede due volte nello stesso giorno', () => {
  eq(one(`select smm_piano_quotidiano()`), '0', 'secondo giro');
  eq(one(`select count(*) from smm_jobs where tipo = 'piano'`), '1', 'lavori in tutto');
});

test('col fermo generale alzato non parte niente', () => {
  psql(DB, ['-c', `delete from smm_jobs where tipo = 'piano'`]);
  psql(DB, ['-c', `update smm_settings set stop_tutto = true where brand_id = '${BRAND}'`]);
  eq(one(`select smm_piano_quotidiano()`), '0', 'col fermo alzato');
  psql(DB, ['-c', `update smm_settings set stop_tutto = false where brand_id = '${BRAND}'`]);
});

test('col piano automatico spento non parte niente', () => {
  psql(DB, ['-c', `update smm_settings set piano_automatico = false where brand_id = '${BRAND}'`]);
  eq(one(`select smm_piano_quotidiano()`), '0', 'col piano automatico spento');
  psql(DB, ['-c', `update smm_settings set piano_automatico = true where brand_id = '${BRAND}'`]);
});

test('se la settimana e gia coperta non si disturba nessuno', () => {
  psql(DB, ['-c', `delete from smm_jobs where tipo = 'piano'`]);
  psql(DB, ['-c', `update smm_piano set attivo = false where brand_id = '${BRAND}'`]);
  eq(one(`select smm_piano_quotidiano()`), '0', 'senza righe attive nel piano');
  psql(DB, ['-c', `update smm_piano set attivo = true where brand_id = '${BRAND}'`]);
  psql(DB, ['-c', `delete from smm_jobs where tipo = 'piano'`]);
});

// ============================================================
gruppo('Quello che sa chi scrive');

// La prima storia uscita dagli agenti era corretta e anonima. Non era un
// difetto del modello: era quello che gli avevo dato. I fatti c'erano, il
// gancio no.

test('ogni topic della knowledge porta il gancio, non solo il fatto', () => {
  const magri = one(`select count(*) from smm_brain
                      where codice like 'S-KB-%' and testo not like '%GANCIO:%'`);
  eq(magri, '0', 'topic senza gancio');
  const corti = one(`select count(*) from smm_brain
                      where codice like 'S-KB-%' and length(testo) < 400`);
  eq(corti, '0', 'topic piu corti di 400 caratteri');
});

test('ci sono tutti e venti, con errore comune e cliffhanger', () => {
  eq(one(`select count(*) from smm_brain where codice like 'S-KB-%'`), '20', 'quanti topic');
  eq(one(`select count(*) from smm_brain
           where codice like 'S-KB-%'
             and (testo not like '%ERRORE COMUNE:%' or testo not like '%CLIFFHANGER:%')`),
     '0', 'topic a cui manca un pezzo');
});

test('ogni topic porta il suo pillar fra i tag', () => {
  eq(one(`select count(*) from smm_brain
           where codice like 'S-KB-%'
             and not (tags && array['miti','strutture','compliance','residenza','normativa'])`),
     '0', 'topic senza pillar');
});

// Attenzione: questi testi vanno a capo, e il lettore dei risultati qui
// sopra spezza le righe. Le domande si fanno al database, che risponde una
// riga sola, invece di tirarsi i testi dentro JavaScript.

test('la ricerca non restituisce solo divieti', () => {
  // Le vincolanti sono 51 e arrivano sempre: con una classifica sola si
  // prendevano tutti i posti, e chi scriveva riceveva l'elenco di cosa non
  // dire invece del materiale su cui scrivere.
  const r = come(MANAGER,
    `select count(*) filter (where vincolante)::text || ' ' ||
            count(*) filter (where not vincolante)::text
       from smm_cervello_cerca('${BRAND}', 'conto a Dubai e quadro RW', null, 8)`);
  const [vinc, mat] = String(r[0][0]).split(' ').map(Number);
  if (vinc < 1) throw new Error('nessuna voce vincolante: devono arrivare sempre');
  if (mat < 1) throw new Error('solo divieti: il materiale non arriva mai');
  // Non si pretende di riempire il limite: se il materiale pertinente e'
  // poco, meglio sei risposte buone che otto allungate.
  if (vinc + mat > 8) throw new Error(`il limite non e rispettato: ${vinc + mat} risultati`);
});

test('la ricerca sul Cervello restituisce il gancio, non la riga di prima', () => {
  eq(comeUno(MANAGER,
    `select count(*) from smm_cervello_cerca('${BRAND}', 'conto a Dubai e quadro RW', null, 8)
      where testo like '%GANCIO:%'`) > '0', true,
    'risultati della ricerca che portano un gancio');
});

test('il Copywriter sa come si fa una slide, non solo che tono usare', () => {
  const manca = one(`
    select coalesce(string_agg(p, ', '), '') from unnest(array[
      'CINQUE PILLAR', 'intro', 'content', 'cta', 'bullet', 'ctaLine', 'badge'
    ]) p
    where not exists (
      select 1 from smm_agents a
       where a.slug = 'copywriter' and a.system_prompt ilike '%' || p || '%')`);
  if (manca) throw new Error(`nel prompt mancano: ${manca}`);
});

test('i bullet restano vietati nella caption e ammessi nelle slide', () => {
  vero(one(`select system_prompt like '%CAPTION mai elenchi puntati%'
              from smm_agents where slug = 'copywriter'`), 'la caption resta protetta');
  vero(one(`select system_prompt like '%SLIDE i bullet si usano%'
              from smm_agents where slug = 'copywriter'`), 'nelle slide i bullet si usano');
});

// ============================================================
gruppo('Le immagini si fanno da sole');

// Il manager ha dovuto premere lui "Prepara le immagini". Un lavoro in
// piu' su ogni contenuto, ogni volta: esattamente quello che la Regia
// doveva togliere.

/** Un contenuto con le slide, pronto a passare in approvazione. */
function contenutoConSlide(titolo = 'Da montare') {
  const id = one(`
    insert into smm_contents (brand_id, titolo, caption, categoria, stato, slides, created_by)
    values ('${BRAND}', '${titolo}',
            'La Corporate Tax negli Emirati e al 9 per cento sopra 375.000 AED.',
            'normativa', 'in_lavorazione',
            '[{"tipo":"intro","titolo":"Uno"},{"tipo":"cta","titolo":"Due"}]'::jsonb,
            '${MANAGER}')
    returning id`);
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${id}'`]);
  return id;
}
const montaggiDi = (id) =>
  one(`select count(*) from smm_jobs where content_id = '${id}' and tipo = 'montaggio'`);

test('entrando in approvazione, il montaggio si mette in coda da solo', () => {
  const c = contenutoConSlide('Da montare 1');
  eq(montaggiDi(c), '0', 'prima');
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  eq(montaggiDi(c), '1', 'dopo');
  eq(one(`select priorita from smm_jobs where content_id = '${c}' and tipo = 'montaggio'`),
     '75', 'priorita');
});

test('il lavoro di montaggio non ha un agente: non costa un modello', () => {
  const c = contenutoConSlide('Da montare 2');
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  eq(one(`select agent_id is null from smm_jobs
           where content_id = '${c}' and tipo = 'montaggio'`), 't', 'senza agente');
  eq(one(`select payload->>'formato' from smm_jobs
           where content_id = '${c}' and tipo = 'montaggio'`), 'carosello', 'formato');
});

test('un salvataggio qualunque non rimette in coda niente', () => {
  const c = contenutoConSlide('Da montare 3');
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare', caption = 'ritocco' where id = '${c}'`]);
  eq(montaggiDi(c), '1', 'montaggi in tutto');
});

test('se i file ci sono gia, non si rifa niente', () => {
  const c = contenutoConSlide('Da montare 4');
  psql(DB, ['-c', `
    insert into smm_media (brand_id, content_id, ruolo, bucket, path, mime)
    values ('${BRAND}', '${c}', 'derivato', 'cloudinary', 'prova/montato-${Date.now()}', 'image/jpeg')`]);
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  eq(montaggiDi(c), '0', 'montaggi');
});

test('senza slide non si monta niente', () => {
  const c = one(`
    insert into smm_contents (brand_id, titolo, caption, categoria, stato, created_by)
    values ('${BRAND}', 'Senza slide', 'Testo conforme sulla Corporate Tax.',
            'normativa', 'in_lavorazione', '${MANAGER}')
    returning id`);
  psql(DB, ['-c', `update smm_contents set revisore_ok = true where id = '${c}'`]);
  psql(DB, ['-c', `update smm_contents set stato = 'da_approvare' where id = '${c}'`]);
  eq(montaggiDi(c), '0', 'montaggi');
});

// ============================================================
gruppo('Il motore: chi lo puo chiamare');

test('il Grafico e il Video hanno lo strumento, il Copywriter no', () => {
  const ha = (slug) => one(`select 'rendi_immagini' = any(strumenti)
                              from smm_agents where brand_id='${BRAND}' and slug='${slug}'`);
  vero(ha('grafico'), 'il Grafico');
  vero(ha('video'), 'il Video');
  falso(ha('copywriter'), 'il Copywriter');
});

test('il prompt del Grafico glielo dice, una volta sola', () => {
  const quante = one(`select (length(system_prompt) - length(replace(system_prompt,'rendi_immagini','')))
                             / length('rendi_immagini')
                        from smm_agents where brand_id='${BRAND}' and slug='grafico'`);
  eq(quante, '1', 'quante volte compare nel prompt');
});

test('riapplicare la migrazione non raddoppia niente', () => {
  const prima = one(`select array_length(strumenti,1) from smm_agents
                      where brand_id='${BRAND}' and slug='grafico'`);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261111_smm_motore.sql')]);
  eq(one(`select array_length(strumenti,1) from smm_agents
           where brand_id='${BRAND}' and slug='grafico'`), prima, 'strumenti del Grafico');
});

// ============================================================
gruppo('Reversibilita');

test('la migrazione di rollback riporta il database come prima', () => {
  const prima = one(`select count(*) from information_schema.tables
                      where table_schema='public' and table_name like 'smm_%'`);
  if (Number(prima) < 11) throw new Error('mancano tabelle prima del rollback');
  // Il rollback e' in due file, come le migrazioni: prima la pianificazione,
  // poi lo schema. Il down del cron gira anche senza pg_cron installato,
  // perche' la chiamata a unschedule e' dentro un blocco che ingoia l'errore.
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_montaggio_automatico_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_cervello_quote_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_brief_copywriter_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_knowledge_intera_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261112_smm_cron_automatico_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261111_smm_motore_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261111_smm_direzione_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261110_smm_cron_down.sql')]);
  psql(DB, ['-f', join(ROOT, 'supabase/migrations/20261110_smm_regia_down.sql')]);
  eq(one(`select count(*) from information_schema.tables
           where table_schema='public' and table_name like 'smm_%'`), '0', 'tabelle smm rimaste');
  eq(one(`select count(*) from pg_proc where proname like 'smm_%' or proname = 'can_see_smm'`), '0',
     'funzioni smm rimaste');
  // le tabelle del portale non sono state toccate
  eq(one(`select count(*) from profiles`), '3', 'profili del portale');
  vero(one(`select exists (select 1 from information_schema.tables
             where table_name = 'activity_log')`), 'activity_log ancora presente');
});

// ============================================================
console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exit(falliti ? 1 : 0);
