/**
 * Il contratto fra la Regia e il motore che rende le immagini.
 *
 * In mezzo c'e' una conversione: quello che scrivono gli agenti deve
 * diventare la forma che il generatore si aspetta. Se sbaglia, il rendering
 * fallisce o - peggio - riesce producendo slide con scritto "undefined".
 *
 * I dati di prova non sono inventati: sono quelli veri usciti dal
 * Copywriter la prima volta che ha lavorato. Scrive le chiavi in italiano
 * (tipo, titolo, testo), ed e' coerente, visto che tutta la Regia parla
 * italiano. La conversione deve accettarle.
 *
 *   node tests/smm-forma.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'supabase/functions/smm-render/index.ts'), 'utf8');
const pezzo = src.slice(src.indexOf('function badge('), src.indexOf('async function salvaMedia'));
// Via i tipi: bastano quelli che compaiono in queste due funzioni.
const js = pezzo
  .replace(/as Record<string, unknown> \| unknown\[\] \| null/g, '')
  .replace(/as Record<string, unknown>/g, '')
  .replace(/(\w+)\?\s*:\s*[A-Za-z<>\[\], |]+/g, '$1')
  .replace(/:\s*(Contenuto|Brand|string|boolean|number)\b/g, '')
  .replace(/\)\s*:\s*Record<string, unknown>\s*\{/g, ') {')
  .replace(/\)\s*:\s*string\s*\{/g, ') {');

const mod = new Function(`${js}; return { datiCarosello, datiStoria, badge, sottotitolo };`)();

const brand = { nome: 'InDubai', cta_default: 'Approfondisci su InDubai.it', sito: 'InDubai.it' };

// Il carosello di prova, come sta nel database
const carosello = {
  titolo: 'PROVA DEL MOTORE — Corporate Tax, la soglia dei 375.000 AED',
  categoria: 'normativa', pillar: 'fiscale',
  caption: "Negli Emirati la Corporate Tax e' al 9 per cento sopra i 375.000 AED di utile. Sotto quella soglia l'aliquota e' zero, ma la registrazione resta obbligatoria lo stesso: e' questo il punto che fa perdere piu' tempo e piu' soldi.",
  slides: [
    { type: 'standard', title: 'Zero per cento non vuol dire zero adempimenti', body: 'Sotto i 375.000 AED...' },
    { type: 'stats', title: 'I numeri che contano', stats: [{ value: '9%', label: 'aliquota', desc: 'oltre la soglia' }] },
    { type: 'quote', title: 'Il punto', quoteText: "Chi scopre l'obbligo in ritardo paga la sanzione.", quoteAuthor: 'InDubai' },
  ],
};

// La storia vera scritta dal Copywriter, con le chiavi in italiano
const storia = {
  titolo: 'Storia 1/7 – Fiscalità', categoria: null, pillar: 'fiscale',
  caption: "Iscriversi all'AIRE è il primo passo, non l'ultimo.",
  slides: [
    { tipo: 'intro', titolo: "Iscritto all'AIRE. Ma per il Fisco sei ancora in Italia?", testo: "Per l'articolo 2 del TUIR..." },
    { tipo: 'content', titolo: 'Chi deve dimostrarlo? Tu.', testo: "Se l'Agenzia delle Entrate contesta..." },
    { tipo: 'cta', titolo: 'Dove sei residente davvero?', testo: 'Scrivici in privato.' },
  ],
};

const c = mod.datiCarosello(carosello, brand);
const s = mod.datiStoria(storia, brand);

let ko = 0;
const dev = (cond, che) => { if (!cond) { ko++; console.log('  KO  ' + che); } else console.log('  ok  ' + che); };

console.log('\nCAROSELLO — quello che riceverebbe il motore');
dev(c.badge === 'NORMATIVA', 'badge dalla categoria: ' + c.badge);
dev(c.coverTitle === carosello.titolo, 'titolo di copertina');
dev(typeof c.coverSubtitle === 'string' && c.coverSubtitle.length > 10, 'sottotitolo dalla prima frase');
dev(Array.isArray(c.slides) && c.slides.length === 3, 'tre slide');
dev(c.slides[0].type === 'standard' && c.slides[0].title.length > 0, 'slide 1: tipo e titolo');
dev(c.slides[1].type === 'stats' && Array.isArray(c.slides[1].stats), 'slide 2: statistiche conservate');
dev(c.slides[2].type === 'quote' && c.slides[2].quoteText, 'slide 3: citazione conservata');
dev(c.ctaText === brand.cta_default && c.ctaButton === brand.sito, 'invito dal brand');

console.log('\nSTORIA — chiavi italiane scritte dal Copywriter');
dev(s.theme === storia.titolo, 'tema');
dev(s.badge === 'FISCALE', 'badge dal pillar: ' + s.badge);
dev(s.slides.length === 3, 'tre slide');
dev(s.slides[0].type === 'intro', 'tipo letto da "tipo": ' + s.slides[0].type);
dev(s.slides[1].type === 'content', 'secondo tipo: ' + s.slides[1].type);
dev(s.slides[2].type === 'cta', 'terzo tipo: ' + s.slides[2].type);
dev(s.slides[0].title.startsWith('Iscritto'), 'titolo letto da "titolo"');
dev(s.slides[0].body.startsWith("Per l'articolo"), 'testo letto da "testo"');
dev(!s.slides.some(x => x.title === 'undefined' || x.body === 'undefined'), 'nessun "undefined" nei campi');

console.log(ko ? `\n${ko} problemi di forma\n` : '\nLa forma e\' giusta per tutti e due.\n');
process.exit(ko ? 1 : 0);
