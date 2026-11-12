/**
 * smm-publish — la pubblicazione su GoHighLevel.
 *
 * Riscrive in Deno la logica di lib/ghl.ts del progetto esistente, con le
 * stesse regole, che non sono dettagli: sono cose imparate sbagliando, e
 * stanno nel Cervello come R-GHL-01..13 (vedi docs/SMM_INVENTARIO.md).
 *
 * Le due regole che contano piu' di tutte:
 *
 *  - una storia non vuole scheduleDate. Con la data, GHL la trasforma in un
 *    post normale, e il contenuto esce nel posto sbagliato.
 *  - Facebook accetta una sola slide nelle storie: con piu' media risponde
 *    422 e non pubblica niente.
 *
 * Qui non c'e' nessun controllo di approvazione fatto "per sicurezza":
 * il controllo vero e' il trigger del database che rifiuta il passaggio di
 * stato. Questa funzione lo legge prima per dare un messaggio comprensibile,
 * e cambia lo stato alla fine: se il trigger rifiuta, non si pubblica.
 */

import { clientDaAmbiente, type SupabaseClient } from "../smm-worker/supabase.ts";
import { eUnaPersona } from "../smm-worker/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
/** R-GHL-10: la pubblicazione social usa questa versione. */
const GHL_VERSION = "2021-07-28";
/** R-GHL-08 */
const SOLO_VIDEO = ["tiktok", "youtube", "instagram_reels"];
/** R-GHL-09 */
const MAX_MEDIA = 10;

interface Account { id: string; name: string; platform: string }

