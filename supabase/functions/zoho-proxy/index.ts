import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZOHO_CLIENT_ID     = Deno.env.get("ZOHO_CLIENT_ID")!;
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET")!;
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN")!;
const ZOHO_API_BASE      = "https://www.zohoapis.com/books/v3";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function fetchAllInvoices(orgId: string, dateStart: string, dateEnd: string, token: string) {
  let page = 1, all: any[] = [];
  while (true) {
    const res = await zohoGet(`/invoices?organization_id=${orgId}&date_start=${dateStart}&date_end=${dateEnd}&filter_by=Status.All&per_page=200&page=${page}`, token);
    all = all.concat(res.invoices || []);
    if (!res.page_context?.has_more_page) break;
    page++;
  }
  return all;
}

function toAED(inv: any): number {
  const total = parseFloat(inv.total) || 0;
  const rate  = parseFloat(inv.exchange_rate) || 1;
  return (inv.currency_code || "AED") === "AED" ? total : total * rate;
}
function toAEDBalance(inv: any): number {
  const bal  = parseFloat(inv.balance) || 0;
  const rate = parseFloat(inv.exchange_rate) || 1;
  return (inv.currency_code || "AED") === "AED" ? bal : bal * rate;
}

async function calcSummary(org_id: string, token: string) {
  const today     = new Date();
  const todayStr  = today.toISOString().split("T")[0];
  const year      = today.getFullYear();
  const yearStart = `${year}-01-01`;
  const prevYear  = year - 1;
  const r12Start  = new Date(today);
  r12Start.setMonth(r12Start.getMonth() - 12);
  const r12Str    = r12Start.toISOString().split("T")[0];

  const [r12Invoices, prevInvoices] = await Promise.all([
    fetchAllInvoices(org_id, r12Str, todayStr, token),
    fetchAllInvoices(org_id, `${prevYear}-01-01`, `${prevYear}-12-31`, token),
  ]);
  const yearInvoices = r12Invoices.filter(inv => inv.date >= yearStart);

  let totalBilled=0, totalPaid=0, totalUnpaid=0, countInvoices=yearInvoices.length, countOverdue=0;
  let lastInvoice: any = null;
  for (const inv of yearInvoices) {
    const total=parseFloat(inv.total)||0, bal=parseFloat(inv.balance)||0;
    totalBilled+=total; totalPaid+=total-bal;
    if (inv.status==="overdue"){totalUnpaid+=bal;countOverdue++;}
    else if(inv.status!=="paid"&&inv.status!=="void") totalUnpaid+=bal;
    if(!lastInvoice||inv.date>lastInvoice.date)
      lastInvoice={number:inv.invoice_number,date:inv.date,total,status:inv.status,currency:inv.currency_code};
  }
  let rolling12AED=0, totalBilledAED=0, totalPaidAED=0, totalUnpaidAED=0, prevYearAED=0;
  for(const inv of r12Invoices)  if(inv.status!=="void") rolling12AED+=toAED(inv);
  for(const inv of yearInvoices) if(inv.status!=="void"){ totalBilledAED+=toAED(inv); totalPaidAED+=toAED(inv)-toAEDBalance(inv); totalUnpaidAED+=toAEDBalance(inv); }
  for(const inv of prevInvoices) if(inv.status!=="void") prevYearAED+=toAED(inv);

  return {
    year, totalBilled, totalPaid, totalUnpaid, countInvoices, countOverdue, lastInvoice,
    orgCurrency: yearInvoices[0]?.currency_code || "AED",
    totalBilledAED, totalPaidAED, totalUnpaidAED,
    rolling12AED, rolling12Start: r12Str,
    vatStatus: rolling12AED>=375000?"exceeded":rolling12AED>=300000?"warning":"ok",
    vatThreshold: 375000, vatWarnAt: 300000, prevYearAED,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { action, org_id } = await req.json();
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
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: clients } = await supabase
        .from("clients")
        .select("id, company_name, zoho_org_id")
        .not("zoho_org_id", "is", null)
        .eq("is_active", true);

      if (!clients?.length) return new Response(JSON.stringify({ synced: 0 }), { headers: corsHeaders });

      let synced = 0, errors = 0;
      for (const client of clients) {
        try {
          const s = await calcSummary(client.zoho_org_id, token);
          await supabase.from("zoho_snapshots").upsert({
            client_id:        client.id,
            updated_at:       new Date().toISOString(),
            rolling12_aed:    s.rolling12AED,
            total_billed_aed: s.totalBilledAED,
            total_unpaid_aed: s.totalUnpaidAED,
            vat_status:       s.vatStatus,
            year:             s.year,
            count_invoices:   s.countInvoices,
            count_overdue:    s.countOverdue,
            org_currency:     s.orgCurrency,
          }, { onConflict: "client_id" });
          synced++;
        } catch { errors++; }
      }
      return new Response(JSON.stringify({ synced, errors }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
