/**
 * smm-worker — il runtime degli agenti della Regia.
 *
 * Il social media manager lavora dal suo computer e non deve dipendere da
 * nessun PC accesso, quindi gli agenti girano qui.
 *
 * Come viene svegliato, e servono entrambi i modi:
 *
 *  - subito, con una chiamata senza attesa dal browser quando si crea un
 *    lavoro, cosi' la scena si muove nell'istante in cui si scrive al
 *    Direttore;
 *  - a ripetizione, da pg_cron ogni minuto (vedi
 *    20261110_smm_cron.sql), cosi' un lavoro non si perde se il browser si
 *    chiude, e i lavori figli vengono raccolti comunque.
 *
 * Un giro prende i lavori uno alla volta con smm_claim_job(), che rispetta
 * l'interruttore generale e il budget del giorno, e si ferma quando scade il
 * tempo o finiscono i lavori. Due worker in parallelo non prendono lo stesso
 * lavoro: ci pensa "for update skip locked" dentro quella funzione.
 */

import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { clientDaAmbiente, type SupabaseClient } from "./supabase.ts";
import { definizioniPer, STRUMENTI, type Contesto } from "./strumenti.ts";
import { costo } from "./prezzi.ts";
import { eUnaPersona } from "./auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Content-Type": "application/json",
};

/** Un giro non supera questo tempo: le edge function hanno un limite. */
const TEMPO_MASSIMO_MS = 50_000;
/** Giri di strumenti per lavoro: oltre questo l'agente sta girando a vuoto. */
const GIRI_MASSIMI = 12;

// ============================================================
// Il prompt di sistema
// ============================================================

interface Agente {
  id: string; slug: string; nome: string; ruolo: string;
  descrizione: string | null; system_prompt: string;
  model: string; max_tokens: number; strumenti: string[];
}

/**
 * Il prompt dell'agente e' quello scritto in tabella, con due sostituzioni e
 * una coda comune. La coda sta qui e non in tabella perche' riguarda il
 * funzionamento della Regia, non il mestiere dell'agente: se cambia, cambia
 * per tutti senza riscrivere otto righe di database.
 */
function prompt(
  agente: Agente, brand: { nome: string }, colleghi: Agente[], piano: string,
): string {
  const elenco = colleghi
    .filter((c) => c.slug !== agente.slug)
    .map((c) => `- ${c.slug}: ${c.nome}, ${c.ruolo}. ${c.descrizione ?? ""}`)
    .join("\n");

  const base = agente.system_prompt
    .replaceAll("{BRAND}", brand.nome)
    .replaceAll("{AGENTI}", elenco || "(nessun altro agente attivo)");

  // La direzione sta prima di tutto il resto: e' il motivo per cui l'agente
  // e' li'. Se e' vuota la sezione non compare, invece di dire "nessun
  // piano" e invitare a inventarselo.
  const direzione = piano
    ? `
────────────────────────────────────────
LA DIREZIONE DI QUESTA SETTIMANA

Questo e' il piano che il social media manager ha deciso. I numeri sono suoi:
non si alzano per fare bella figura e non si abbassano perche' sembrano
tanti. "Mancano" vuol dire che quelle uscite non esistono ancora ne' come
bozza ne' come posto in calendario.

${piano}

Se ti chiedono di lanciare quello che manca, parti da qui e assegna a chi
tocca secondo il piano. Se il piano e' gia' coperto, dillo invece di
produrre roba in piu': una settimana piena di contenuti mediocri vale meno
di una con quelli previsti fatti bene.
`
    : "";

  return `${base}
${direzione}
────────────────────────────────────────
COME FUNZIONA QUESTO POSTO

Lavori nella Regia social di ${brand.nome}, dentro il portale InDubai. Il
social media manager ti vede lavorare e legge quello che scrivi.

Il Cervello condiviso e' la memoria del brand: regole, note delle revisioni,
studi, specifiche di design. Cercalo con cervello_cerca prima di produrre
qualcosa. Le voci marcate VINCOLANTE non si discutono e non si aggirano: se
una richiesta ti chiede di violarne una, dillo invece di eseguire.

Quando hai finito, scrivi una risposta breve per il manager: una o due frasi,
in italiano, su cosa hai fatto e cosa serve adesso. Niente gergo tecnico,
niente elenchi di passaggi interni, nessun riferimento a prompt, token,
modelli o strumenti. Il manager e' un collega, non un amministratore di
sistema.

Se qualcosa non torna, dillo. Un agente che inventa un dato per non ammettere
che gli manca fa un danno peggiore di uno che chiede.`;
}

