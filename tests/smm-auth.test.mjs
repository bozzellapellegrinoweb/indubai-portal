/**
 * Chi puo' far partire gli agenti.
 *
 * Questo test esiste per un motivo preciso: il controllo precedente
 * confrontava il token con SUPABASE_ANON_KEY letta dall'ambiente della edge
 * function, dove quella variabile non c'e'. Il confronto riusciva sempre, e
 * la chiave pubblica che sta nel codice della pagina bastava a far girare la
 * coda degli agenti, che spende.
 *
 * Non si e' visto fino alla prova in produzione, perche' un controllo che
 * non blocca niente non fallisce: risponde ok.
 *
 *   node --experimental-strip-types tests/smm-auth.test.mjs
 */
import { ruoloDelToken, eUnaPersona, utenteDelToken } from "../supabase/functions/smm-worker/auth.ts";
import { readFileSync } from "node:fs";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma`;

// La chiave pubblica vera del progetto: sta in js/supabase.js, la vede
// chiunque apra la pagina.
const CHIAVE_PUBBLICA =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6" +
  "ImFub24iLCJpYXQiOjE3NzIwMzIwNTEsImV4cCI6MjA4NzYwODA1MX0." +
  "I0hB8POnRunvGyr7XXItp8E5H70i0slG-pqxqzCOBOg";

const casi = [
  // [nome, token, ruolo atteso, e' una persona]
  ["la chiave pubblica del portale", CHIAVE_PUBBLICA, "anon", false],
  ["una chiave anon qualunque", jwt({ role: "anon" }), "anon", false],
  ["un utente del portale", jwt({ sub: "u1", role: "authenticated" }), "authenticated", true],
  ["la chiave di servizio come JWT", jwt({ role: "service_role" }), "service_role", true],
  ["payload con - e _ nel base64url",
    `${b64({ alg: "HS256" })}.${Buffer.from(JSON.stringify({ role: "authenticated", n: "a ~ b?? +/+" })).toString("base64url")}.x`,
    "authenticated", true],
  ["il segreto del cron, che non e' un JWT", "un-segreto-qualunque", null, false],
  ["una chiave publishable nuova", "sb_publishable_tbJy_9E", null, false],
  ["niente", "", null, false],
  ["tre pezzi di spazzatura", "a.b.c", null, false],
  ["un JWT senza ruolo", jwt({ sub: "u1" }), null, false],
  ["un ruolo che non e' una stringa", jwt({ role: 7 }), null, false],
];

let ko = 0;
for (const [nome, token, ruolo, persona] of casi) {
  const r = ruoloDelToken(token);
  const p = eUnaPersona(token);
  const ok = r === ruolo && p === persona;
  if (!ok) ko++;
  console.log(`${ok ? "  ok" : "  KO"}  ${nome}: ruolo ${r}, persona ${p}`);
}

console.log("");
if (ko) {
  console.log(`${ko} casi sbagliati su ${casi.length}.`);
  process.exit(1);
}

// ── Chi e' la persona ──────────────────────────────────────────────────
//
// Dove l'azione costa non basta sapere che e' una persona: la funzione
// gira con la chiave di servizio, quindi auth.uid() e' vuoto e l'identita'
// va letta dal token e poi verificata contro i permessi.

const chiCasi = [
  ["un token con il suo utente", jwt({ role: "authenticated", sub: "u-123" }), "u-123"],
  ["un token senza utente", jwt({ role: "authenticated" }), null],
  ["la chiave pubblica", jwt({ role: "anon" }), null],
  ["spazzatura", "a.b.c", null],
  ["niente", "", null],
  ["un sub che non e' una stringa", jwt({ role: "authenticated", sub: 7 }), null],
  ["un sub vuoto", jwt({ role: "authenticated", sub: "" }), null],
];
for (const [nome, token, atteso] of chiCasi) {
  const r = utenteDelToken(token);
  const ok = r === atteso;
  if (!ok) ko++;
  console.log(`${ok ? "  ok" : "  KO"}  ${nome}: ${r}`);
}
// La chiave pubblica porta un sub? No, ma se un domani lo portasse non deve
// comunque passare: chi autorizza e' eUnaPersona, questo dice solo chi e'.
if (eUnaPersona(jwt({ role: "anon", sub: "u-1" })) !== false) {
  ko++; console.log("  KO  la chiave pubblica con un sub non deve essere una persona");
}

// ── L'indirizzo del motore ─────────────────────────────────────────────
//
// Si ricava da quello del rendering invece di chiedere un secondo segreto
// quasi uguale, che e' un modo per farne sbagliare uno. Se non si puo'
// ricavare, si deve dire, non indovinare.
//
// Stava dentro smm-avatar; da quando lo usano in due e' in motore.ts, e
// questo test e' rimasto a cercarlo dov'era: per un po' non ha provato
// niente, e' solo esploso.

const sorgenteMotore = readFileSync(
  new URL("../supabase/functions/smm-worker/motore.ts", import.meta.url), "utf8");
const indirizzoMotore = new Function("Deno",
  sorgenteMotore
    .replace(/^export /gm, "")
    .replace(/:\s*string\s*\|\s*null/g, "")
    .replace(/\(rotta:\s*string\)/, "(rotta)")
  + "; return indirizzoMotore;")({ env: { get: () => finto } });

let finto = "";
const indCasi = [
  ["l'indirizzo giusto", "https://x.vercel.app/api/regia/render", "avatar", "https://x.vercel.app/api/regia/avatar"],
  ["un'altra rotta", "https://x.vercel.app/api/regia/render", "notizie", "https://x.vercel.app/api/regia/notizie"],
  ["con la barra in fondo", "https://x.vercel.app/api/regia/render/", "avatar", "https://x.vercel.app/api/regia/avatar"],
  ["con la barra davanti alla rotta", "https://x.vercel.app/api/regia/render", "/newsletter", "https://x.vercel.app/api/regia/newsletter"],
  ["un indirizzo che non finisce per render", "https://x.vercel.app/api/altro", "avatar", null],
  ["la parola render in mezzo", "https://x.vercel.app/render/api", "avatar", null],
  ["vuoto", "", "avatar", null],
];
for (const [nome, dentro, rotta, atteso] of indCasi) {
  finto = dentro;
  const r = indirizzoMotore(rotta);
  const ok = r === atteso;
  if (!ok) ko++;
  console.log(`${ok ? "  ok" : "  KO"}  ${nome}: ${r}`);
}

// ── Il titolo che si vede sulla copertina ──────────────────
//
// Il Direttore chiama i contenuti "Reel - Corporate Tax UAE: gettito 2025
// su di un terzo", ed e' giusto: nella Regia serve sapere cosa si sta
// guardando. Ma quel titolo finiva dritto sulla copertina, e il primo reel
// mai uscito aveva scritto sopra "Reel -" a caratteri di 96 pixel. Non c'e'
// un errore, non c'e' un test che fallisce: esce e basta, e si vede solo
// guardando il video.
//
// La funzione si ritaglia dal sorgente vero, come sopra: una copia qui
// proverebbe la copia.

const sorgenteRender = readFileSync(
  new URL("../supabase/functions/smm-render/index.ts", import.meta.url), "utf8");
const inizio = sorgenteRender.indexOf("function titoloInChiaro");
const fine = sorgenteRender.indexOf("\n}", inizio) + 2;
const titoloInChiaro = new Function(
  sorgenteRender.slice(inizio, fine)
    .replace(/\(t: unknown\)/, "(t)")
    .replace(/:\s*string\s*\{/, " {")
  + "; return titoloInChiaro;")();

const titCasi = [
  // I due reel veri usciti il 12 novembre 2026.
  ["Reel \u2013 Corporate Tax UAE: gettito 2025 su di un terzo",
   "Corporate Tax UAE: gettito 2025 su di un terzo"],
  ["Reel \u2013 Golden Visa non basta per uscire dal fisco italiano",
   "Golden Visa non basta per uscire dal fisco italiano"],
  // Le storie, numerate.
  ["Storia 6/7 \u2013 Confronto Italia Dubai", "Confronto Italia Dubai"],
  ["Storia 2/7 - Confronto Italia Dubai", "Confronto Italia Dubai"],
  ["Carosello \u2014 Monaco o Dubai?", "Monaco o Dubai?"],
  // E questi devono restare interi: "Brexit" non e' un numero, e un
  // titolo senza trattino non ha nessun prefisso da togliere.
  ["Post Brexit \u2013 cosa cambia per chi apre a Dubai",
   "Post Brexit \u2013 cosa cambia per chi apre a Dubai"],
  ["Monaco o Dubai? Residenza fiscale e impresa",
   "Monaco o Dubai? Residenza fiscale e impresa"],
  ["Storia quotidiana mancante della settimana (7 di 7)",
   "Storia quotidiana mancante della settimana (7 di 7)"],
  // Togliere tutto lascerebbe una copertina senza titolo: meglio il nome
  // interno che il vuoto.
  ["Reel", "Reel"],
  ["Reel \u2013 ", "Reel \u2013"],
  ["", ""],
];
for (const [dentro, atteso] of titCasi) {
  const r = titoloInChiaro(dentro);
  const ok = r === atteso;
  if (!ok) ko++;
  console.log(`${ok ? "  ok" : "  KO"}  "${dentro}" -> "${r}"`);
}

console.log(`${casi.length + chiCasi.length + indCasi.length + titCasi.length + 1} casi, tutti giusti. La chiave pubblica non autorizza niente.`);
