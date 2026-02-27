import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ZOHO_CLIENT_ID     = Deno.env.get("ZOHO_CLIENT_ID")!;
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET")!;
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN")!;
const ZOHO_API_BASE      = "https://www.zohoapis.com/books/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache access token in memory (resets on cold start, max 1h)
let cachedToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60000) {
    return cachedToken.token;
  }
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: ZOHO_REFRESH_TOKEN,
      client_id:     ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
  cachedToken = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function zohoGet(path: string, token: string) {
  const res = await fetch(`${ZOHO_API_BASE}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, org_id } = await req.json();
    const token = await getAccessToken();

    // ── list all organizations (used once to map clients) ──
    if (action === "list_orgs") {
      const data = await zohoGet("/organizations", token);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── get summary for a specific org ──
    if (action === "client_summary" && org_id) {
      const year = new Date().getFullYear();
      const yearStart = `${year}-01-01`;
      const today = new Date().toISOString().split("T")[0];

      // Fetch invoices for current year (paginated, max 200 per call)
      const invRes = await zohoGet(
        `/invoices?organization_id=${org_id}&date_start=${yearStart}&date_end=${today}&filter_by=Status.All&per_page=200`,
        token
      );

      const invoices = invRes.invoices || [];

      // Aggregate
      let totalBilled   = 0;
      let totalPaid     = 0;
      let totalUnpaid   = 0;
      let countInvoices = invoices.length;
      let countOverdue  = 0;
      let lastInvoice: { number: string; date: string; total: number; status: string } | null = null;

      for (const inv of invoices) {
        const total   = parseFloat(inv.total)   || 0;
        const balance = parseFloat(inv.balance) || 0;
        totalBilled += total;
        totalPaid   += total - balance;
        if (inv.status === "overdue") { totalUnpaid += balance; countOverdue++; }
        else if (inv.status !== "paid" && inv.status !== "void") totalUnpaid += balance;
        if (!lastInvoice || inv.date > lastInvoice.date) {
          lastInvoice = { number: inv.invoice_number, date: inv.date, total, status: inv.status };
        }
      }

      // Also get previous year total (quick summary)
      const prevYear      = year - 1;
      const prevYearRes   = await zohoGet(
        `/invoices?organization_id=${org_id}&date_start=${prevYear}-01-01&date_end=${prevYear}-12-31&filter_by=Status.All&per_page=200`,
        token
      );
      let prevYearTotal = 0;
      for (const inv of prevYearRes.invoices || []) {
        prevYearTotal += parseFloat(inv.total) || 0;
      }

      return new Response(JSON.stringify({
        year, totalBilled, totalPaid, totalUnpaid,
        countInvoices, countOverdue, lastInvoice, prevYearTotal,
        currency: invRes.invoices?.[0]?.currency_code || "AED",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
