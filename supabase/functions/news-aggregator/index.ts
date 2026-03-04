const FEEDS = [
  { url: "https://gulfnews.com/rss/business",          category: "business",   source: "Gulf News" },
  { url: "https://thearabianpost.com/feed/",            category: "business",   source: "Arabian Post" },
  { url: "https://gulfnews.com/rss/property",           category: "realestate", source: "Gulf News" },
  { url: "https://gulfnews.com/rss/uae",                category: "visa",       source: "Gulf News" },
  { url: "https://wam.ae/en/feeds/rss/latestnews.xml",  category: "governo",    source: "WAM" },
  { url: "https://gulfnews.com/rss/markets",            category: "mercati",    source: "Gulf News" },
];

const CATEGORY_LABELS: Record<string, string> = {
  business:   "💼 Business & Tax",
  realestate: "🏠 Real Estate",
  visa:       "📋 Visa & Residenza",
  governo:    "🏛️ Governo & Legge",
  mercati:    "💹 Mercati",
};

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function parseRSS(xml: string) {
  const items: { title: string; desc: string; link: string; pubDate: string }[] = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const b = m[1];
    const g = (re: RegExp) => (re.exec(b)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const title   = g(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const desc    = g(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/).substring(0, 350);
    const link    = g(/<link[^>]*>([\s\S]*?)<\/link>/) || g(/<guid[^>]*>([\s\S]*?)<\/guid>/);
    const pubDate = g(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || new Date().toUTCString();
    if (title) items.push({ title, desc, link, pubDate });
  }
  return items.slice(0, 5);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const results: {
      title: string; summary: string; link: string; pubDate: string;
      source: string; category: string; categoryLabel: string;
    }[] = [];

    await Promise.all(FEEDS.map(async (feed) => {
      try {
        const r = await fetch(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0 InDubai-Portal/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return;
        const raw = parseRSS(await r.text());
        raw.forEach((item) => {
          results.push({
            title: item.title,
            summary: item.desc,
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
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: CORS });
  }
});
