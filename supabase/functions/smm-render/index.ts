/**
 * smm-render — la Regia chiede al generatore di rendere un contenuto.
 *
 * La Regia vive su Supabase e non ha ne' Puppeteer ne' ffmpeg: non puo'
 * trasformare un testo in otto immagini o in un video. Il progetto che
 * generava i post lo sa fare da sempre, e ha gia' dentro le misure, i
 * caratteri, i colori e le regole di formato affinate sul campo.
 *
 * Quindi non riscrivo niente: quel progetto smette di essere un posto dove
 * si va e diventa un motore che si chiama. Il manager non lo vede, non ha
 * una voce nel menu, non ci sono due elenchi di contenuti. Lo stato resta
 * tutto qui, su smm_contents; di la' si rende e basta.
 *
 * Gli indirizzi tornano da Cloudinary e non sono firmati: a scaricare le
 * immagini e' poi GoHighLevel, che deve poterle prendere senza credenziali.
 * E' l'unica eccezione al "mai pubblico", ed e' la stessa che vale per la
 * pubblicazione.
 */

import { clientDaAmbiente, type SupabaseClient } from "../smm-worker/supabase.ts";
import { eUnaPersona } from "../smm-worker/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

interface Contenuto {
  id: string; brand_id: string; titolo: string; tipo: string;
  brief: string | null; caption: string | null; hashtags: string[];
  slides: unknown; pillar: string | null; categoria: string | null;
}

interface Brand { nome: string; cta_default: string | null; sito: string | null }

/** Il badge in alto nelle slide: la categoria, se c'e', altrimenti il pillar. */
function badge(c: Contenuto): string {
  return (c.categoria || c.pillar || "Fiscalita UAE").toUpperCase().slice(0, 28);
}

/** La prima frase della caption, che fa da sottotitolo di copertina. */
function sottotitolo(c: Contenuto): string {
  const t = (c.caption || c.brief || "").trim();
  const primaFrase = t.split(/(?<=[.!?])\s/)[0] || t;
  return primaFrase.slice(0, 160);
}

/**
 * I dati che il motore si aspetta.
 *
 * Le slide le scrive il Grafico e la forma puo' essere due:
 *
 *  - gia' completa, cioe' un oggetto con coverTitle e slides: allora passa
 *    intatta, perche' l'agente sa cosa sta facendo;
 *  - un semplice elenco di slide: allora il resto lo ricavo dal contenuto.
 *
 * Accettare tutte e due non e' indulgenza: il formato completo serve quando
 * l'agente vuole decidere la copertina, l'elenco semplice quando scrive solo
 * i testi. Rifiutare il secondo vorrebbe dire far fallire il rendering per
 * una forma, non per un contenuto.
 */
function datiCarosello(c: Contenuto, b: Brand): Record<string, unknown> {
  const s = c.slides as Record<string, unknown> | unknown[] | null;

  if (s && !Array.isArray(s) && typeof s === "object" && "slides" in s) {
    return { badge: badge(c), ctaText: b.cta_default ?? "", ctaButton: b.sito ?? "", ...s };
  }

  const elenco = Array.isArray(s) ? s : [];
  return {
    badge: badge(c),
    coverTitle: c.titolo,
    coverSubtitle: sottotitolo(c),
    teasers: [],
    slides: elenco.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        type: typeof o.type === "string" ? o.type : "standard",
        title: String(o.title ?? o.titolo ?? ""),
        body: String(o.body ?? o.testo ?? ""),
        ...(o.stats ? { stats: o.stats } : {}),
        ...(o.quoteText ? { quoteText: o.quoteText, quoteAuthor: o.quoteAuthor ?? "" } : {}),
        ...(o.items ? { items: o.items, leftLabel: o.leftLabel, rightLabel: o.rightLabel } : {}),
      };
    }),
    ctaText: b.cta_default ?? "Scopri di piu'",
    ctaButton: b.sito ?? "",
  };
}

function datiStoria(c: Contenuto, b: Brand, avatar?: string): Record<string, unknown> {
  const s = c.slides;
  const elenco = Array.isArray(s) ? s : [];
  return {
    theme: c.titolo,
    badge: badge(c),
    ...(avatar ? { avatarUrl: avatar } : {}),
    slides: elenco.length
      ? elenco.map((x, i) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            type: typeof o.type === "string" ? o.type
                : i === 0 ? "intro" : i === elenco.length - 1 ? "cta" : "content",
            title: String(o.title ?? o.titolo ?? ""),
            body: String(o.body ?? o.testo ?? ""),
            ...(o.bullets ? { bullets: o.bullets } : {}),
            ...(o.ctaLine ? { ctaLine: o.ctaLine } : {}),
          };
        })
      : [{ type: "intro", title: c.titolo, body: sottotitolo(c) },
         { type: "cta", title: b.cta_default ?? "Parliamone", ctaLine: b.sito ?? "" }],
  };
}

