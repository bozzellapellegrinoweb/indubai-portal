/**
 * smm-newsletter — la newsletter, comandata dalla Regia.
 *
 * Come per le foto: il contenuto e lo storico vivono nel motore, qui si
 * controlla chi chiede e si gira la richiesta.
 *
 * L'invio pero' e' diverso da tutto il resto. Una pubblicazione sbagliata
 * si cancella; una mail partita a centinaia di persone no. Per questo
 * l'azione "invia" passa solo da una persona che ha la Regia fra le pagine
 * concesse - mai dalla chiave di servizio, cioe' mai da un agente o da un
 * automatismo - e resta scritto chi l'ha chiesta, con l'oggetto.
 */

import { clientDaAmbiente } from "../smm-worker/supabase.ts";
import { eUnaPersona, utenteDelToken } from "../smm-worker/auth.ts";
import { indirizzoMotore } from "../smm-worker/motore.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const corpo = await req.json().catch(() => ({}));
    const azione = String(corpo?.azione ?? "elenco");

    const chi = eUnaPersona(token) ? utenteDelToken(token) : null;
    let persona = false;
    if (chi) {
      try {
        persona = await clientDaAmbiente().rpc("smm_puo_usare", { p_user: chi }) === true;
      } catch { persona = false; }
    }
    const servizio = Boolean(service && token === service);

    // Mandare una mail a tutti i contatti non e' una cosa che puo' partire
    // da un automatismo: la chiede una persona, e si sa quale.
    if (azione === "invia" && !persona) {
      return new Response(JSON.stringify({
        ok: false,
        error: servizio
          ? "L'invio della newsletter lo chiede una persona, non un automatismo."
          : "La Regia non e' fra le pagine che ti sono state concesse.",
      }), { status: 403, headers: CORS });
    }
    if (!persona && !servizio) {
      return new Response(JSON.stringify({
        ok: false, error: "La Regia non e' fra le pagine che ti sono state concesse.",
      }), { status: 403, headers: CORS });
    }

    const segreto = Deno.env.get("REGIA_SECRET");
    const motore = indirizzoMotore("newsletter");
    if (!segreto || !motore) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Mancano REGIA_RENDER_URL o REGIA_SECRET fra i segreti del progetto Supabase.",
      }), { status: 500, headers: CORS });
    }

    const r = await fetch(motore, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${segreto}` },
      body: JSON.stringify(corpo),
    });
    const esito = await r.json().catch(() => ({}));
    if (!r.ok || esito?.ok === false) {
      throw new Error(esito?.error ?? `Il motore ha risposto ${r.status}.`);
    }

    if (azione === "invia" || azione === "genera") {
      await clientDaAmbiente().log(`smm_newsletter_${azione}`, {
        tipo: corpo?.tipo ?? null,
        oggetto: corpo?.contenuto?.subject ?? null,
        inviate: esito?.sent ?? null,
      }, chi);
    }

    return new Response(JSON.stringify(esito), { headers: CORS });

  } catch (e) {
    const messaggio = (e as Error).message ?? String(e);
    console.error("[smm-newsletter]", messaggio);
    return new Response(JSON.stringify({ ok: false, error: messaggio }),
      { status: 500, headers: CORS });
  }
});
