/**
 * smm-avatar — le foto del manager, comandate dalla Regia.
 *
 * Le foto vivono nel database del generatore, non qui: il pool e' quello
 * che le storie usano da sempre, e duplicarlo vorrebbe dire avere due
 * elenchi che divergono. Questa funzione non e' un archivio, e' un
 * passaggio: controlla chi chiede e gira la richiesta al motore.
 *
 * Il controllo non e' una formalita'. Generare foto costa, e con la sola
 * verifica "e' un token di una persona" basterebbe un qualunque utente del
 * portale, anche senza la Regia fra le pagine concesse. Qui si legge chi e'
 * dal suo token e si chiede al database se quella persona ha la Regia:
 * dentro una funzione che gira con la chiave di servizio auth.uid() non
 * dice niente, quindi l'identita' va verificata a mano.
 */

import { clientDaAmbiente } from "../smm-worker/supabase.ts";
import { eUnaPersona, utenteDelToken } from "../smm-worker/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

/**
 * L'indirizzo del motore si ricava da quello del rendering.
 *
 * Sono due rotte dello stesso progetto, e chiedere al manager di impostare
 * un secondo segreto con dentro quasi la stessa cosa e' un modo per farne
 * sbagliare uno. Se il primo non finisce per /render non si indovina: si
 * dice che non si sa dove andare.
 */
function indirizzoAvatar(render: string): string | null {
  const pulito = render.replace(/\/+$/, "");
  return pulito.endsWith("/render") ? pulito.slice(0, -"/render".length) + "/avatar" : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

    let autorizzato = Boolean(service && token === service);
    if (!autorizzato) {
      // Una persona, e per di piu' una che ha la Regia fra le pagine
      // concesse: la decide la matrice dei permessi, non questo codice.
      const chi = eUnaPersona(token) ? utenteDelToken(token) : null;
      if (chi) {
        try {
          autorizzato = await clientDaAmbiente()
            .rpc("smm_puo_usare", { p_user: chi }) === true;
        } catch { autorizzato = false; }
      }
    }
    if (!autorizzato) {
      return new Response(JSON.stringify({
        ok: false,
        error: "La Regia non e' fra le pagine che ti sono state concesse.",
      }), { status: 403, headers: CORS });
    }

    const render = Deno.env.get("REGIA_RENDER_URL");
    const segreto = Deno.env.get("REGIA_SECRET");
    const motore = render ? indirizzoAvatar(render) : null;
    if (!render || !segreto) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Mancano REGIA_RENDER_URL o REGIA_SECRET fra i segreti del progetto Supabase.",
      }), { status: 500, headers: CORS });
    }
    if (!motore) {
      return new Response(JSON.stringify({
        ok: false,
        error: `REGIA_RENDER_URL non finisce per /render (${render}), quindi non so dove stiano le foto.`,
      }), { status: 500, headers: CORS });
    }

    const corpo = await req.json().catch(() => ({}));
    const azione = String(corpo?.azione ?? "elenco");

    const r = await fetch(motore, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${segreto}` },
      body: JSON.stringify(corpo),
    });
    const esito = await r.json().catch(() => ({}));
    if (!r.ok || esito?.ok === false) {
      throw new Error(esito?.error ?? `Il motore ha risposto ${r.status}.`);
    }

    // Generare costa: resta scritto chi l'ha chiesto e quante.
    if (azione === "genera" || azione === "elimina") {
      await clientDaAmbiente().log(`smm_avatar_${azione}`, {
        quante: corpo?.quante ?? null, id: corpo?.id ?? null,
      }, utenteDelToken(token));
    }

    return new Response(JSON.stringify(esito), { headers: CORS });

  } catch (e) {
    const messaggio = (e as Error).message ?? String(e);
    console.error("[smm-avatar]", messaggio);
    return new Response(JSON.stringify({ ok: false, error: messaggio }),
      { status: 500, headers: CORS });
  }
});