async function salvaMedia(
  db: SupabaseClient, c: Contenuto,
  media: { url: string; mime: string; ruolo: string; ordine: number }[],
  chi: string | null,
) {
  // Il public_id di Cloudinary fa da percorso: smm_media vuole bucket e path
  // non nulli e la coppia unica. Un rendering rifatto sovrascrive lo stesso
  // asset su Cloudinary, quindi qui si riscrive la stessa riga invece di
  // accumularne una nuova a ogni tentativo.
  const righe = media.map((m) => {
    const dopoUpload = m.url.split("/upload/")[1] ?? m.url;
    const path = dopoUpload.replace(/^v\d+\//, "").replace(/\.[a-z0-9]+$/i, "");
    return {
      brand_id: c.brand_id, content_id: c.id,
      ruolo: m.ruolo, bucket: "cloudinary", path,
      nome_file: path.split("/").pop(), mime: m.mime,
      cloudinary_url: m.url, cloudinary_public_id: path,
      caricato_da: chi,
    };
  });

  for (const r of righe) {
    try {
      await db.insert("smm_media", r);
    } catch {
      // Gia' c'era: stessa coppia bucket+path, quindi lo stesso asset
      // rigenerato. Si aggiorna l'indirizzo e si va avanti.
      await db.update("smm_media", `bucket=eq.cloudinary&path=eq.${encodeURIComponent(r.path)}`,
        { cloudinary_url: r.cloudinary_url, mime: r.mime, content_id: r.content_id });
    }
  }
  return righe.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Un colpo a vuoto che dice solo i NOMI delle variabili che iniziano per
  // REGIA, mai i valori. Serve a distinguere "non l'ho messa" da "l'ho
  // scritta storta" da "l'ho messa su un altro progetto", che da fuori sono
  // tre errori identici: ci abbiamo perso mezz'ora sul lato Vercel.
  //
  // Non e' aperto a chiunque: il gateway di Supabase accetta solo un token
  // vero del progetto, altrimenti non si arriva nemmeno qui.
  if (req.method === "GET") {
    let nomi: string[] = [];
    try {
      nomi = Object.keys(Deno.env.toObject()).filter((k) => k.startsWith("REGIA")).sort();
    } catch { /* se l'ambiente non si legge, resta vuoto */ }
    return new Response(JSON.stringify({
      ok: true, servizio: "smm-render", variabili: nomi,
    }), { headers: CORS });
  }

  try {
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!((service && token === service) || eUnaPersona(token))) {
      return new Response(JSON.stringify({ ok: false, error: "Non autorizzato" }),
        { status: 401, headers: CORS });
    }

    const motore = Deno.env.get("REGIA_RENDER_URL");
    const segreto = Deno.env.get("REGIA_SECRET");
    if (!motore || !segreto) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Mancano REGIA_RENDER_URL o REGIA_SECRET fra i segreti del progetto Supabase. "
             + "Senza, la Regia non sa a chi chiedere il rendering.",
      }), { status: 500, headers: CORS });
    }

    const corpo = await req.json().catch(() => ({}));
    const contentId: string = corpo.content_id;
    if (!contentId) {
      return new Response(JSON.stringify({ ok: false, error: "Manca content_id" }),
        { status: 400, headers: CORS });
    }

    const db = clientDaAmbiente();
    const righe = await db.select("smm_contents", `id=eq.${contentId}&select=*`);
    const c: Contenuto | undefined = righe?.[0];
    if (!c) {
      return new Response(JSON.stringify({ ok: false, error: "Contenuto non trovato" }),
        { status: 404, headers: CORS });
    }

    const brands = await db.select("smm_brands", `id=eq.${c.brand_id}&select=nome,cta_default,sito`);
    const b: Brand = brands?.[0] ?? { nome: "InDubai", cta_default: null, sito: null };

    // Il formato lo decide il contenuto, salvo richiesta diversa: un
    // carosello si puo' voler anche come reel, che e' lo stesso materiale
    // animato.
    const tipo: string = corpo.formato || (c.tipo === "post" ? "carosello" : c.tipo);
    if (!["carosello", "reel", "storia"].includes(tipo)) {
      return new Response(JSON.stringify({
        ok: false, error: `Non so rendere "${tipo}".`,
      }), { status: 400, headers: CORS });
    }

    const slides = Array.isArray(c.slides) ? c.slides : [];
    if (!slides.length && tipo !== "storia") {
      return new Response(JSON.stringify({
        ok: false,
        error: "Questo contenuto non ha ancora nessuna slide: prima lo scrive il Copywriter "
             + "e lo imposta il Grafico, poi si rende.",
      }), { status: 409, headers: CORS });
    }

    const dati = tipo === "storia" ? datiStoria(c, b, corpo.avatar) : datiCarosello(c, b);

    const r = await fetch(motore, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${segreto}` },
      body: JSON.stringify({ tipo, riferimento: c.id, dati, brand: "indubai", video: corpo.video !== false }),
    });
    const esito = await r.json().catch(() => ({}));
    if (!r.ok || esito?.ok === false) {
      throw new Error(esito?.error ?? `Il motore ha risposto ${r.status}.`);
    }

    const quanti = await salvaMedia(db, c, esito.media ?? [], corpo.chi ?? null);
    await db.log("smm_reso", { content_id: c.id, tipo, quanti });

    return new Response(JSON.stringify({
      ok: true, tipo, quanti,
      messaggio: quanti === 1
        ? "Pronto: un file caricato."
        : `Pronti: ${quanti} file caricati.`,
      media: esito.media,
    }), { headers: CORS });

  } catch (e) {
    const messaggio = (e as Error).message ?? String(e);
    console.error("[smm-render]", messaggio);
    return new Response(JSON.stringify({ ok: false, error: messaggio }),
      { status: 500, headers: CORS });
  }
});
