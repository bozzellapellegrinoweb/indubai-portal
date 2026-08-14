// Edge Function "client-expense" — app cliente "Spese Indubai" (senza login).
// Autenticazione custom via token per-cliente (clients.expense_token).
// Azioni:
//   - config: valida il token → dati cliente + carte (bank_accounts)
//   - upload: salva lo scontrino su storage, estrae i dati con AI, crea la spesa (pending)
// Non tocca nessuna funzione esistente.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function findClientByToken(sb: any, token: string) {
  if (!token) return null;
  const { data } = await sb.from('clients')
    .select('id, company_name, bank_accounts, zoho_org_id, is_active')
    .eq('expense_token', token).limit(1);
  return data?.[0] || null;
}

// Estrazione dati scontrino con Claude Vision (best-effort)
async function extractReceipt(base64: string, mime: string) {
  if (!ANTHROPIC_KEY) return null;
  const isPdf = mime === 'application/pdf';
  const imgTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const source = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: imgTypes.includes(mime) ? mime : 'image/jpeg', data: base64 } };
  const prompt = `You are reading a single UAE expense receipt or tax invoice. Return ONLY a JSON object, no other text:
{
  "vendor": "actual merchant name",
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "currency": "AED/EUR/USD/...",
  "supplier_trn": "",
  "is_tax_invoice": false,
  "vat_amount": 0.00,
  "category_guess": ""
}
Rules:
- vendor = the actual shop/restaurant/business (trading name) where the purchase was made, usually the biggest name/logo at the top of the receipt. Do NOT use the payment processor, acquiring bank, POS/terminal descriptor or gateway (ignore names such as Merchant Services, ADCB, Mashreq, Network International, Payment Gateway, POS). If both a processor descriptor and a store name appear, always use the store name.
- amount = grand total actually paid (numbers only).
- date in YYYY-MM-DD; if unclear use empty string.
- supplier_trn = the SUPPLIER's Tax Registration Number: a ~15-digit number, usually labelled TRN, Tax Reg. No, TRN No, or VATIN. Digits only. Empty string if none is printed.
- is_tax_invoice = true ONLY if BOTH are present: (a) a supplier TRN is printed, AND (b) VAT/tax is evidenced — either an explicit VAT/Tax line, or wording that the total is inclusive of VAT / 5%. The words "Tax Invoice" support this but the TRN is mandatory. A plain sales receipt / slip with no TRN is NOT a tax invoice.
- vat_amount:
  - If is_tax_invoice is false → 0 (do NOT invent VAT).
  - If a VAT/tax amount is explicitly printed → that number.
  - If it is a tax invoice stating the total is inclusive of 5% VAT but no separate line is shown → amount * 5 / 105, rounded to 2 decimals.
- category_guess = a short, generic accounting expense category in English that best fits this purchase, chosen from common Zoho Books-style names, e.g.: "Meals and Entertainment", "Fuel/Mileage Expenses", "Travel Expense", "Automobile Expense", "Office Supplies", "Telephone Expense", "Internet Expense", "Rent Expense", "Repairs and Maintenance", "IT and Internet Expenses", "Advertising And Marketing", "Consultant Expense", "Bank Fees and Charges", "Printing and Stationery", "Postage", "Lodging", "Purchase", "Other Expenses". Pick the single closest; empty string only if truly impossible to tell.
- Return valid JSON only, no markdown.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: [source, { type: 'text', text: prompt }] }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = d?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const token = (body.token || '').toString().trim();

    const client = await findClientByToken(sb, token);
    if (!client) return json({ ok: false, error: 'invalid_token' }, 401);

    if (action === 'config') {
      return json({
        ok: true,
        client: { company_name: client.company_name },
        cards: Array.isArray(client.bank_accounts) ? client.bank_accounts : [],
      });
    }

    if (action === 'upload') {
      const b64 = (body.file_base64 || '').toString();
      const mime = (body.mime || 'image/jpeg').toString();
      if (!b64) return json({ ok: false, error: 'file_required' }, 400);

      // decode + upload su storage (lo fa il service_role, il cliente non tocca lo storage)
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
      catch (_) { return json({ ok: false, error: 'bad_file' }, 400); }

      const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] || 'jpg');
      const path = `${client.id}/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from('expense-receipts').upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) return json({ ok: false, error: 'storage: ' + up.error.message }, 500);

      // estrazione AI (best-effort: se fallisce, la spesa si salva comunque)
      const ai = await extractReceipt(b64, mime);
      const cleanDate = ai?.date && /^\d{4}-\d{2}-\d{2}$/.test(ai.date) ? ai.date : null;
      const isTaxInvoice = ai?.is_tax_invoice === true;
      const trn = (ai?.supplier_trn || '').toString().replace(/\D/g, '') || null;
      // IVA valida solo su tax invoice: se non lo è, resta 0 (niente IVA inventata)
      const vat = (isTaxInvoice && ai && ai.vat_amount != null && !isNaN(Number(ai.vat_amount)))
        ? Number(ai.vat_amount) : 0;

      const row = {
        client_id: client.id,
        zoho_org_id: client.zoho_org_id || null,
        storage_path: path,
        mime_type: mime,
        vendor: ai?.vendor || null,
        expense_date: cleanDate,
        amount: (ai && ai.amount != null && !isNaN(Number(ai.amount))) ? Number(ai.amount) : null,
        currency: ai?.currency || null,
        supplier_trn: trn,
        is_tax_invoice: isTaxInvoice,
        vat_amount: vat,
        ai_raw: ai || null,
        paid_with: (body.paid_with || '').toString().trim() || null,
        note: (body.note || '').toString().trim() || null,
        status: 'pending',
      };
      const ins = await sb.from('client_expenses').insert(row).select('id').single();
      if (ins.error) return json({ ok: false, error: 'db: ' + ins.error.message }, 500);

      return json({
        ok: true,
        id: ins.data.id,
        extracted: { vendor: row.vendor, date: row.expense_date, amount: row.amount, currency: row.currency, vat_amount: row.vat_amount },
      });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
});
