/**
 * Gli strumenti degli agenti.
 *
 * Ogni agente ha un elenco di strumenti in smm_agents.strumenti: qui ci sono
 * la definizione (cosa vede il modello) e l'esecuzione (cosa fa davvero).
 *
 * Due principi:
 *
 * 1. Lo strumento non e' il presidio. "pubblica" esiste solo sul
 *    Pubblicatore, ma cio' che impedisce davvero di pubblicare un contenuto
 *    non approvato sono i trigger del database. Un modello che si inventa
 *    una chiamata non combina niente.
 *
 * 2. Gli strumenti parlano italiano, perche' i loro risultati finiscono nei
 *    fumetti sopra le scrivanie e nella chat che legge il manager.
 */

import type Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import type { SupabaseClient } from "./supabase.ts";
import { indirizzoMotore } from "./motore.ts";

export interface Contesto {
  db: SupabaseClient;
  brandId: string;
  jobId: string;
  agentId: string | null;
  agentSlug: string;
  /** Come si chiama: finisce nei titoli che legge il manager, dove
   *  "Richiesta da copywriter" diceva lo slug invece della persona. */
  agentNome: string;
  contentId: string | null;
  /** popolato dagli strumenti: il worker lo legge dopo il giro */
  effetti: {
    domanda?: string;
    figli: { slug: string; richiesta: string }[];
    contenutoTocca?: string;
    verdetto?: { ok: boolean; violazioni: unknown[] };
    notizieViste?: number;
  };
}

export interface Strumento {
  nome: string;
  /** Il tipo viene dall'SDK: cosi' uno schema sbagliato lo trova il
   *  compilatore, non il primo giro in produzione. */
  definizione: Anthropic.Beta.BetaTool;
  esegui: (input: Record<string, any>, ctx: Contesto) => Promise<string>;
}

/** strict: true vuole additionalProperties: false e required completo. */
function schema(
  props: Record<string, unknown>, required: string[],
): Anthropic.Beta.BetaTool.InputSchema {
  return {
    type: "object",
    properties: props,
    required,
    additionalProperties: false,
  } as Anthropic.Beta.BetaTool.InputSchema;
}

