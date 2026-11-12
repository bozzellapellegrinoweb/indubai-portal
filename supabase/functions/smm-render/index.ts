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

/**
 * Il badge che compare in alto su ogni slide.
 *
 * Il generatore lo sceglie da un elenco chiuso, e si vede: un badge che
 * dice "FISCALE" invece di "FISCALITA' UAE" e' fuori dal marchio su tutte
 * le slide insieme. Prima lo ricavavo alla lettera dalla categoria, che
 * non e' quell'elenco.
 *
 * Ordine: quello che ha scelto chi ha scritto (nella prima slide), poi la
 * categoria o il pillar ricondotti all'elenco, poi il generico.
 */
const BADGE_AMMESSI = [
  "FISCALITÀ UAE", "CORPORATE TAX", "RESIDENZA FISCALE", "FREE ZONE", "AIRE",
  "COMPLIANCE", "SOCIETÀ UAE", "BANCHE UAE", "VISTI UAE", "CRYPTO UAE", "NORMATIVA",
];

/** Senza accenti e in maiuscolo, per confrontare "SOCIETA'" con "SOCIETÀ". */
function piatto(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/'/g, "").toUpperCase().trim();
}

const VERSO_BADGE: Record<string, string> = {
  FISCALE: "FISCALITÀ UAE", FISCALITA: "FISCALITÀ UAE", "FISCALITA UAE": "FISCALITÀ UAE",
  NORMATIVA: "NORMATIVA", RESIDENZA: "RESIDENZA FISCALE", "RESIDENZA FISCALE": "RESIDENZA FISCALE",
  STRUTTURE: "SOCIETÀ UAE", "SOCIETA UAE": "SOCIETÀ UAE", SOCIETA: "SOCIETÀ UAE",
  COMPLIANCE: "COMPLIANCE", MITI: "NORMATIVA", DATI: "NORMATIVA",
  "CORPORATE TAX": "CORPORATE TAX", "FREE ZONE": "FREE ZONE", FREEZONE: "FREE ZONE",
  AIRE: "AIRE", BANCHE: "BANCHE UAE", "BANCHE UAE": "BANCHE UAE",
  VISTI: "VISTI UAE", "VISTI UAE": "VISTI UAE", CRYPTO: "CRYPTO UAE", "CRYPTO UAE": "CRYPTO UAE",
  LIFESTYLE: "FISCALITÀ UAE",
};

