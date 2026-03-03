import { serve } from "https://deno.land/x/sift@0.6.0/mod.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// Feed RSS pubblici per categoria
const FEEDS = [
  { url: "https://gulfnews.com/rss/business",     category: "business",   source: "Gulf News" },
  { url: "https://thearabianpost.com/feed/",       category: "business",   source: "Arabian Post" },
  { url: "https://gulfnews.com/rss/property",      category: "realestate", source: "Gulf News" },
  { url: "https://gulfnews.com/rss/uae",           category: "visa",       source: "Gulf News" },
  { url: "https://wam.ae/en/feeds/rss/latestnews.xml", category: "governo", source: "WAM" },
  { url: "https://gulfnews.com/rss/markets",       category: "mercati",    source: "Gulf News" },
];

const CATEGORY_LABELS: Record<string, string> = {
  business:   "💼 Business & Tax",
  realestate: "🏠 Real Estate",
  visa:       "📋 Visa & Residenza",
  governo:    "🏛️ Governo & Legge",
  mercati:    "💹 Mercati",
};

interface RawItem { title: string; desc: string; link: string; pubDate: string; }
interface NewsItem {
  title: string; summary: string; link: string; pubDate: string;
  source: string; category: string; categoryLabel: string;
}

function parseRSS(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const b = m[1];
    const g = (re: RegExp) => re.exec(b)?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
    const title   = g(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const desc    = g(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/).substring(0, 350);
    const link    = g(/<link[^>]*>([\s\S]*?)<\/link>/) || g(/<guid[^>]*>([\s\S]*?)<\/guid>/);
    const pubDate = g(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || new Date().toUTCString();
    if (title) items.push({ title, desc, link, pubDate });
  }
  return items.slice(0, 5);
}

async function translateBatch(items: { title: string; desc: string }[]): Promise<{ title: string; summary: string }[]> {
  if (!ANTHROPIC_KEY || !items.length) return items.map(i => ({ title: i.title, summary: i.desc }));

  const prompt = `Sei un esperto giornalista finanziario e legale italiano specializzato negli UAE.
Traduci e riassumi queste notizie in italiano. Tono professionale, conciso.
Per ogni notizia: titolo in italiano (max 12 parole) + riassunto (max 2 frasi, 25 parole).
Rispondi SOLO con array JSON [{title, summary}], nessun altro testo.

${JSON.stringify(items.map((x, i) => ({ i, t: x.title, d: x.desc })))}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500,
        messages: [{ role: "user", content: prompt }] }),
    });
    const d = await r.json();
    const txt = (d.content?.[0]?.text || "[]").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? parsed : items.map(i => ({ title: i.title, summary: i.desc }));
  } catch (e) {
    return items.map(i => ({ title: i.title, summary: i.desc }));
  }
}

serve(async (req) => {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Cache-Control": "public, max-age=3600",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const cat = url.searchParams.get("category") || "all";
    const feeds = cat === "all" ? FEEDS : FEEDS.filter(f => f.category === cat);
    const results: NewsItem[] = [];

    await Promise.all(feeds.map(async (feed) => {
      try {
        const r = await fetch(feed.url, {
          headers: { "User-Agent": "InDubai-Portal/1.0" },
          signal: AbortSignal.timeout(7000),
        });
        if (!r.ok) return;
        const raw = parseRSS(await r.text());
        if (!raw.length) return;
        const translated = await translateBatch(raw.map(i => ({ title: i.title, desc: i.desc })));
        raw.forEach((item, i) => {
          results.push({
            title: translated[i]?.title || item.title,
            summary: translated[i]?.summary || item.desc,
            link: item.link,
            pubDate: item.pubDate,
            source: feed.source,
            category: feed.category,
            categoryLabel: CATEGORY_LABELS[feed.category] || feed.category,
          });
        });
      } catch (e) { console.error("Feed error:", feed.url, e); }
    }));

    results.sort((a, b) => +new Date(b.pubDate) - +new Date(a.pubDate));

    return new Response(JSON.stringify({
      ok: true, count: results.length,
      generated: new Date().toISOString(), items: results,
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors });
  }
});