// ============================================================
// Un lavoro
// ============================================================

interface Job {
  id: string; brand_id: string; agent_id: string | null; content_id: string | null;
  tipo: string; titolo: string; richiesta: string; payload: Record<string, unknown>;
  risposta: string | null; richiesto_da: string | null; tentativi: number;
}

async function eseguiLavoroAgente(
  db: SupabaseClient, anthropic: Anthropic, job: Job,
): Promise<{ attivita: string; testo: string; costoUsd: number; tokenIn: number; tokenOut: number }> {
  const [agenti, brands, piano] = await Promise.all([
    db.select("smm_agents", `brand_id=eq.${job.brand_id}&attivo=eq.true&select=*&order=ordine`),
    db.select("smm_brands", `id=eq.${job.brand_id}&select=*`),
    // Il piano della settimana con quanto manca. Se la lettura non va, si
    // lavora senza: meglio un agente senza direzione che un lavoro fermo.
    db.rpc("smm_piano_in_parole", { p_brand: job.brand_id }).catch(() => ""),
  ]);
  const agente: Agente | undefined = agenti.find((a: Agente) => a.id === job.agent_id)
    ?? agenti.find((a: Agente) => a.slug === "direttore");
  if (!agente) throw new Error("Nessun agente disponibile per questo lavoro.");
  const brand = brands?.[0] ?? { nome: "InDubai" };

  const ctx: Contesto = {
    db, brandId: job.brand_id, jobId: job.id,
    agentId: agente.id, agentSlug: agente.slug,
    contentId: job.content_id,
    effetti: { figli: [] },
  };

  const strumenti = definizioniPer(agente.strumenti ?? []);

  // Il contenuto su cui lavorare viene detto esplicitamente, perche' un
  // agente che deve indovinare l'identificativo chiama contenuto_leggi a
  // vuoto.
  const apertura = [
    job.richiesta,
    job.content_id ? `\n(Il contenuto su cui lavorare ha content_id ${job.content_id}.)` : "",
    job.risposta ? `\n\nIl manager ha risposto alla tua domanda: ${job.risposta}` : "",
  ].join("");

  const messaggi: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: apertura },
  ];

  let tokenIn = 0, tokenOut = 0, costoUsd = 0;
  let testoFinale = "";
  let attivita = "sta leggendo la richiesta";

  for (let giro = 0; giro < GIRI_MASSIMI; giro++) {
    const risposta = await anthropic.beta.messages.create({
      model: agente.model,
      max_tokens: agente.max_tokens,
      // Il pensiero adattivo e' il modo giusto su questi modelli, e su
      // claude-opus-5-5 non si puo' nemmeno disattivare.
      thinking: { type: "adaptive" },
      system: prompt(agente, brand, agenti, typeof piano === "string" ? piano : ""),
      // tool_choice resta "auto": su questi modelli forzare "any" o un
      // nome di strumento risponde 400. L'indirizzo lo da' il prompt, e
      // strict: true tiene gli argomenti dentro lo schema.
      tool_choice: { type: "auto" },
      tools: strumenti,
      messages: messaggi,
      // Se un classificatore rifiuta la richiesta, il giro riparte da solo
      // su un altro modello invece di fermare il lavoro.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    tokenIn  += risposta.usage.input_tokens ?? 0;
    tokenOut += risposta.usage.output_tokens ?? 0;
    costoUsd += costo(risposta.model ?? agente.model, risposta.usage);

    // Un rifiuto va raccontato, non nascosto dietro un lavoro "fatto".
    if (risposta.stop_reason === "refusal") {
      const spieg = risposta.stop_details?.explanation ?? "nessuna spiegazione";
      throw new Error(`La richiesta e' stata rifiutata dai controlli di sicurezza del modello (${spieg}).`);
    }
    if (risposta.stop_reason === "max_tokens") {
      testoFinale += "\n(La risposta si e' interrotta per lunghezza.)";
    }

    // I blocchi vanno rimandati indietro tali e quali, blocchi di pensiero
    // compresi: l'API scarta da sola quelli che il modello non puo' leggere.
    messaggi.push({ role: "assistant", content: risposta.content });

    const chiamate = risposta.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    for (const b of risposta.content) {
      if (b.type === "text" && b.text.trim()) testoFinale += (testoFinale ? "\n" : "") + b.text.trim();
    }

    if (chiamate.length === 0) break;

    // Tutti i risultati in UN solo messaggio utente: spezzarli insegna al
    // modello a non chiamare piu' strumenti in parallelo.
    const risultati: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const chiamata of chiamate) {
      const strumento = STRUMENTI[chiamata.name];
      if (!strumento) {
        risultati.push({
          type: "tool_result", tool_use_id: chiamata.id, is_error: true,
          content: `Lo strumento "${chiamata.name}" non esiste.`,
        });
        continue;
      }
      if (!(agente.strumenti ?? []).includes(chiamata.name)) {
        risultati.push({
          type: "tool_result", tool_use_id: chiamata.id, is_error: true,
          content: `Non hai questo strumento. I tuoi sono: ${(agente.strumenti ?? []).join(", ")}.`,
        });
        continue;
      }
      attivita = attivitaPerStrumento(chiamata.name, agente);
      await db.update("smm_jobs", `id=eq.${job.id}`, { attivita });
      try {
        // L'input arriva come JSON: va letto con il parser, non a pezzi di
        // stringa, perche' l'escaping cambia fra modelli.
        const input = typeof chiamata.input === "string"
          ? JSON.parse(chiamata.input)
          : (chiamata.input as Record<string, unknown>);
        const esito = await strumento.esegui(input as Record<string, any>, ctx);
        risultati.push({ type: "tool_result", tool_use_id: chiamata.id, content: esito });
      } catch (e) {
        risultati.push({
          type: "tool_result", tool_use_id: chiamata.id, is_error: true,
          content: `Non ha funzionato: ${(e as Error).message}`,
        });
      }
    }
    messaggi.push({ role: "user", content: risultati });

    // Se l'agente ha alzato la mano, il giro finisce qui: aspetta una
    // persona, e continuare a girare costerebbe senza servire a niente.
    if (ctx.effetti.domanda) break;
  }

  // Gli effetti degli strumenti diventano stato del lavoro: e' quello che la
  // scena 3D legge per animare gli avatar.
  const patch: Record<string, unknown> = {};
  if (ctx.effetti.domanda) {
    patch.stato = "attesa_risposta";
    patch.domanda = ctx.effetti.domanda;
    patch.attivita = "ha una domanda";
  }
  if (ctx.effetti.contenutoTocca) patch.content_id = ctx.effetti.contenutoTocca;
  if (Object.keys(patch).length) await db.update("smm_jobs", `id=eq.${job.id}`, patch);

  return { attivita, testo: testoFinale.trim(), costoUsd, tokenIn, tokenOut };
}

