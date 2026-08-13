// Edge Function "expense-zoho" — Fase 2 di "Spese Indubai".
// Usata dalla pagina staff per: elencare i conti Zoho e registrare la spesa
// (con allegato) in Zoho Books. Isolata: non tocca zoho-proxy.
// verify_jwt = true → chiamabile solo da staff autenticato.

const ZOHO_CLIENT_ID = Deno.env.get('ZOHO_CLIENT_ID') || '';
const ZOHO_CLIENT_SECRET = Deno.env.get('ZOHO_CLIENT_SECRET') || '';
const ZOHO_REFRESH_TOKEN = Deno.env.get('ZOHO_REFRESH_TOKEN') || '';
const ZOHO_API_BASE = 'https://www.zohoapis.com/books/v3';
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

let cachedToken: { token: string; expires: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60000) return cachedToken.token;
  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed');
  cachedToken = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function sbGet(path: string) {
  const r = await fetch(SB_URL + path, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
  return r.json();
}
async function sbPatch(path: string, patch: unknown) {
  await fetch(SB_URL + path, {
    method: 'PATCH',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const token = await getAccessToken();

    // Elenco conti: categorie spesa + conti "pagato con"
    if (action === 'list_expense_accounts' && body.org_id) {
      const r = await fetch(ZOHO_API_BASE + '/chartofaccounts?organization_id=' + body.org_id + '&per_page=200', {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const data = await r.json();
      const accts = data.chartofaccounts || [];
      const EXP = ['expense', 'cost_of_goods_sold', 'other_expense'];
      const PAY = ['bank', 'credit_card', 'cash'];
      const expense_accounts = accts.filter((a: any) => EXP.includes(a.account_type)).map((a: any) => ({ id: a.account_id, name: a.account_name }));
      const paid_accounts = accts.filter((a: any) => PAY.includes(a.account_type)).map((a: any) => ({ id: a.account_id, name: a.account_name }));
      // Nota: se lo scope Zoho non include chartofaccounts, gli elenchi restano vuoti (categoria di default).
      return json({ ok: true, expense_accounts, paid_accounts });
    }

    // Crea la spesa in Zoho Books + allega lo scontrino
    if (action === 'create_expense_with_receipt' && body.expense_id) {
      const rows = await sbGet('/rest/v1/client_expenses?id=eq.' + body.expense_id + '&select=*');
      const exp = rows?.[0];
      if (!exp) return json({ ok: false, error: 'expense not found' }, 404);
      const oid = exp.zoho_org_id;
      // Conti opzionali: se non forniti, Zoho usa i conti di default (come la Riconciliazione).
      const cat = body.category_account_id || exp.category_account_id || null;
      const paid = body.paid_through_account_id || exp.paid_through_account_id || null;
      if (!oid) return json({ ok: false, error: 'client has no Zoho org' }, 400);
      if (!exp.amount || !exp.expense_date) return json({ ok: false, error: 'amount and date required' }, 400);

      const expenseBody: any = {
        date: exp.expense_date,
        amount: Number(exp.amount),
        description: [exp.vendor, exp.note].filter(Boolean).join(' — ') || 'Expense',
        reference_number: exp.paid_with ? ('Paid with: ' + exp.paid_with) : '',
      };
      if (cat) expenseBody.account_id = cat;
      if (paid) expenseBody.paid_through_account_id = paid;
      const cr = await fetch(ZOHO_API_BASE + '/expenses?organization_id=' + oid, {
        method: 'POST',
        headers: { Authorization: 'Zoho-oauthtoken ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(expenseBody),
      });
      const cd = await cr.json();
      if (cd.code !== 0) {
        await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, { status: 'error', error_msg: cd.message || 'Zoho create failed' });
        return json({ ok: false, error: cd.message || 'Zoho create failed' }, 400);
      }
      const zid = cd.expense?.expense_id;

      // allega lo scontrino (best-effort)
      let attached = false; let attachErr: string | null = null;
      try {
        const fileRes = await fetch(SB_URL + '/storage/v1/object/expense-receipts/' + exp.storage_path, {
          headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
        });
        if (fileRes.ok) {
          const buf = new Uint8Array(await fileRes.arrayBuffer());
          const fname = exp.storage_path.split('/').pop() || 'receipt';
          const fd = new FormData();
          fd.append('attachment', new Blob([buf], { type: exp.mime_type || 'application/octet-stream' }), fname);
          const ar = await fetch(ZOHO_API_BASE + '/expenses/' + zid + '/attachment?organization_id=' + oid, {
            method: 'POST', headers: { Authorization: 'Zoho-oauthtoken ' + token }, body: fd,
          });
          const ad = await ar.json();
          attached = ad.code === 0;
          if (!attached) attachErr = ad.message || 'attach failed';
        } else {
          attachErr = 'receipt download failed (' + fileRes.status + ')';
        }
      } catch (e) { attachErr = (e as Error).message; }

      await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, {
        status: 'posted', zoho_expense_id: zid, error_msg: attachErr, approved_at: new Date().toISOString(),
      });
      return json({ ok: true, zoho_expense_id: zid, attached, attach_error: attachErr });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
});