function intestazioniGhl(chiave: string) {
  return {
    Authorization: `Bearer ${chiave}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
  };
}

async function accountCollegati(chiave: string, location: string): Promise<Account[]> {
  const r = await fetch(`${GHL_BASE}/social-media-posting/${location}/accounts`, {
    headers: intestazioniGhl(chiave),
  });
  if (!r.ok) throw new Error(`GoHighLevel non risponde sugli account: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return (d.results?.accounts ?? d.accounts ?? d) as Account[];
}

async function creaPost(
  chiave: string, location: string, userId: string,
  accountIds: string[], testo: string, media: { url: string; type: string }[],
  tipo: string, quando: Date | null,
): Promise<string> {
  const corpo: Record<string, unknown> = {
    userId, accountIds, type: tipo, summary: testo, media,
  };
  // R-GHL-01: le storie non portano scheduleDate, altrimenti diventano post.
  if (quando && tipo !== "story") corpo.scheduleDate = quando.toISOString();

  const r = await fetch(`${GHL_BASE}/social-media-posting/${location}/posts`, {
    method: "POST", headers: intestazioniGhl(chiave), body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GoHighLevel ha rifiutato il post (${r.status}): ${JSON.stringify(d).slice(0, 400)}`);
  return d.post?.id ?? d.id ?? "ok";
}

/** I media del contenuto, nell'ordine, con l'URL che GHL puo' scaricare. */
/**
 * Il numero di pagina, che sta in fondo al nome del file.
 *
 * I file di un rendering nascono tutti nello stesso secondo, quindi
 * ordinarli per data di creazione vuol dire ordinarli a caso. Su una storia
 * si vedrebbe subito: le slide uscirebbero mescolate.
 *
 *   story_<id>_3          -> 3
 *   post_<id>_2_content   -> 2
 */
function numeroPagina(nome: string): number {
  const m = String(nome ?? "").match(/_(\d+)(?:_[a-z]+)?$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

async function mediaDelContenuto(
  db: SupabaseClient, contentId: string, formato: string,
): Promise<{ url: string; type: string }[]> {
  const righe = await db.select("smm_media",
    `content_id=eq.${contentId}&ruolo=in.(derivato,originale)` +
    `&select=cloudinary_url,mime,ruolo,nome_file,path`);

  // Solo i media con un URL pubblico: GHL li scarica lui, quindi un link
  // firmato a scadenza non va bene. E' l'unica eccezione al "mai pubblico".
  const utili = (righe ?? [])
    .filter((m: { cloudinary_url?: string }) => m.cloudinary_url)
    .sort((a: { nome_file?: string; path?: string }, b: { nome_file?: string; path?: string }) =>
      numeroPagina(a.nome_file ?? a.path ?? "") - numeroPagina(b.nome_file ?? b.path ?? ""));

  const video = utili.filter((m: { mime?: string }) => (m.mime ?? "").startsWith("video"));
  const immagini = utili.filter((m: { mime?: string }) => !(m.mime ?? "").startsWith("video"));

  if (formato === "reel") {
    if (!video.length) return [];
    return [{ url: video[0].cloudinary_url, type: "video/mp4" }];
  }

  // Una storia e' fatta di video, uno per slide: il montaggio produce MP4
  // con l'audio del brand, non immagini. Qui cadeva nel ramo del carosello
  // e andava a cercare immagini che non esistono, quindi non usciva niente
  // e il messaggio parlava di caroselli su un contenuto che era una storia.
  //
  // Le immagini restano come ripiego, perche' il motore sa rendere una
  // storia anche come PNG se glielo si chiede.
  if (formato === "storia") {
    const scelti = video.length ? video : immagini;
    return scelti.slice(0, MAX_MEDIA).map((m: { cloudinary_url: string; mime?: string }) => ({
      url: m.cloudinary_url,
      type: (m.mime ?? "").startsWith("video") ? "video/mp4" : "image/jpeg",
    }));
  }

  return immagini.slice(0, MAX_MEDIA).map((m: { cloudinary_url: string }) => ({
    url: m.cloudinary_url, type: "image/jpeg",
  }));
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const autorizzato = (service && token === service) || eUnaPersona(token);
    if (!autorizzato) {
      return new Response(JSON.stringify({ ok: false, error: "Non autorizzato" }),
        { status: 401, headers: CORS });
    }

    const chiave   = Deno.env.get("GHL_API_KEY");
    const location = Deno.env.get("GHL_LOCATION_ID");
    const userId   = Deno.env.get("GHL_USER_ID");
    // Dire QUALI mancano, non elencarle tutte e tre: con tre nomi in fila
    // si va a controllarle tutte, e quella sbagliata resta l'ultima che
    // guardi. Il nome non e' un segreto; il valore non compare mai.
    const assenti = [
      ["GHL_API_KEY", chiave], ["GHL_LOCATION_ID", location], ["GHL_USER_ID", userId],
    ].filter(([, v]) => !v).map(([n]) => n);
    if (assenti.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: `${assenti.length === 1 ? "Manca" : "Mancano"} ${assenti.join(" e ")} `
             + "fra i segreti del progetto Supabase. Attenzione: una variabile appena aggiunta "
             + "la vede solo un'istanza avviata dopo, quindi puo' servire un nuovo rilascio.",
      }), { status: 500, headers: CORS });
    }

    const corpo = await req.json();
    const contentId: string = corpo.content_id;
    const piattaforme: string[] = (corpo.piattaforme ?? ["instagram", "facebook"])
      .map((p: string) => String(p).toLowerCase());
    const formato: string = corpo.formato ?? "carosello";
    const prova: boolean = corpo.prova === true;

    if (!contentId) {
      return new Response(JSON.stringify({ ok: false, error: "Manca content_id" }),
        { status: 400, headers: CORS });
    }

    const db = clientDaAmbiente();
    const righe = await db.select("smm_contents", `id=eq.${contentId}&select=*`);
    const c = righe?.[0];
    if (!c) {
      return new Response(JSON.stringify({ ok: false, error: "Contenuto non trovato" }),
        { status: 404, headers: CORS });
    }

    // Letto prima per dire una cosa comprensibile. Il presidio e' il trigger.
    if (!c.revisore_ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Il Revisore di conformita' non ha passato questo contenuto: non si pubblica.",
      }), { status: 409, headers: CORS });
    }
    if (!c.approvato_da || !c.approvato_at) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Manca l'approvazione del manager: non si pubblica senza una firma umana registrata.",
      }), { status: 409, headers: CORS });
    }
    if (c.stato === "pubblicato") {
      return new Response(JSON.stringify({
        ok: true, messaggio: "Questo contenuto era gia' pubblicato.", ghl_post_id: c.ghl_post_id,
      }), { headers: CORS });
    }

    // ── il testo ──
    // R-GHL-11: caption, due ritorni a capo, hashtag.
    const hashtags = (c.hashtags ?? []).join(" ");
    const testo = hashtags ? `${c.caption ?? ""}\n\n${hashtags}` : (c.caption ?? "");

    // ── i media ──
    const media = await mediaDelContenuto(db, contentId, formato);
    if (!media.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: formato === "reel"
          ? "Non c'e' nessun video pronto per il reel. Serve il montaggio prima della pubblicazione."
          : formato === "storia"
          ? "Non c'e' nessun file pronto per la storia. Serve il montaggio prima della pubblicazione."
          : "Non c'e' nessuna immagine pronta con un indirizzo pubblico. Il carosello va generato e caricato prima.",
      }), { status: 409, headers: CORS });
    }

    // ── gli account ──
    const accounts = await accountCollegati(chiave, location);
    const trova = (p: string) => accounts.find((a) => a.platform?.toLowerCase() === p);
    const mancanti = piattaforme.filter((p) => !trova(p));
    const presenti = piattaforme.filter((p) => trova(p));
    if (!presenti.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Su GoHighLevel non c'e' nessun account collegato per: ${piattaforme.join(", ")}.`,
      }), { status: 409, headers: CORS });
    }

    // R-GHL-07: chiamate separate per le piattaforme a immagine e per quelle
    // solo video, perche' vogliono media e tipi diversi.
    const videoOnly = presenti.filter((p) => SOLO_VIDEO.includes(p));
    const conImmagini = presenti.filter((p) => !SOLO_VIDEO.includes(p));

    const quando = c.slot_at ? new Date(c.slot_at) : null;
    const esiti: { piattaforme: string[]; tipo: string; post_id: string }[] = [];

    if (prova) {
      return new Response(JSON.stringify({
        ok: true, prova: true,
        messaggio: "Prova: non ho pubblicato niente.",
        avrei_inviato: {
          testo: testo.slice(0, 300),
          media: media.length,
          immagini: conImmagini, solo_video: videoOnly,
          tipo: formato === "storia" ? "story" : formato === "reel" ? "reel" : "post",
          scheduleDate: formato === "storia" ? null : quando?.toISOString() ?? null,
        },
        account_mancanti: mancanti,
      }), { headers: CORS });
    }

    // ── piattaforme a immagine ──
    if (conImmagini.length) {
      // R-GHL-05/06: reel vuole tipo reel e video, il post vuole immagini.
      const tipo = formato === "storia" ? "story" : formato === "reel" ? "reel" : "post";

      // R-GHL-02/03: su Facebook una storia prende solo la prima slide.
      const soloFacebook = conImmagini.filter((p) => p === "facebook");
      const altre = conImmagini.filter((p) => p !== "facebook");

      if (altre.length) {
        const id = await creaPost(chiave, location, userId,
          altre.map((p) => trova(p)!.id), testo, media, tipo, quando);
        esiti.push({ piattaforme: altre, tipo, post_id: id });
      }
      if (soloFacebook.length) {
        const mediaFb = tipo === "story" ? media.slice(0, 1) : media;
        const id = await creaPost(chiave, location, userId,
          soloFacebook.map((p) => trova(p)!.id), testo, mediaFb, tipo, quando);
        esiti.push({ piattaforme: soloFacebook, tipo, post_id: id });
      }
    }

    // ── piattaforme solo video ──
    if (videoOnly.length) {
      const video = media.find((m) => m.type.startsWith("video"));
      if (!video) {
        // Meglio dirlo che pubblicare un'immagine dove serve un video.
        esiti.push({ piattaforme: videoOnly, tipo: "saltato", post_id: "" });
      } else {
        // R-GHL-04: TikTok vuole tipo reel e nessuna anteprima personalizzata.
        const id = await creaPost(chiave, location, userId,
          videoOnly.map((p) => trova(p)!.id), testo, [video], "reel", quando);
        esiti.push({ piattaforme: videoOnly, tipo: "reel", post_id: id });
      }
    }

    const pubblicati = esiti.filter((e) => e.post_id);
    const postId = pubblicati[0]?.post_id ?? null;

    // Il passaggio di stato lo valuta il trigger: se rifiuta, non si e'
    // pubblicato niente di nostra iniziativa e l'errore arriva al chiamante.
    await db.update("smm_contents", `id=eq.${contentId}`, {
      stato: quando && quando > new Date() ? "programmato" : "pubblicato",
      programmato_at: quando?.toISOString() ?? new Date().toISOString(),
      pubblicato_at: quando && quando > new Date() ? null : new Date().toISOString(),
      ghl_post_id: postId,
      errore_pubblicazione: null,
    });

    await db.log("smm_pubblicato", {
      content_id: contentId, esiti, piattaforme_mancanti: mancanti,
    }, c.approvato_da);

    const saltate = esiti.filter((e) => e.tipo === "saltato").flatMap((e) => e.piattaforme);
    const messaggio = [
      `Inviato a GoHighLevel per ${pubblicati.flatMap((e) => e.piattaforme).join(", ")}.`,
      quando && quando > new Date()
        ? `Esce il ${quando.toLocaleString("it-IT", { timeZone: "Asia/Dubai" })} (ora di Dubai).`
        : "Pubblicazione immediata.",
      saltate.length ? `Saltate per mancanza del video: ${saltate.join(", ")}.` : "",
      mancanti.length ? `Nessun account collegato per: ${mancanti.join(", ")}.` : "",
    ].filter(Boolean).join(" ");

    return new Response(JSON.stringify({ ok: true, messaggio, esiti, ghl_post_id: postId }),
      { headers: CORS });

  } catch (e) {
    const messaggio = (e as Error).message ?? String(e);
    console.error("[smm-publish]", messaggio);
    // L'errore si scrive sul contenuto, cosi' il manager lo vede nella Regia
    // invece di dover aprire i log.
    try {
      const corpo = await req.clone().json();
      if (corpo?.content_id) {
        clientDaAmbiente().update("smm_contents", `id=eq.${corpo.content_id}`,
          { errore_pubblicazione: messaggio.slice(0, 1000) });
      }
    } catch { /* niente */ }
    return new Response(JSON.stringify({ ok: false, error: messaggio }),
      { status: 500, headers: CORS });
  }
});