/** Cosa dice il fumetto sopra la testa mentre lo strumento gira. */
function attivitaPerStrumento(nome: string, agente: Agente): string {
  switch (nome) {
    case "cervello_cerca":     return "consulta il Cervello";
    case "contenuto_leggi":    return "rilegge il contenuto";
    case "contenuto_crea":     return "apre un contenuto nuovo";
    case "contenuto_aggiorna": return agente.slug === "grafico" ? "monta le slide" : "scrive";
    case "coinvolgi_agente":   return "chiede una mano a un collega";
    case "chiedi_al_manager":  return "ha una domanda";
    case "revisore_verdetto":  return "chiude la revisione";
    case "calendario_proponi": return "cerca uno slot in calendario";
    case "pubblica":           return "prepara la pubblicazione";
    case "cervello_proponi":   return "scrive una nota per il Cervello";
    case "rendi_immagini":     return agente.slug === "video" ? "monta il video" : "prepara le immagini";
    default:                   return "sta lavorando";
  }
}

// ============================================================
// Il lavoro che generalizza una correzione del manager
// ============================================================

async function eseguiNotaCervello(
  db: SupabaseClient, anthropic: Anthropic, job: Job,
): Promise<{ testo: string; costoUsd: number; tokenIn: number; tokenOut: number }> {
  const noteId = (job.payload as { note_id?: string })?.note_id;
  if (!noteId) return { testo: "Nessuna nota da generalizzare.", costoUsd: 0, tokenIn: 0, tokenOut: 0 };

  const voci = await db.select("smm_brain",
    `origine_note_id=eq.${noteId}&select=id,testo&limit=1`);
  const voce = voci?.[0];
  if (!voce) return { testo: "La voce del Cervello non c'e' piu'.", costoUsd: 0, tokenIn: 0, tokenOut: 0 };

  const risposta = await anthropic.beta.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 1000,
    thinking: { type: "adaptive" },
    system:
      `Trasformi la correzione puntuale di un social media manager in una regola generale per il Cervello del brand.

Una correzione dice "qui non va": la regola dice "non si fa cosi', si fa cosi'".

Esempio. Correzione: "in questa slide il tono e' troppo commerciale".
Regola: "Nelle slide il tono resta informativo: niente formule da vendita diretta, il valore si mostra spiegando."

Regole per come scrivi:
- una o due frasi, in italiano, al presente;
- generale ma non vaga: deve servire a chi scrive il prossimo contenuto;
- non citare il contenuto specifico, la slide o il numero di round;
- se la correzione e' troppo specifica per generalizzarla, riscrivila piu' chiara e basta.

Rispondi SOLO con il testo della regola, senza virgolette e senza preamboli.`,
    messages: [{ role: "user", content: String(voce.testo) }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  const c = costo(risposta.model ?? "claude-haiku-5-5", risposta.usage);
  if (risposta.stop_reason === "refusal") {
    return { testo: "Il modello non ha generalizzato la nota: resta come l'ha scritta il manager.",
             costoUsd: c, tokenIn: risposta.usage.input_tokens ?? 0, tokenOut: risposta.usage.output_tokens ?? 0 };
  }

  const testo = risposta.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text.trim()).join(" ").trim();

  if (testo) {
    await db.update("smm_brain", `id=eq.${voce.id}`, {
      testo,
      fonte: `Revisione del ${new Date().toLocaleDateString("it-IT")}, generalizzata`,
      updated_at: new Date().toISOString(),
    });
  }

  return {
    testo: testo || "Non ho saputo generalizzarla: resta il testo originale.",
    costoUsd: c,
    tokenIn: risposta.usage.input_tokens ?? 0,
    tokenOut: risposta.usage.output_tokens ?? 0,
  };
}