function badge(c: Contenuto): string {
  const prima = Array.isArray(c.slides) ? (c.slides[0] as Record<string, unknown> | undefined) : undefined;
  const scelto = typeof prima?.badge === "string" ? prima.badge : null;

  for (const candidato of [scelto, c.categoria, c.pillar]) {
    if (!candidato) continue;
    const k = piatto(candidato);
    const ammesso = BADGE_AMMESSI.find((b) => piatto(b) === k);
    if (ammesso) return ammesso;
    if (VERSO_BADGE[k]) return VERSO_BADGE[k];
  }
  return "FISCALITÀ UAE";
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
/**
 * Il titolo come lo deve leggere chi guarda, senza il nome interno.
 *
 * Il Direttore chiama i contenuti "Reel - Corporate Tax UAE: gettito 2025
 * su di un terzo" o "Storia 6/7 - Confronto Italia Dubai", ed e' giusto:
 * nella Regia serve sapere cosa si sta guardando. Ma quel titolo finiva
 * dritto sulla copertina, e il primo reel mai uscito aveva scritto sopra
 * "Reel -" a caratteri di 96 pixel. Si vede solo guardando il video: non
 * c'e' errore, non c'e' test che fallisce, esce e basta.
 *
 * Si toglie solo il prefisso vero e proprio, cioe' la parola del formato
 * seguita al massimo da numeri e barre e poi da un trattino. "Post Brexit
 * - cosa cambia" resta intero, perche' "Brexit" non e' un numero.
 */
function titoloInChiaro(t: unknown): string {
  const intero = String(t ?? "").trim();
  const senza = intero
    .replace(/^(reel|reels|storia|storie|carosello|caroselli|post)\s*[0-9/ ]*[–—-]\s*/i, "")
    .trim();
  return senza || intero;
}

/** I punti elenco di una slide, uno per riga, come corpo del testo. */
function puntiInCorpo(p: unknown): string {
  if (!Array.isArray(p)) return "";
  return p.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n");
}

/**
 * Le slide di un contenuto, qualunque forma abbiano.
 *
 * Un agente le salva come elenco, oppure come oggetto completo con la
 * copertina decisa da lui. Il trigger del montaggio accetta tutte e due
 * (20261112_smm_montaggio_automatico.sql), e datiCarosello pure: la
 * guardia qui sotto era la sola a vedere soltanto l'elenco, e rispondeva
 * "non ha ancora nessuna slide" a un contenuto che ne aveva otto.
 */
function elencoSlide(s: unknown): unknown[] {
  if (Array.isArray(s)) return s;
  if (s && typeof s === "object") {
    const dentro = (s as Record<string, unknown>).slides;
    if (Array.isArray(dentro)) return dentro;
  }
  return [];
}

function datiCarosello(c: Contenuto, b: Brand): Record<string, unknown> {
  const s = c.slides as Record<string, unknown> | unknown[] | null;

  if (s && !Array.isArray(s) && typeof s === "object" && "slides" in s) {
    return { badge: badge(c), ctaText: b.cta_default ?? "", ctaButton: b.sito ?? "", ...s };
  }

  const elenco = Array.isArray(s) ? s : [];
  return {
    badge: badge(c),
    coverTitle: titoloInChiaro(c.titolo),
    coverSubtitle: sottotitolo(c),
    teasers: [],
    slides: elenco.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        // Gli agenti parlano italiano e scrivono le chiavi in italiano:
        // tipo, titolo, testo. Qui si accettano tutte e due le lingue,
        // perche' far fallire il rendering per il nome di un campo
        // sarebbe fallire per una forma, non per un contenuto.
        type: typeof (o.type ?? o.tipo) === "string" ? String(o.type ?? o.tipo) : "standard",
        title: String(o.title ?? o.titolo ?? ""),
        // I punti elenco sono la forma che il Copywriter scrive di piu'
        // ("bullets" nel suo brief), e nei template non esiste un campo
        // per loro: diventano il corpo, una riga per punto. Senza questo
        // una slide "content" uscirebbe come un titolo sopra il nulla.
        body: String(o.body ?? o.testo ?? "") || puntiInCorpo(o.bullets ?? o.punti),
        // L'icona la scegli l'agente fra le sei del Cervello: buttarla
        // vuol dire mettere "chart" su ogni slide di ogni reel.
        ...(typeof o.icon === "string" && o.icon ? { icon: o.icon } : {}),
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
    theme: titoloInChiaro(c.titolo),
    badge: badge(c),
    ...(avatar ? { avatarUrl: avatar } : {}),
    slides: elenco.length
      ? elenco.map((x, i) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const dichiarato = o.type ?? o.tipo;
          return {
            type: typeof dichiarato === "string" ? String(dichiarato)
                : i === 0 ? "intro" : i === elenco.length - 1 ? "cta" : "content",
            title: String(o.title ?? o.titolo ?? ""),
            body: String(o.body ?? o.testo ?? ""),
            ...(o.bullets ? { bullets: o.bullets } : {}),
            ...(o.ctaLine ? { ctaLine: o.ctaLine } : {}),
          };
        })
      : [{ type: "intro", title: titoloInChiaro(c.titolo), body: sottotitolo(c) },
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
  // I file di un rendering precedente che questo non ha rifatto.
  //
  // Succede quando il contenuto viene riscritto con meno slide: le righe
  // vecchie resterebbero in elenco, e l'anteprima mostrerebbe in coda una
  // pagina che nel contenuto non c'e' piu'. Chi guarda non ha modo di
  // capire che e' un residuo: sembra una slide sbagliata.
  const tenuti = new Set(righe.map((r) => r.path));
  try {
    const vecchi = await db.select("smm_media",
      `content_id=eq.${c.id}&ruolo=eq.derivato&select=id,path`);
    for (const v of vecchi ?? []) {
      if (!tenuti.has(v.path)) await db.delete("smm_media", `id=eq.${v.id}`);
    }
  } catch { /* un residuo in elenco e' meno grave di un rendering perso */ }

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

    const slides = elencoSlide(c.slides);
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