// ── cervello_cerca ──────────────────────────────────────────
const cervelloCerca: Strumento = {
  nome: "cervello_cerca",
  definizione: {
    name: "cervello_cerca",
    description:
      "Cerca nel Cervello condiviso le regole, le note, gli studi e le specifiche di design del brand. " +
      "Chiamalo SEMPRE prima di produrre qualcosa: le regole del brand non sono negoziabili e cambiano nel tempo. " +
      "Le regole vincolanti sono incluse nei risultati anche quando la ricerca non le cita.",
    input_schema: schema({
      argomento: { type: "string", description: "Di cosa stai scrivendo, in italiano. Esempio: 'caption su Corporate Tax e soglia 375.000'" },
      tipi: {
        type: "array",
        items: { type: "string", enum: ["regola", "nota", "studio", "design"] },
        description: "Che genere di voci vuoi. Vuoto = tutte.",
      },
    }, ["argomento", "tipi"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const tipi = Array.isArray(input.tipi) && input.tipi.length ? input.tipi : null;
    const righe = await ctx.db.rpc("smm_cervello_cerca", {
      p_brand: ctx.brandId,
      p_query: String(input.argomento ?? ""),
      p_tipi: tipi,
      p_limite: 20,
    });
    if (!righe?.length) return "Il Cervello non ha niente su questo argomento.";
    return righe.map((r: any) =>
      `[${r.codice ?? r.tipo}]${r.vincolante ? " VINCOLANTE" : ""} ${r.testo}` +
      (r.fonte ? `\n    fonte: ${r.fonte}` : "")
    ).join("\n");
  },
};

// ── contenuto_leggi ─────────────────────────────────────────
const contenutoLeggi: Strumento = {
  nome: "contenuto_leggi",
  definizione: {
    name: "contenuto_leggi",
    description: "Legge un contenuto con la sua versione corrente, le note della revisione e lo stato.",
    input_schema: schema({
      content_id: { type: "string", description: "L'identificativo del contenuto. Se stai lavorando su un contenuto assegnato, e' quello che trovi nella richiesta." },
    }, ["content_id"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const id = String(input.content_id);
    const righe = await ctx.db.select("smm_contents", `id=eq.${id}&select=*`);
    const c = righe?.[0];
    if (!c) return "Contenuto non trovato.";
    const note = await ctx.db.select("smm_notes",
      `content_id=eq.${id}&risolta=eq.false&select=testo,ancora&order=created_at.desc&limit=20`);
    return JSON.stringify({
      titolo: c.titolo, tipo: c.tipo, stato: c.stato, brief: c.brief,
      caption: c.caption, hashtags: c.hashtags, slides: c.slides,
      pillar: c.pillar, categoria: c.categoria,
      revisore_ok: c.revisore_ok, revisore_note: c.revisore_note,
      note_aperte: note ?? [],
    }, null, 1);
  },
};

// ── contenuto_crea ──────────────────────────────────────────
const contenutoCrea: Strumento = {
  nome: "contenuto_crea",
  definizione: {
    name: "contenuto_crea",
    description:
      "Crea un contenuto nuovo, allo stato di idea. Serve quando il manager chiede qualcosa che non esiste ancora. " +
      "Il testo vero lo scrive poi il Copywriter: qui bastano titolo e brief.",
    input_schema: schema({
      titolo:    { type: "string", description: "Titolo di lavoro, breve, per riconoscerlo nell'elenco" },
      tipo:      { type: "string", enum: ["carosello", "reel", "storia", "post"] },
      brief:     { type: "string", description: "Cosa deve dire e perche', in italiano" },
      pillar:    { type: "string", description: "Il pillar editoriale. Vuoto se non lo sai." },
      categoria: { type: "string", description: "Categoria: fiscale, normativa, residenza, strutture, lifestyle, dati. Vuoto se non lo sai." },
    }, ["titolo", "tipo", "brief", "pillar", "categoria"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const righe = await ctx.db.insert("smm_contents", {
      brand_id: ctx.brandId,
      titolo: String(input.titolo).slice(0, 200),
      tipo: input.tipo,
      brief: input.brief,
      pillar: input.pillar || null,
      categoria: input.categoria || null,
      stato: "idea",
    });
    const id = righe?.[0]?.id;
    ctx.effetti.contenutoTocca = id;
    return `Creato. content_id: ${id}`;
  },
};

// ── contenuto_aggiorna ──────────────────────────────────────
const contenutoAggiorna: Strumento = {
  nome: "contenuto_aggiorna",
  definizione: {
    name: "contenuto_aggiorna",
    description:
      "Salva il tuo lavoro su un contenuto: caption, hashtag, slide. Ogni salvataggio crea una versione nuova, " +
      "cosi' il manager puo' confrontare i round. Scrivi la sintesi di cosa hai cambiato: la legge una persona.",
    input_schema: schema({
      content_id: { type: "string" },
      caption:    { type: "string", description: "Il testo del post. Vuoto per non toccarlo." },
      hashtags:   { type: "array", items: { type: "string" }, description: "Gli hashtag, con il cancelletto. Vuoto per non toccarli." },
      slides:     { type: "string", description: "Le slide come JSON array. Vuoto per non toccarle." },
      sintesi:    { type: "string", description: "Una riga su cosa hai cambiato e perche'" },
    }, ["content_id", "caption", "hashtags", "slides", "sintesi"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const id = String(input.content_id);
    const patch: Record<string, unknown> = { stato: "in_lavorazione" };
    if (input.caption) patch.caption = input.caption;
    if (Array.isArray(input.hashtags) && input.hashtags.length) patch.hashtags = input.hashtags;
    if (input.slides) {
      try { patch.slides = JSON.parse(input.slides); }
      catch { return "Le slide non sono JSON valido: non ho salvato niente. Riprova con un array JSON."; }
    }
    // Una modifica azzera il via libera: un contenuto cambiato dopo la
    // revisione va rivisto, altrimenti si approva una cosa diversa da
    // quella controllata.
    patch.revisore_ok = false;
    await ctx.db.update("smm_contents", `id=eq.${id}`, patch);

    const prec = await ctx.db.select("smm_content_versions",
      `content_id=eq.${id}&select=round&order=round.desc&limit=1`);
    const round = (prec?.[0]?.round ?? 0) + 1;
    const ora = await ctx.db.select("smm_contents", `id=eq.${id}&select=caption,slides`);
    await ctx.db.insert("smm_content_versions", {
      content_id: id, round, agent_id: ctx.agentId,
      caption: ora?.[0]?.caption ?? null,
      slides: ora?.[0]?.slides ?? [],
      sintesi: input.sintesi || null,
    });
    ctx.effetti.contenutoTocca = id;
    return `Salvato come round ${round}. Il via libera del Revisore e' stato azzerato, perche' il contenuto e' cambiato.`;
  },
};

// ── coinvolgi_agente ────────────────────────────────────────
const coinvolgiAgente: Strumento = {
  nome: "coinvolgi_agente",
  definizione: {
    name: "coinvolgi_agente",
    description:
      "Chiede a un altro agente di fare la sua parte. Usalo quando ti serve qualcosa che non e' il tuo mestiere: " +
      "il Copywriter chiede un'immagine al Grafico, il Grafico chiede un testo al Copywriter. " +
      "Spiega cosa serve e perche': l'altro agente non vede la tua conversazione.",
    input_schema: schema({
      agente:    { type: "string", description: "Lo slug dell'agente: stratega, copywriter, grafico, video, revisore, pubblicatore, analista" },
      richiesta: { type: "string", description: "Cosa gli chiedi, con il contesto che gli serve" },
      content_id:{ type: "string", description: "Il contenuto su cui lavorare. Vuoto se non c'e'." },
    }, ["agente", "richiesta", "content_id"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const slug = String(input.agente).trim().toLowerCase();
    const righe = await ctx.db.select("smm_agents",
      `brand_id=eq.${ctx.brandId}&slug=eq.${slug}&attivo=eq.true&select=id,nome`);
    const ag = righe?.[0];
    if (!ag) return `Non esiste un agente con lo slug "${slug}". Controlla il nome.`;
    await ctx.db.insert("smm_jobs", {
      brand_id: ctx.brandId, agent_id: ag.id, parent_job_id: ctx.jobId,
      content_id: input.content_id || ctx.contentId || null,
      tipo: "agente",
      titolo: `Richiesta da ${ctx.agentNome || ctx.agentSlug}`,
      richiesta: input.richiesta,
      priorita: 60,
    });
    ctx.effetti.figli.push({ slug, richiesta: String(input.richiesta) });
    return `Ho passato la richiesta a ${ag.nome}. Lavora in parallelo: non aspettarlo, il manager vede il risultato quando arriva.`;
  },
};

// ── chiedi_al_manager ───────────────────────────────────────
const chiediAlManager: Strumento = {
  nome: "chiedi_al_manager",
  definizione: {
    name: "chiedi_al_manager",
    description:
      "Fa UNA domanda al social media manager e si ferma ad aspettare. Usalo solo quando manca una cosa che " +
      "cambia davvero il lavoro e non puoi deciderla con buon senso. Una domanda che potevi evitare costa " +
      "tempo a una persona: se puoi decidere, decidi.",
    input_schema: schema({
      domanda: { type: "string", description: "La domanda, breve e precisa, in italiano semplice" },
    }, ["domanda"]),
    strict: true,
  },
  async esegui(input, ctx) {
    ctx.effetti.domanda = String(input.domanda);
    return "Ho alzato la mano. Chiudi qui il tuo giro: riprenderai quando il manager risponde.";
  },
};

// ── revisore_verdetto ───────────────────────────────────────
const revisoreVerdetto: Strumento = {
  nome: "revisore_verdetto",
  definizione: {
    name: "revisore_verdetto",
    description:
      "Registra l'esito della revisione di conformita'. Chiamalo una volta sola, quando hai finito di controllare. " +
      "Se l'esito e' positivo il contenuto passa in approvazione; se e' negativo torna a chi l'ha scritto con i motivi.",
    input_schema: schema({
      content_id: { type: "string" },
      approvato:  { type: "boolean", description: "Vero solo se non c'e' nessuna violazione di gravita' critica" },
      violazioni: {
        type: "array",
        description: "Una voce per violazione. Vuoto se non ne hai trovate: non inventarne per sembrare utile.",
        items: schema({
          testo:      { type: "string", description: "Il pezzo di testo che non va, copiato esatto" },
          correzione: { type: "string", description: "Cosa scrivere al suo posto" },
          gravita:    { type: "string", enum: ["critica", "avvertimento"] },
          regola:     { type: "string", description: "Il codice della regola del Cervello, per esempio R-QUAL-02" },
        }, ["testo", "correzione", "gravita", "regola"]),
      },
      commento: { type: "string", description: "Una o due righe per il manager, in italiano" },
    }, ["content_id", "approvato", "violazioni", "commento"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const id = String(input.content_id);
    const violazioni = Array.isArray(input.violazioni) ? input.violazioni : [];
    const critiche = violazioni.filter((v: any) => v?.gravita === "critica");
    // L'esito lo decidono le violazioni, non il campo "approvato": un
    // modello che elenca una violazione critica e poi scrive approvato=true
    // si contraddice, e in quel caso vale l'elenco.
    const ok = critiche.length === 0 && input.approvato === true;

    const patch: Record<string, unknown> = {
      revisore_ok: ok,
      revisore_note: { violazioni, commento: input.commento ?? null },
      revisore_at: new Date().toISOString(),
    };
    await ctx.db.update("smm_contents", `id=eq.${id}`, patch);

    if (ok) {
      // Il passaggio di stato e' separato perche' il trigger del database lo
      // rifiuta se revisore_ok non e' ancora vero sulla riga.
      try {
        await ctx.db.update("smm_contents", `id=eq.${id}`, { stato: "da_approvare" });
      } catch (e) {
        // Il presidio sui termini vietati puo' aver fermato il passaggio:
        // vuol dire che il modello ha lasciato passare una parola vietata.
        await ctx.db.update("smm_contents", `id=eq.${id}`, {
          revisore_ok: false,
          revisore_note: {
            violazioni, commento: input.commento ?? null,
            bloccato_dal_database: String((e as Error).message),
          },
        });
        ctx.effetti.verdetto = { ok: false, violazioni };
        return "Il database ha rifiutato il via libera: nel contenuto c'e' ancora un termine vietato. " +
               "Rileggi la regola R-QUAL-02 nel Cervello e segnala la violazione.";
      }
    } else {
      await ctx.db.update("smm_contents", `id=eq.${id}`, { stato: "respinto" });
    }
    ctx.effetti.verdetto = { ok, violazioni };
    ctx.effetti.contenutoTocca = id;
    return ok
      ? "Via libera registrato. Il contenuto e' passato in approvazione."
      : `Respinto, con ${critiche.length} violazioni critiche e ${violazioni.length - critiche.length} avvertimenti.`;
  },
};

// ── calendario_proponi ──────────────────────────────────────
const calendarioProponi: Strumento = {
  nome: "calendario_proponi",
  definizione: {
    name: "calendario_proponi",
    description:
      "Propone un giorno e un'ora di uscita per un contenuto approvato. Non pubblica: mette il contenuto in " +
      "calendario, e il manager puo' sempre spostarlo trascinandolo.",
    input_schema: schema({
      content_id: { type: "string" },
      quando:     { type: "string", description: "Data e ora in formato ISO 8601, fuso di Dubai. Esempio: 2026-11-14T18:00:00+04:00" },
      perche:     { type: "string", description: "Una riga: perche' quel momento" },
    }, ["content_id", "quando", "perche"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const id = String(input.content_id);
    const righe = await ctx.db.select("smm_contents", `id=eq.${id}&select=stato,approvato_da`);
    const c = righe?.[0];
    if (!c) return "Contenuto non trovato.";
    if (!c.approvato_da) {
      return "Questo contenuto non e' ancora approvato dal manager: in calendario ci va dopo l'approvazione. " +
             "Lascialo in attesa e dillo al manager.";
    }
    const quando = new Date(String(input.quando));
    if (isNaN(quando.getTime())) return "La data non e' valida. Usa il formato ISO 8601.";
    await ctx.db.update("smm_contents", `id=eq.${id}`, {
      slot_at: quando.toISOString(), stato: "in_calendario",
    });
    ctx.effetti.contenutoTocca = id;
    return `Messo in calendario il ${quando.toLocaleString("it-IT", { timeZone: "Asia/Dubai" })} (ora di Dubai).`;
  },
};

// ── pubblica ────────────────────────────────────────────────
const pubblica: Strumento = {
  nome: "pubblica",
  definizione: {
    name: "pubblica",
    description:
      "Manda un contenuto in pubblicazione su GoHighLevel. Funziona solo su contenuti che il Revisore ha passato " +
      "e che il manager ha approvato: in caso contrario il database rifiuta, e non e' una formalita'.",
    input_schema: schema({
      content_id:  { type: "string" },
      piattaforme: { type: "array", items: { type: "string" }, description: "instagram, facebook, linkedin, tiktok, youtube" },
      formato:     { type: "string", enum: ["carosello", "reel", "storia"] },
    }, ["content_id", "piattaforme", "formato"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const id = String(input.content_id);
    const righe = await ctx.db.insert("smm_jobs", {
      brand_id: ctx.brandId, content_id: id, parent_job_id: ctx.jobId,
      tipo: "pubblicazione",
      titolo: "Pubblicazione su GHL",
      richiesta: `Pubblica ${id} su ${(input.piattaforme ?? []).join(", ")} come ${input.formato}`,
      payload: { piattaforme: input.piattaforme, formato: input.formato },
      priorita: 80,
    });
    return `Messo in coda per la pubblicazione (lavoro ${righe?.[0]?.id}). ` +
           `Il controllo su revisione e approvazione lo fa il database al momento dell'invio.`;
  },
};

// ── cervello_proponi ────────────────────────────────────────
const cervelloProponi: Strumento = {
  nome: "cervello_proponi",
  definizione: {
    name: "cervello_proponi",
    description:
      "Propone una voce nuova per il Cervello. Non entra subito in vigore: resta da confermare, e il manager la " +
      "approva con un tasto. Una nota utile e' concreta e verificabile, non generica.",
    input_schema: schema({
      tipo:  { type: "string", enum: ["nota", "studio", "design"] },
      testo: { type: "string", description: "La voce, in una o due frasi" },
      fonte: { type: "string", description: "Da dove viene: quali contenuti, quali numeri" },
      tags:  { type: "array", items: { type: "string" } },
    }, ["tipo", "testo", "fonte", "tags"]),
    strict: true,
  },
  async esegui(input, ctx) {
    await ctx.db.insert("smm_brain", {
      brand_id: ctx.brandId, tipo: input.tipo, testo: input.testo,
      fonte: input.fonte || `Proposta da ${ctx.agentNome || ctx.agentSlug}`,
      tags: Array.isArray(input.tags) ? input.tags : [],
      peso: 50, confermata: false,
    });
    return "Proposta registrata. Il manager la vede nel Cervello e la conferma con un tasto.";
  },
};

// ── rendi_immagini ──────────────────────────────────────────
const rendiImmagini: Strumento = {
  nome: "rendi_immagini",
  definizione: {
    name: "rendi_immagini",
    description:
      "Trasforma le slide scritte nel contenuto in file veri: le immagini del carosello, il video del reel, " +
      "i video della storia. Chiamalo quando le slide sono finite, non prima: ogni chiamata rifa' tutto da capo. " +
      "Senza questo passaggio non si puo' pubblicare, perche' GoHighLevel ha bisogno dei file.",
    input_schema: schema({
      content_id: { type: "string" },
      formato: {
        type: "string", enum: ["carosello", "reel", "storia"],
        description: "Che cosa produrre. Di solito coincide con il tipo del contenuto.",
      },
    }, ["content_id", "formato"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return "Non riesco a raggiungere il motore: manca la configurazione del progetto.";

    const r = await fetch(`${url}/functions/v1/smm-render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ content_id: input.content_id, formato: input.formato }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.ok === false) {
      return `Il rendering non e' andato: ${d?.error ?? "HTTP " + r.status}. ` +
             "Non insistere: se manca una configurazione, riprovare non la fa comparire.";
    }
    ctx.effetti.contenutoTocca = String(input.content_id);
    return `${d.messaggio ?? "Fatto."} I file sono caricati e pronti per la pubblicazione.`;
  },
};

// ── cerca_notizie ─────────────────────────────────────────
const cercaNotizie: Strumento = {
  nome: "cerca_notizie",
  definizione: {
    name: "cerca_notizie",
    description:
      "Legge le notizie del settore dalle fonti che il brand segue da sempre: testate degli Emirati, " +
      "l'autorita' fiscale FTA, le free zone, e i blog dei concorrenti. Serve quando il contenuto deve " +
      "partire dall'attualita' invece che dalla memoria: una notizia di ieri e' il motivo per cui qualcuno " +
      "si ferma a leggere oggi. Non inventare mai una notizia: se qui non c'e', non e' successa.",
    input_schema: schema({
      argomento: {
        type: "string",
        description: "Le parole da cercare fra titolo e sommario, tutte presenti. " +
                     "Vuoto per vedere tutto quello che c'e' oggi.",
      },
      quante: { type: "integer", description: "Quante riceverne, da 1 a 25. Dodici e' una buona misura." },
    }, ["argomento", "quante"]),
    strict: true,
  },
  async esegui(input, ctx) {
    const motore = indirizzoMotore("notizie");
    const segreto = Deno.env.get("REGIA_SECRET");
    if (!motore || !segreto) {
      return "Non riesco a raggiungere le fonti: manca la configurazione del motore. " +
             "Dillo al manager invece di scrivere a memoria.";
    }
    try {
      const r = await fetch(motore, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${segreto}` },
        body: JSON.stringify({ argomento: input.argomento ?? "", quante: input.quante ?? 12 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) {
        return `Le fonti non hanno risposto: ${d?.error ?? "HTTP " + r.status}. ` +
               "Non inventare una notizia al loro posto.";
      }
      const notizie = Array.isArray(d.notizie) ? d.notizie : [];
      if (!notizie.length) {
        return input.argomento
          ? `Nessuna notizia su "${input.argomento}" fra quelle di oggi. ` +
            "Prova parole piu' larghe, oppure scrivi di qualcosa che non dipende dall'attualita'."
          : "Oggi le fonti non danno niente di rilevante.";
      }
      ctx.effetti.notizieViste = notizie.length;
      return notizie.map((n: Record<string, string>) =>
        `[${n.fonte}${n.quando ? " · " + String(n.quando).slice(0, 10) : ""}] ${n.titolo}\n` +
        `    ${n.sommario ?? ""}\n    ${n.indirizzo ?? ""}`
      ).join("\n\n");
    } catch (e) {
      return `Non ho raggiunto le fonti: ${(e as Error).message}. Non inventare una notizia al loro posto.`;
    }
  },
};

export const STRUMENTI: Record<string, Strumento> = Object.fromEntries(
  [cervelloCerca, contenutoLeggi, contenutoCrea, contenutoAggiorna, coinvolgiAgente,
   chiediAlManager, revisoreVerdetto, calendarioProponi, pubblica, cervelloProponi,
   rendiImmagini, cercaNotizie]
    .map((s) => [s.nome, s]),
);

/** Le definizioni da passare all'API, nell'ordine dichiarato sull'agente. */
export function definizioniPer(nomi: string[]): Anthropic.Beta.BetaTool[] {
  return nomi
    .map((n) => STRUMENTI[n]?.definizione)
    .filter((d): d is Anthropic.Beta.BetaTool => Boolean(d));
}
