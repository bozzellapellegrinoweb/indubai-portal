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
import { ruoloDelToken, eUnaPersona } from "../supabase/functions/smm-worker/auth.ts";

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
console.log(`${casi.length} casi, tutti giusti. La chiave pubblica non autorizza niente.`);