// ============================================================
// Notifiche al manager
// ============================================================

async function avvisaManager(
  db: SupabaseClient, job: Job,
  titolo: string, corpo: string,
) {
  // Chi ha chiesto il lavoro, piu' tutti quelli che hanno la Regia: il
  // perimetro vero lo decide la RLS quando leggono.
  const destinatari = new Set<string>();
  if (job.richiesto_da) destinatari.add(job.richiesto_da);
  try {
    const profili = await db.select("profiles", `role=in.(admin,smm)&select=id`);
    for (const p of profili ?? []) destinatari.add(p.id);
  } catch { /* se non si leggono, resta chi ha chiesto */ }

  for (const uid of destinatari) {
    try {
      await db.insert("notifications", {
        user_id: uid, type: "smm", title: titolo, body: corpo,
        link: "/regia.html", entity_type: "smm_job", entity_id: job.id,
      });
    } catch { /* una notifica che non parte non ferma il lavoro */ }
  }

  // Push sul telefono, con il sistema che il portale ha gia'.
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  for (const uid of destinatari) {
    try {
      await fetch(`${url}/functions/v1/send-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          action: "send_to_user", user_id: uid,
          title: titolo, message: corpo, url: "/regia.html",
        }),
      });
    } catch { /* idem */ }
  }
}

// ============================================================
// Il giro
// ============================================================

async function unGiro(db: SupabaseClient, anthropic: Anthropic): Promise<{ fatti: number; dettagli: unknown[] }> {
  const inizio = Date.now();
  const dettagli: unknown[] = [];
  let fatti = 0;

  while (Date.now() - inizio < TEMPO_MASSIMO_MS) {
    const job: Job | null = await db.rpc("smm_claim_job", {});
    if (!job?.id) break;

    try {
      // Il budget per lavoro si controlla prima di spendere.
      const impostazioni = await db.select("smm_settings", `brand_id=eq.${job.brand_id}&select=*`);
      const s = impostazioni?.[0];
      if (s?.stop_tutto) throw new Error("Interruttore generale alzato: non parte niente.");

      let esito: { testo: string; costoUsd: number; tokenIn: number; tokenOut: number; attivita?: string };

      if (job.tipo === "nota_cervello") {
        esito = await eseguiNotaCervello(db, anthropic, job);
      } else if (job.tipo === "pubblicazione") {
        // La pubblicazione la fa smm-publish: qui si gira la palla.
        esito = await inoltraAPubblicazione(db, job);
      } else {
        esito = await eseguiLavoroAgente(db, anthropic, job);
      }

      // Il lavoro potrebbe essere passato in attesa di risposta mentre
      // girava: in quel caso non e' "fatto".
      const ora = await db.select("smm_jobs", `id=eq.${job.id}&select=stato,domanda`);
      const inAttesa = ora?.[0]?.stato === "attesa_risposta";

      await db.update("smm_jobs", `id=eq.${job.id}`, {
        ...(inAttesa ? {} : { stato: "fatto", finished_at: new Date().toISOString() }),
        risultato: { testo: esito.testo },
        token_in: esito.tokenIn,
        token_out: esito.tokenOut,
        costo_usd: Number(esito.costoUsd.toFixed(5)),
        attivita: inAttesa ? "ha una domanda" : null,
      });

      // La spesa si somma sul brand, cosi' il budget del giorno e' vero.
      if (s) {
        const oggi = new Date().toISOString().slice(0, 10);
        const giaOggi = s.speso_oggi_data === oggi ? Number(s.speso_oggi_usd) : 0;
        await db.update("smm_settings", `brand_id=eq.${job.brand_id}`, {
          speso_oggi_usd: Number((giaOggi + esito.costoUsd).toFixed(4)),
          speso_oggi_data: oggi,
          updated_at: new Date().toISOString(),
        });
      }

      // Il messaggio dell'agente finisce nella chat, cosi' il manager lo
      // legge nel pannello laterale.
      if (esito.testo && job.agent_id) {
        await db.insert("smm_messages", {
          brand_id: job.brand_id, agent_id: job.agent_id, job_id: job.id,
          content_id: job.content_id, autore: "agente", testo: esito.testo,
        });
      }

      if (inAttesa) {
        await avvisaManager(db, job, "Un agente ti ha fatto una domanda",
          ora?.[0]?.domanda ?? job.titolo);
      } else if (job.content_id) {
        const c = await db.select("smm_contents", `id=eq.${job.content_id}&select=stato,titolo`);
        if (c?.[0]?.stato === "da_approvare") {
          await avvisaManager(db, job, "Un contenuto e' pronto da approvare", c[0].titolo);
        } else if (c?.[0]?.stato === "respinto") {
          await avvisaManager(db, job, "Il Revisore ha fermato un contenuto", c[0].titolo);
        }
      }

      fatti++;
      dettagli.push({ job: job.id, tipo: job.tipo, costo: esito.costoUsd });
    } catch (e) {
      const messaggio = (e as Error).message ?? String(e);
      // Un lavoro che ha fallito due volte non si ritenta da solo: se la
      // causa e' stabile, ritentare brucia budget e non risolve.
      const riprovabile = job.tentativi < 2 && !/Interruttore generale/.test(messaggio);
      await db.update("smm_jobs", `id=eq.${job.id}`, {
        stato: riprovabile ? "in_coda" : "fallito",
        errore: messaggio.slice(0, 2000),
        attivita: null,
        ...(riprovabile ? {} : { finished_at: new Date().toISOString() }),
      });
      dettagli.push({ job: job.id, errore: messaggio, riprovabile });
      if (!riprovabile) {
        await avvisaManager(db, job, "Un agente si e' bloccato", `${job.titolo}: ${messaggio.slice(0, 160)}`);
      }
      if (/Interruttore generale/.test(messaggio)) break;
    }
  }

  return { fatti, dettagli };
}

async function inoltraAPubblicazione(db: SupabaseClient, job: Job) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${url}/functions/v1/smm-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ content_id: job.content_id, ...job.payload }),
  });
  const dati = await r.json().catch(() => ({}));
  if (!r.ok || dati?.ok === false) {
    throw new Error(dati?.error ?? `La pubblicazione non e' andata: HTTP ${r.status}`);
  }
  return {
    testo: dati?.messaggio ?? "Pubblicazione inviata a GoHighLevel.",
    costoUsd: 0, tokenIn: 0, tokenOut: 0,
  };
}

// ============================================================
// L'ingresso
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Chi puo' svegliare il worker: pg_cron con il segreto, oppure una
    // persona autenticata del portale. Un'esecuzione a vuoto non fa danni,
    // ma una coda che gira per chiunque si', perche' spende.
    const auth = req.headers.get("Authorization") ?? "";
    const segreto = Deno.env.get("CRON_SECRET");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const token = auth.replace(/^Bearer\s+/i, "");
    const autorizzato =
      (segreto && token === segreto) ||
      (service && token === service) ||
      // una persona autenticata del portale, non la chiave pubblica
      eUnaPersona(token);
    if (!autorizzato) {
      return new Response(JSON.stringify({ ok: false, error: "Non autorizzato" }),
        { status: 401, headers: CORS });
    }

    const chiave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!chiave) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Manca ANTHROPIC_API_KEY fra i segreti del progetto Supabase.",
      }), { status: 500, headers: CORS });
    }

    const db = clientDaAmbiente();
    const anthropic = new Anthropic({ apiKey: chiave });
    const esito = await unGiro(db, anthropic);

    return new Response(JSON.stringify({ ok: true, ...esito }), { headers: CORS });
  } catch (e) {
    console.error("[smm-worker]", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: CORS });
  }
});
