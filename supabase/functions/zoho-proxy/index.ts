import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ZOHO_CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID")!;
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET")!;
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN")!;
const ZOHO_API_BASE = "https://www.zohoapis.com/books/v3";
const SB_URL = "https://gvdoqcgkzbziqufahhxh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
  cachedToken = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function zohoGet(path: string, token: string) {
  const res = await fetch(ZOHO_API_BASE + path, {
    headers: { Authorization: "Zoho-oauthtoken " + token },
  });
  return res.json();
}

async function sbGet(path: string) {
  const res = await fetch(SB_URL + path, {
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
  });
  return res.json();
}

async function sbUpsert(table: string, data: any) {
  const res = await fetch(SB_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: {
      "apikey": SB_KEY,
      "Authorization": "Bearer " + SB_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify(data),
  });
  return res;
}

async function fetchAllInvoices(orgId: string, dateStart: string, dateEnd: string, token: string) {
  let page = 1;
  let all: any[] = [];
  while (true) {
    const path = "/invoices?organization_id=" + orgId + "&date_start=" + dateStart + "&date_end=" + dateEnd + "&filter_by=Status.All&per_page=200&page=" + page;
    const res = await zohoGet(path, token);
    all = all.concat(res.invoices || []);
    if (!res.page_context || !res.page_context.has_more_page) break;
    page++;
  }
  return all;
}

function toAED(inv: any): number {
  const total = parseFloat(inv.total) || 0;
  const rate = parseFloat(inv.exchange_rate) || 1;
  return (inv.currency_code || "AED") === "AED" ? total : total * rate;
}

function toAEDBalance(inv: any): number {
  const bal = parseFloat(inv.balance) || 0;
  const rate = parseFloat(inv.exchange_rate) || 1;
  return (inv.currency_code || "AED") === "AED" ? bal : bal * rate;
}

async function calcSummary(org_id: string, token: string) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const year = today.getFullYear();
  const yearStart = year + "-01-01";
  const prevYear = year - 1;
  const r12Start = new Date(today);
  r12Start.setMonth(r12Start.getMonth() - 12);
  const r12Str = r12Start.toISOString().split("T")[0];

  const r12Invoices = await fetchAllInvoices(org_id, r12Str, todayStr, token);
  const prevInvoices = await fetchAllInvoices(org_id, prevYear + "-01-01", prevYear + "-12-31", token);
  const yearInvoices = r12Invoices.filter(function(inv: any) { return inv.date >= yearStart; });

  let totalBilled = 0, totalPaid = 0, totalUnpaid = 0, countOverdue = 0;
  let lastInvoice: any = null;

  for (let i = 0; i < yearInvoices.length; i++) {
    const inv = yearInvoices[i];
    const total = parseFloat(inv.total) || 0;
    const bal = parseFloat(inv.balance) || 0;
    totalBilled += total; totalPaid += total - bal;
    if (inv.status === "overdue") { totalUnpaid += bal; countOverdue++; }
    else if (inv.status !== "paid" && inv.status !== "void") totalUnpaid += bal;
    if (!lastInvoice || inv.date > lastInvoice.date)
      lastInvoice = { number: inv.invoice_number, date: inv.date, total: total, status: inv.status, currency: inv.currency_code };
  }

  let rolling12AED = 0, totalBilledAED = 0, totalPaidAED = 0, totalUnpaidAED = 0, prevYearAED = 0;
  for (let i = 0; i < r12Invoices.length; i++) if (r12Invoices[i].status !== "void") rolling12AED += toAED(r12Invoices[i]);
  for (let i = 0; i < yearInvoices.length; i++) if (yearInvoices[i].status !== "void") {
    totalBilledAED += toAED(yearInvoices[i]);
    totalPaidAED += toAED(yearInvoices[i]) - toAEDBalance(yearInvoices[i]);
    totalUnpaidAED += toAEDBalance(yearInvoices[i]);
  }
  for (let i = 0; i < prevInvoices.length; i++) if (prevInvoices[i].status !== "void") prevYearAED += toAED(prevInvoices[i]);

  return {
    year: year, totalBilled: totalBilled, totalPaid: totalPaid, totalUnpaid: totalUnpaid,
    countInvoices: yearInvoices.length, countOverdue: countOverdue, lastInvoice: lastInvoice,
    orgCurrency: yearInvoices.length > 0 ? (yearInvoices[0].currency_code || "AED") : "AED",
    totalBilledAED: totalBilledAED, totalPaidAED: totalPaidAED, totalUnpaidAED: totalUnpaidAED,
    rolling12AED: rolling12AED, rolling12Start: r12Str,
    vatStatus: rolling12AED >= 375000 ? "exceeded" : rolling12AED >= 300000 ? "warning" : "ok",
    vatThreshold: 375000, vatWarnAt: 300000, prevYearAED: prevYearAED,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action;
    const org_id = body.org_id;
    const token = await getAccessToken();

    if (action === "list_orgs") {
      const data = await zohoGet("/organizations", token);
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "client_summary" && org_id) {
      const summary = await calcSummary(org_id, token);
      return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "cron_sync") {
      const clients = await sbGet("/rest/v1/clients?zoho_org_id=not.is.null&is_active=eq.true&select=id,company_name,zoho_org_id");

      if (!Array.isArray(clients) || clients.length === 0) {
        return new Response(JSON.stringify({ synced: 0, errors: 0, clientsFound: Array.isArray(clients) ? 0 : clients }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let synced = 0, errors = 0;
      for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        try {
          const s = await calcSummary(client.zoho_org_id, token);
          await sbUpsert("zoho_snapshots", {
            client_id: client.id,
            updated_at: new Date().toISOString(),
            rolling12_aed: s.rolling12AED,
            total_billed_aed: s.totalBilledAED,
            total_unpaid_aed: s.totalUnpaidAED,
            vat_status: s.vatStatus,
            year: s.year,
            count_invoices: s.countInvoices,
            count_overdue: s.countOverdue,
            org_currency: s.orgCurrency,
          });
          synced++;
        } catch (e) {
          errors++;
        }
      }

      return new Response(JSON.stringify({ synced: synced, errors: errors }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
