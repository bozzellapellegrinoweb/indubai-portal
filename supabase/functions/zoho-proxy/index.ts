import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ZOHO_CLIENT_ID     = Deno.env.get("ZOHO_CLIENT_ID")!;
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET")!;
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN")!;
const ZOHO_API_BASE      = "https://www.zohoapis.com/books/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let cachedToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60000) return cachedToken.token;
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
  const res = await fetch(`${ZOHO_API_BASE}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  return res.json();
}

// Fetch ALL invoices between two dates, handling pagination
async function fetchAllInvoices(orgId: string, dateStart: string, dateEnd: string, token: string) {
  let page = 1;
  let all: any[] = [];
  while (true) {
    const res = await zohoGet(
      `/invoices?organization_id=${orgId}&date_start=${dateStart}&date_end=${dateEnd}&filter_by=Status.All&per_page=200&page=${page}`,
      token
    );
    const invoices = res.invoices || [];
    all = all.concat(invoices);
    if (!res.page_context?.has_more_page) break;
    page++;
  }
  return all;
}

// Convert invoice total to AED using exchange_rate field
function toAED(inv: any): number {
  const total = parseFloat(inv.total) || 0;
  const rate  = parseFloat(inv.exchange_rate) || 1;
  const cur   = inv.currency_code || "AED";
  if (cur === "AED") return total;
  // Zoho stores exchange_rate as base_currency_per_foreign, convert to AED
  return total * rate;
}

function toAEDBalance(inv: any): number {
  const balance = parseFloat(inv.balance) || 0;
  const rate    = parseFloat(inv.exchange_rate) || 1;
  const cur     = inv.currency_code || "AED";
  if (cur === "AED") return balance;
  return balance * rate;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { action, org_id } = await req.json();
    const token = await getAccessToken();

    // List all orgs
    if (action === "list_orgs") {
      const data = await zohoGet("/organizations", token);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "client_summary" && org_id) {
      const today     = new Date();
      const todayStr  = today.toISOString().split("T")[0];

      // Rolling 12 months
      const rolling12Start = new Date(today);
      rolling12Start.setMonth(rolling12Start.getMonth() - 12);
      const rolling12Str = rolling12Start.toISOString().split("T")[0];

      // Current year
      const year      = today.getFullYear();
      const yearStart = `${year}-01-01`;

      // Previous year
      const prevYear = year - 1;

      // Fetch all invoices in parallel
      const [rolling12Invoices, prevYearInvoices] = await Promise.all([
        fetchAllInvoices(org_id, rolling12Str, todayStr, token),
        fetchAllInvoices(org_id, `${prevYear}-01-01`, `${prevYear}-12-31`, token),
      ]);

      // Filter current year from rolling12
      const yearInvoices = rolling12Invoices.filter(inv => inv.date >= yearStart);

      // Aggregate current year (in original currency)
      let totalBilled = 0, totalPaid = 0, totalUnpaid = 0;
      let countInvoices = yearInvoices.length, countOverdue = 0;
      let lastInvoice: any = null;
      for (const inv of yearInvoices) {
        const total   = parseFloat(inv.total)   || 0;
        const balance = parseFloat(inv.balance) || 0;
        totalBilled += total;
        totalPaid   += total - balance;
        if (inv.status === "overdue") { totalUnpaid += balance; countOverdue++; }
        else if (inv.status !== "paid" && inv.status !== "void") totalUnpaid += balance;
        if (!lastInvoice || inv.date > lastInvoice.date) {
          lastInvoice = { number: inv.invoice_number, date: inv.date, total, status: inv.status, currency: inv.currency_code };
        }
      }

      // Aggregate rolling 12 months in AED (for VAT threshold check)
      let rolling12AED = 0;
      for (const inv of rolling12Invoices) {
        if (inv.status !== "void") rolling12AED += toAED(inv);
      }

      // Aggregate current year in AED
      let totalBilledAED = 0, totalPaidAED = 0, totalUnpaidAED = 0;
      for (const inv of yearInvoices) {
        if (inv.status === "void") continue;
        totalBilledAED += toAED(inv);
        totalPaidAED   += toAED(inv) - toAEDBalance(inv);
        if (inv.status === "overdue" || (inv.status !== "paid")) totalUnpaidAED += toAEDBalance(inv);
      }

      // Prev year AED
      let prevYearAED = 0;
      for (const inv of prevYearInvoices) {
        if (inv.status !== "void") prevYearAED += toAED(inv);
      }

      // VAT threshold: 375k AED rolling 12 months
      const VAT_THRESHOLD   = 375000;
      const VAT_WARN_AT     = 300000;
      const vatStatus = rolling12AED >= VAT_THRESHOLD ? "exceeded" : rolling12AED >= VAT_WARN_AT ? "warning" : "ok";

      // Get org currency
      const orgCurrency = yearInvoices[0]?.currency_code || "AED";

      return new Response(JSON.stringify({
        year,
        // Current year in original currency
        totalBilled, totalPaid, totalUnpaid,
        countInvoices, countOverdue, lastInvoice,
        orgCurrency,
        // AED values (for multi-currency clients)
        totalBilledAED, totalPaidAED, totalUnpaidAED,
        // Rolling 12 months AED
        rolling12AED, rolling12Start: rolling12Str,
        vatStatus, vatThreshold: VAT_THRESHOLD, vatWarnAt: VAT_WARN_AT,
        // Prev year
        prevYearAED,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
