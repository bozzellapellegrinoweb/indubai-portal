import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GHL_TOKEN = "pit-98c12ff9-94f7-46fe-93fc-7ba94db1c6e5";
const LOCATION_ID = "KzCZHYcMDxOZMD7KBuZV";
const GHL_BASE = "https://services.leadconnectorhq.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const GHL_HEADERS = {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version: "2021-07-28",
  "Content-Type": "application/json",
};

const PAGE_LIMIT = 100;
const MAX_PAGES = 100; // safety cap ~10k contatti

type GhlContact = {
  dateAdded?: string;
  source?: string;
  tags?: string[];
  attributionSource?: Record<string, string>;
  lastAttributionSource?: Record<string, string>;
};

function normalizeSource(c: GhlContact): string {
  const attr = c.attributionSource || c.lastAttributionSource || {};
  const utm = (attr.utmSource || "").toLowerCase();
  const ref = (attr.referrer || "").toLowerCase();
  const sess = (attr.sessionSource || "").toLowerCase();
  const med = (attr.utmMedium || attr.medium || "").toLowerCase();
  const src = (c.source || "").toLowerCase();
  const tags = (c.tags || []).map((t) => t.toLowerCase());
  const hasTag = (kw: string) => tags.some((t) => t.includes(kw));

  if (utm.includes("ig") || utm.includes("instagram") || ref.includes("instagram") || hasTag("instagram")) {
    return "Instagram";
  }
  if (utm.includes("fb") || utm.includes("facebook") || ref.includes("facebook") || hasTag("facebook")) {
    return "Facebook";
  }
  if (
    utm.includes("google") || utm.includes("adwords") || ref.includes("google") ||
    ref.includes("android-app://com.google") || src.includes("google") || hasTag("google")
  ) {
    return (med.includes("organic") || sess.includes("organic")) ? "Google (Organico)" : "Google Ads";
  }
  if (sess.includes("paid search")) return "Google Ads";
  if (sess.includes("organic search")) return "Organico (SEO)";
  if (sess.includes("social")) return "Social (altro)";
  if (sess.includes("direct")) return "Diretto";
  if (src.includes("whatsapp") || hasTag("whatsapp")) return "WhatsApp";
  if (src.includes("referral") || hasTag("referral")) return "Referral";
  return "Non specificato";
}

async function ghlSearchContacts(body: Record<string, unknown>) {
  const r = await fetch(`${GHL_BASE}/contacts/search`, {
    method: "POST",
    headers: GHL_HEADERS,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GHL search failed (${r.status}): ${text.substring(0, 300)}`);
  }
  return r.json();
}

async function fetchAllContacts(startMs: number | null, endMs: number | null) {
  const filters = startMs && endMs
    ? [{ field: "dateAdded", operator: "range", value: { gte: startMs, lte: endMs } }]
    : [];

  let searchAfter: unknown[] | undefined;
  let total = 0;
  const contacts: GhlContact[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: Record<string, unknown> = {
      locationId: LOCATION_ID,
      pageLimit: PAGE_LIMIT,
      sort: [{ field: "dateAdded", direction: "desc" }],
    };
    if (filters.length) body.filters = filters;
    if (searchAfter) body.searchAfter = searchAfter;

    const data = await ghlSearchContacts(body);
    total = data.total ?? total;
    const batch: GhlContact[] = data.contacts || [];
    contacts.push(...batch);

    if (batch.length < PAGE_LIMIT) break;
    const last = batch[batch.length - 1] as unknown as { searchAfter?: unknown[] };
    if (!last.searchAfter) break;
    searchAfter = last.searchAfter;
  }

  return { contacts, total };
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

function topEntries(map: Record<string, number>, limit: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const url = new URL(req.url);
    const allTime = url.searchParams.get("all") === "1";
    const days = allTime ? null : (parseInt(url.searchParams.get("days") || "90", 10) || 90);

    const end = Date.now();
    const start = days ? end - days * 86400000 : null;

    const [{ contacts, total }, allTimeTotalResp] = await Promise.all([
      fetchAllContacts(start, days ? end : null),
      allTime ? Promise.resolve(null) : ghlSearchContacts({ locationId: LOCATION_ID, pageLimit: 1 }),
    ]);

    const totalAllTime = allTime ? total : (allTimeTotalResp?.total ?? total);

    const bySource: Record<string, number> = {};
    const byLandingPage: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    const trend: Record<string, Record<string, number>> = {}; // period -> source -> count
    const dayGranularity = days !== null && days <= 45;

    for (const c of contacts) {
      const source = normalizeSource(c);
      bump(bySource, source);

      const landing = (c.source || "Non specificato").trim();
      bump(byLandingPage, landing || "Non specificato");

      for (const t of c.tags || []) bump(byTag, t);

      const dateAdded = c.dateAdded || "";
      if (dateAdded) {
        const period = dayGranularity ? dateAdded.slice(0, 10) : dateAdded.slice(0, 7);
        if (!trend[period]) trend[period] = {};
        bump(trend[period], source);
      }
    }

    const trendSorted = Object.entries(trend)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, sources]) => ({ period, sources }));

    const totalInRange = contacts.length;
    const bySourceSorted = Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({
        source,
        count,
        pct: totalInRange ? Math.round((count / totalInRange) * 1000) / 10 : 0,
      }));

    return new Response(
      JSON.stringify({
        range: { days, start: start ? new Date(start).toISOString() : null, end: new Date(end).toISOString() },
        totalInRange,
        totalAllTime,
        bySource: bySourceSorted,
        trend: trendSorted,
        topLandingPages: topEntries(byLandingPage, 10),
        topTags: topEntries(byTag, 10),
      }),
      { headers: cors },
    );
  } catch (e) {
    console.error("ghl-lead-analytics error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
});
