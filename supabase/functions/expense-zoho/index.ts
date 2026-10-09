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

// Il token Zoho vive un'ora, ma ogni istanza della funzione partiva con la
// cache vuota: approvando piu' spese di fila si chiedeva un refresh per
// ciascuna, e Zoho limita quell'endpoint ("Token refresh failed" a meta'
// lavoro). La cache sta quindi nel database, condivisa fra le istanze, e un
// refresh all'ora basta per tutti. La tabella ha RLS senza policy: solo il
// service_role la vede, e il token non e' leggibile dal portale.
let cachedToken: { token: string; expires: number } | null = null;

async function readSharedToken(): Promise<{ token: string; expires: number } | null> {
  try {
    const r = await fetch(SB_URL + '/rest/v1/zoho_token_cache?id=eq.zoho&select=access_token,expires_at', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
    });
    const rows = await r.json();
    const row = rows?.[0];
    if (!row) return null;
    return { token: row.access_token, expires: new Date(row.expires_at).getTime() };
  } catch (_) { return null; }
}

async function writeSharedToken(token: string, expires: number) {
  try {
    await fetch(SB_URL + '/rest/v1/zoho_token_cache', {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        id: 'zoho', access_token: token,
        expires_at: new Date(expires).toISOString(), updated_at: new Date().toISOString(),
      }),
    });
  } catch (_) { /* la cache e' un'ottimizzazione: se non si scrive, si rifara' */ }
}

async function getAccessToken(): Promise<string> {
  const MARGINE = 120000;  // non usiamo un token che scade fra meno di 2 minuti
  if (cachedToken && Date.now() < cachedToken.expires - MARGINE) return cachedToken.token;

  const shared = await readSharedToken();
  if (shared && Date.now() < shared.expires - MARGINE) {
    cachedToken = shared;
    return shared.token;
  }

  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    // Zoho ci ha limitati. Se in cache c'e' ancora un token valido, anche se
    // vicino alla scadenza, meglio quello che fermare un'approvazione.
    if (shared && Date.now() < shared.expires) {
      cachedToken = shared;
      return shared.token;
    }
    throw new Error('Token refresh failed: ' + (data.error || res.status));
  }
  const expires = Date.now() + Number(data.expires_in || 3600) * 1000;
  cachedToken = { token: data.access_token, expires };
  await writeSharedToken(data.access_token, expires);
  return data.access_token;
}

// Cache del tax_id 5% per organizzazione (chiave: percentuale = 5, tipo "tax")
const taxIdCache: Record<string, string | null> = {};
async function getFivePctTaxId(oid: string, token: string): Promise<string | null> {
  if (oid in taxIdCache) return taxIdCache[oid];
  try {
    const r = await fetch(ZOHO_API_BASE + '/settings/taxes?organization_id=' + oid, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
    });
    const data = await r.json();
    const taxes = Array.isArray(data.taxes) ? data.taxes : [];
    const five = taxes.find((t: any) =>
      Number(t.tax_percentage) === 5 && (t.tax_type === 'tax' || !t.tax_type) && !t.is_deleted);
    taxIdCache[oid] = five ? String(five.tax_id) : null;
  } catch (_) {
    taxIdCache[oid] = null;
  }
  return taxIdCache[oid];
}

// Aliquote dell'organizzazione: ci servono la 5% (IVA a credito) e la 0%
// per la parte fuori campo, tipica delle pratiche con tasse governative.
const taxesCache: Record<string, { five: string | null; zero: string | null }> = {};
async function getTaxes(oid: string, token: string) {
  if (oid in taxesCache) return taxesCache[oid];
  let five: string | null = null, zero: string | null = null;
  try {
    const r = await fetch(ZOHO_API_BASE + '/settings/taxes?organization_id=' + oid, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
    });
    const d = await r.json();
    for (const t of (d.taxes || [])) {
      if (t.is_deleted) continue;
      const pct = Number(t.tax_percentage);
      if (pct === 5 && !five) five = String(t.tax_id);
      if (pct === 0 && !zero) zero = String(t.tax_id);
    }
  } catch (_) { /* restano null: lo segnaliamo a chi approva */ }
  taxesCache[oid] = { five, zero };
  return taxesCache[oid];
}

/** Trova il fornitore per nome, altrimenti lo crea. Le Bill richiedono un vendor_id. */
async function findOrCreateVendor(oid: string, token: string, name: string, trn: string | null) {
  const H = { Authorization: 'Zoho-oauthtoken ' + token };
  const clean = (name || '').trim().slice(0, 200);
  if (!clean) return { id: null, error: 'fornitore senza nome' };
  try {
    const r = await fetch(ZOHO_API_BASE + '/contacts?organization_id=' + oid
      + '&contact_type=vendor&search_text=' + encodeURIComponent(clean) + '&per_page=50', { headers: H });
    const d = await r.json();
    const hit = (d.contacts || []).find((c: any) =>
      (c.contact_name || '').trim().toLowerCase() === clean.toLowerCase());
    if (hit) return { id: String(hit.contact_id), created: false };
  } catch (_) { /* proviamo comunque a crearlo */ }

  const payload: any = { contact_name: clean, contact_type: 'vendor' };
  if (trn) payload.tax_reg_no = trn;
  const post = async (b: any) => {
    const r = await fetch(ZOHO_API_BASE + '/contacts?organization_id=' + oid, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    });
    return r.json();
  };
  let d = await post(payload);
  // Se il TRN non e' accettato (formato, o campo non previsto), creiamo senza
  if (d.code !== 0 && trn) d = await post({ contact_name: clean, contact_type: 'vendor' });
  if (d.code !== 0) return { id: null, error: d.message || 'creazione fornitore fallita' };
  return { id: String(d.contact.contact_id), created: true };
}

/**
 * Conto di spesa da usare sulle righe della Bill.
 * A differenza delle Expense, dove Zoho ripiega sul conto di default, le Bill
 * pretendono un account_id su ogni riga: senza, rifiuta con "The account
 * field cannot be empty". Se chi approva non ha scelto la categoria, la
 * deduciamo dal suggerimento dell'AI, altrimenti prendiamo un conto generico.
 */
const accountsCache: Record<string, any[]> = {};
async function resolveExpenseAccount(oid: string, token: string, guess: string | null) {
  if (!(oid in accountsCache)) {
    try {
      const r = await fetch(ZOHO_API_BASE + '/chartofaccounts?organization_id=' + oid + '&per_page=200', {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      const EXP = ['expense', 'cost_of_goods_sold', 'other_expense'];
      accountsCache[oid] = (d.chartofaccounts || [])
        .filter((a: any) => EXP.includes(a.account_type) && !a.is_deleted)
        .map((a: any) => ({ id: String(a.account_id), name: String(a.account_name || '') }));
    } catch (_) { accountsCache[oid] = []; }
  }
  const accts = accountsCache[oid];
  if (!accts.length) return { id: null, name: null };

  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (guess) {
    const g = new Set(norm(guess).split(' ').filter(w => w.length > 2));
    let best: any = null, score = 0;
    for (const a of accts) {
      const n = norm(a.name).split(' ').filter(w => w.length > 2).filter(w => g.has(w)).length;
      if (n > score) { score = n; best = a; }
    }
    if (best) return best;
  }
  const generico = accts.find((a: any) => /other expense|altre spese|miscellaneous|general expense/i.test(a.name));
  return generico || accts[0];
}

/**
 * Conto da cui e' uscito il denaro, dedotto dal "pagato con" del cliente.
 * I conti si chiamano "WIO - AED ***7129", "mamopay", "CrediumPay": basta il
 * nome piu' la valuta per azzeccarlo. Senza, Zoho userebbe "Fondi non
 * depositati", che non e' dove il cliente ha pagato davvero.
 */
const PAY_MARKER = 'Pagata al caricamento';
const payAcctCache: Record<string, any[]> = {};
async function resolvePaymentAccount(oid: string, token: string, paidWith: string | null, currency: string | null) {
  if (!paidWith) return null;
  if (!(oid in payAcctCache)) {
    try {
      const r = await fetch(ZOHO_API_BASE + '/chartofaccounts?organization_id=' + oid + '&per_page=200', {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      const PAY = ['bank', 'credit_card', 'cash'];
      payAcctCache[oid] = (d.chartofaccounts || [])
        .filter((a: any) => PAY.includes(a.account_type) && !a.is_deleted)
        .map((a: any) => ({ id: String(a.account_id), name: String(a.account_name || '') }));
    } catch (_) { payAcctCache[oid] = []; }
  }
  const accts = payAcctCache[oid];
  if (!accts.length) return null;

  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const chiave = norm(paidWith);
  if (!chiave) return null;
  const candidati = accts.filter((a: any) => norm(a.name).includes(chiave));
  if (!candidati.length) return null;
  // Stesso nome ma valute diverse (WIO AED / USD / EUR): scegliamo la valuta giusta.
  if (currency && candidati.length > 1) {
    const perValuta = candidati.find((a: any) => norm(a.name).includes(norm(currency)));
    if (perValuta) return perValuta;
  }
  return candidati[0];
}

/**
 * Registra il pagamento della Bill: quello che il cliente carica l'ha gia'
 * pagato, quindi lasciarla "open" la farebbe risultare da pagare per sempre.
 */
async function payBill(oid: string, token: string, billId: string, vendorId: string, exp: any, acct: any, importo: number) {
  const body: any = {
    vendor_id: vendorId,
    date: exp.expense_date,
    amount: importo,
    paid_through_account_id: acct.id,
    bills: [{ bill_id: billId, amount_applied: importo }],
    description: PAY_MARKER + (exp.paid_with ? ' — ' + exp.paid_with : ''),
  };
  const r = await fetch(ZOHO_API_BASE + '/vendorpayments?organization_id=' + oid, {
    method: 'POST',
    headers: { Authorization: 'Zoho-oauthtoken ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  return {
    ok: d.code === 0,
    id: d.vendorpayment?.payment_id ? String(d.vendorpayment.payment_id) : null,
    error: d.code === 0 ? null : (d.message || 'pagamento non registrato'),
  };
}

/**
 * I pagamenti applicati a una Bill, chiesti alla Bill stessa: e' l'unica
 * fonte certa, e vale anche per le Bill registrate prima che tenessimo l'id.
 * Di ognuno guardiamo la descrizione, perche' cancellare il pagamento messo
 * a mano dalla contabilita' sarebbe peggio di non cancellare niente: se la
 * descrizione non porta il nostro marcatore, lo lasciamo stare e lo diciamo.
 */
async function paymentsOfBill(oid: string, token: string, billId: string, attesoId: string | null) {
  const nostri: string[] = [];
  const altrui: string[] = [];
  try {
    const r = await fetch(ZOHO_API_BASE + '/bills/' + billId + '?organization_id=' + oid, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
    });
    const d = await r.json();
    for (const p of (d.bill?.payments || [])) {
      const pid = String(p.payment_id);
      const descr = String(p.description || '');
      if (pid === attesoId || descr.startsWith(PAY_MARKER)) nostri.push(pid);
      else altrui.push(pid);
    }
  } catch (_) { /* senza elenco non cancelliamo niente */ }
  return { nostri, altrui };
}

/** Nome leggibile per l'allegato: sullo storage e' un UUID, su Zoho non si capirebbe. */
function attachmentName(exp: any) {
  const ext = (exp.storage_path || '').split('.').pop() || 'pdf';
  const base = [exp.vendor || 'Documento', exp.expense_date || '']
    .filter(Boolean).join(' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return base + '.' + ext;
}

/** Allega il file del documento. Best-effort: non blocca mai la registrazione. */
async function attachReceipt(kind: 'expenses' | 'bills', zid: string, oid: string, token: string, exp: any) {
  try {
    const fileRes = await fetch(SB_URL + '/storage/v1/object/expense-receipts/' + exp.storage_path, {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
    });
    if (!fileRes.ok) return { attached: false, error: 'receipt download failed (' + fileRes.status + ')' };
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    const fd = new FormData();
    fd.append('attachment', new Blob([buf], { type: exp.mime_type || 'application/octet-stream' }), attachmentName(exp));
    const ar = await fetch(ZOHO_API_BASE + '/' + kind + '/' + zid + '/attachment?organization_id=' + oid, {
      method: 'POST', headers: { Authorization: 'Zoho-oauthtoken ' + token }, body: fd,
    });
    const ad = await ar.json();
    return { attached: ad.code === 0, error: ad.code === 0 ? null : (ad.message || 'attach failed') };
  } catch (e) { return { attached: false, error: (e as Error).message }; }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Righe prese dal documento, quando l'AI le ha lette e i conti tornano.
 * E' la via preferita: la Bill rispecchia la fattura riga per riga, e la base
 * imponibile e' quella stampata invece di una stima ricavata dall'IVA.
 * Torna null se qualcosa non quadra, cosi' si ricade sulla stima.
 */
function linesFromDocument(ai: any, total: number, vat: number, accountId: string | null, taxes: { five: string | null; zero: string | null }) {
  const raw = Array.isArray(ai?.line_items) ? ai.line_items : [];
  if (!raw.length || !taxes.five || !taxes.zero) return null;

  const items = raw.map((i: any) => ({
    desc: String(i?.description || '').trim().slice(0, 100),
    amount: r2(Number(i?.amount) || 0),
    taxable: i?.taxable === true,
  }));
  if (items.some((i: any) => !(i.amount > 0) || !i.desc)) return null;

  const netto = r2(items.reduce((s: number, i: any) => s + i.amount, 0));
  const imponibile = r2(items.filter((i: any) => i.taxable).reduce((s: number, i: any) => s + i.amount, 0));

  // Le righe devono ricostruire il totale, e l'IVA sulla parte imponibile
  // deve combaciare con quella stampata. Un centesimo di tolleranza per gli
  // arrotondamenti del fornitore.
  if (Math.abs(r2(netto + vat) - total) > 0.02) return null;
  if (Math.abs(r2(imponibile * 0.05) - vat) > 0.02) return null;

  return items.map((i: any) => {
    const li: any = { name: i.desc, rate: i.amount, quantity: 1 };
    if (accountId) li.account_id = accountId;
    li.tax_id = i.taxable ? taxes.five : taxes.zero;
    return li;
  });
}

/**
 * Righe della Bill a partire da totale lordo e IVA letta dal documento.
 * Non assumiamo che l'IVA sia il 5% del totale: su molte fatture UAE una
 * parte e' fuori campo (tasse governative) e il 5% colpisce solo il servizio.
 */
function buildBillLines(total: number, vat: number, accountId: string | null, taxes: { five: string | null; zero: string | null }, label: string) {
  const lines: any[] = [];
  const base = (rate: number, taxId: string | null, suffix: string) => {
    const li: any = { name: (label + suffix).slice(0, 100), rate: r2(rate), quantity: 1 };
    if (accountId) li.account_id = accountId;
    if (taxId) li.tax_id = taxId;
    return li;
  };
  if (vat > 0 && taxes.five) {
    const imponibile = r2(vat / 0.05);
    const fuoriCampo = r2(total - imponibile - vat);
    lines.push(base(imponibile, taxes.five, ''));
    if (fuoriCampo >= 0.01) lines.push(base(fuoriCampo, taxes.zero, ' — fuori campo IVA'));
  } else {
    lines.push(base(total, taxes.zero, ''));
  }
  return lines;
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

    // Imposte configurate nell'organizzazione: serve per capire con quale
    // aliquota registrare l'IVA a credito di una fattura.
    if (action === 'list_taxes' && body.org_id) {
      const r = await fetch(ZOHO_API_BASE + '/settings/taxes?organization_id=' + body.org_id, {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      return json({ ok: d.code === 0, message: d.message, taxes: (d.taxes || []).map((t: any) => ({
        tax_id: t.tax_id, name: t.tax_name, percentage: t.tax_percentage,
        type: t.tax_type, specific_type: t.tax_specific_type, deleted: t.is_deleted,
      })) });
    }

    // Clienti dell'organizzazione: per attribuire una spesa da riaddebitare.
    // Zoho ne da' al massimo 200 per pagina: senza impaginare, i clienti oltre
    // il duecentesimo sparirebbero dall'elenco senza dirlo a nessuno.
    if (action === 'list_customers' && body.org_id) {
      const customers: any[] = [];
      let page = 1, hasMore = true, lastMsg = 'success';
      while (hasMore && page <= 10) {
        const r = await fetch(ZOHO_API_BASE + '/contacts?organization_id=' + body.org_id
          + '&contact_type=customer&status=active&per_page=200&page=' + page, {
          headers: { Authorization: 'Zoho-oauthtoken ' + token },
        });
        const d = await r.json();
        if (d.code !== 0) return json({ ok: false, message: d.message || 'errore', customers });
        lastMsg = d.message || 'success';
        for (const c of (d.contacts || [])) customers.push({ id: c.contact_id, name: c.contact_name });
        hasMore = !!d.page_context?.has_more_page;
        page++;
      }
      customers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'));
      return json({ ok: true, message: lastMsg, customers, truncated: hasMore });
    }

    // Pagamenti a fornitore registrati nell'organizzazione. Serve in
    // riconciliazione per rispondere a "il pagamento e' arrivato?" e per
    // accorgersi degli acconti non applicati, che sono soldi usciti senza una
    // fattura a cui si riferiscono.
    if (action === 'list_vendor_payments' && body.org_id) {
      const qs = new URLSearchParams({ organization_id: body.org_id, per_page: '200' });
      if (body.vendor_id) qs.set('vendor_id', String(body.vendor_id));
      const r = await fetch(ZOHO_API_BASE + '/vendorpayments?' + qs.toString(), {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      if (d.code !== 0) return json({ ok: false, error: d.message || 'errore' }, 400);
      return json({ ok: true, payments: (d.vendorpayments || []).map((x: any) => ({
        id: x.payment_id, data: x.date, fornitore: x.vendor_name,
        importo: x.amount, non_applicato: x.unused_amount,
        conto: x.paid_through_account_name, descrizione: x.description,
      })) });
    }

    // Rilegge un documento registrato: per controllare com'e' venuto davvero
    // (righe, imposte, allegato) senza aprire Zoho.
    if (action === 'get_doc' && body.org_id && body.doc_id) {
      const kind = body.doc_type === 'bill' ? 'bills' : 'expenses';
      const r = await fetch(ZOHO_API_BASE + '/' + kind + '/' + body.doc_id + '?organization_id=' + body.org_id, {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      if (d.code !== 0) return json({ ok: false, error: d.message || 'non trovato' }, 404);
      const doc = d.bill || d.expense || {};
      return json({ ok: true, doc: {
        numero: doc.bill_number, data: doc.date, fornitore: doc.vendor_name,
        totale: doc.total, imponibile: doc.sub_total, imposta: doc.tax_total,
        stato: doc.status, cliente: doc.customer_name, fatturabile: doc.is_billable,
        da_pagare: doc.balance, pagato: doc.payment_made ?? doc.total_credits_used,
        allegato: doc.attachment_name || doc.documents?.[0]?.file_name || null,
        righe: (doc.line_items || []).map((l: any) => ({
          descrizione: l.name || l.description, importo: l.rate,
          imposta: l.tax_name || (l.tax_percentage != null ? l.tax_percentage + '%' : null),
        })),
      } });
    }

    // Registra il documento in Zoho Books e vi allega il file.
    //
    // Fattura fornitore (TRN + IVA)  -> Bill, con l'IVA a credito per riga:
    //   e' da li' che entra nel VAT return come input tax.
    // Scontrino senza TRN            -> Expense, come prima.
    if (action === 'create_expense_with_receipt' && body.expense_id) {
      const rows = await sbGet('/rest/v1/client_expenses?id=eq.' + body.expense_id + '&select=*');
      const exp = rows?.[0];
      if (!exp) return json({ ok: false, error: 'expense not found' }, 404);
      const oid = exp.zoho_org_id;
      const cat = body.category_account_id || exp.category_account_id || null;
      const paid = body.paid_through_account_id || exp.paid_through_account_id || null;
      if (!oid) return json({ ok: false, error: 'client has no Zoho org' }, 400);
      if (!exp.amount || !exp.expense_date) return json({ ok: false, error: 'amount and date required' }, 400);

      // Riaddebito: lo decide chi approva, non il cliente che carica.
      const isBillable = body.is_billable === true;
      const customerId = body.zoho_customer_id || null;
      const customerName = body.zoho_customer_name || null;

      const note: string[] = [];
      const label = [exp.vendor, exp.note].filter(Boolean).join(' — ') || 'Expense';
      const total = Number(exp.amount);
      const vat = Number(exp.vat_amount) || 0;

      // ── Fattura: Bill ────────────────────────────────────────────────
      if (exp.is_tax_invoice) {
        const taxes = await getTaxes(oid, token);
        if (!taxes.five && vat > 0) note.push("Aliquota 5% non trovata nell'organizzazione: IVA non applicata");

        const vend = await findOrCreateVendor(oid, token, exp.vendor || '', exp.supplier_trn || null);
        if (!vend.id) {
          await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id,
            { status: 'error', error_msg: 'Fornitore Zoho: ' + (vend.error || 'non creato') });
          return json({ ok: false, error: 'Fornitore Zoho: ' + (vend.error || 'non creato') }, 400);
        }
        if (vend.created) note.push('Fornitore creato in anagrafica Zoho');

        // Le Bill vogliono un conto su ogni riga: se manca, lo deduciamo.
        let billAcct = cat;
        if (!billAcct) {
          const scelto = await resolveExpenseAccount(oid, token, exp.ai_raw?.category_guess || null);
          billAcct = scelto.id;
          if (billAcct) note.push('Categoria non scelta: usato il conto "' + scelto.name + '"');
          else note.push('Nessun conto di spesa disponibile in Zoho');
        }

        // Righe lette dal documento se i conti tornano, altrimenti stimate dall'IVA.
        const fromDoc = linesFromDocument(exp.ai_raw, total, vat, billAcct, taxes);
        if (!fromDoc && vat > 0) note.push('Righe non leggibili dal documento: imponibile stimato dall' + String.fromCharCode(39) + 'IVA');

        // Riaddebito: su una Bill il cliente si segna riga per riga, non sul
        // documento. Senza questo la spunta in approvazione non arriverebbe
        // mai a Zoho.
        const righe = fromDoc || buildBillLines(total, vat, billAcct, taxes, label);
        if (isBillable && customerId) for (const l of righe) l.customer_id = customerId;
        else if (isBillable) note.push('Da riaddebitare ma senza cliente Zoho: registrata non fatturabile');

        const billBody: any = {
          vendor_id: vend.id,
          date: exp.expense_date,
          is_inclusive_tax: false,
          line_items: righe,
          notes: exp.note || '',
          reference_number: exp.paid_with ? ('Paid with: ' + exp.paid_with) : '',
        };
        if (exp.invoice_number) billBody.bill_number = String(exp.invoice_number).slice(0, 50);

        const postBill = async (payload: any) => {
          const r = await fetch(ZOHO_API_BASE + '/bills?organization_id=' + oid, {
            method: 'POST',
            headers: { Authorization: 'Zoho-oauthtoken ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          return r.json();
        };
        let bd = await postBill(billBody);
        // Numero gia' usato per quel fornitore: lo rendiamo unico invece di fallire
        if (bd.code !== 0 && /bill number|already exists|duplicate/i.test(bd.message || '')) {
          note.push("Numero fattura gia' presente: aggiunto un suffisso");
          bd = await postBill({ ...billBody, bill_number: (billBody.bill_number || 'BILL') + '-' + String(Date.now()).slice(-5) });
        }
        if (bd.code !== 0) {
          const msg = bd.message || 'Zoho bill failed';
          await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, { status: 'error', error_msg: msg });
          return json({ ok: false, error: msg }, 400);
        }
        const bid = String(bd.bill.bill_id);
        const taxApplied = vat > 0 && !!taxes.five;
        const att = await attachReceipt('bills', bid, oid, token, exp);
        if (!att.attached) note.push('Allegato non caricato: ' + att.error);

        // Quello che il cliente carica l'ha gia' pagato: senza registrare il
        // pagamento la Bill resterebbe "da pagare" per sempre.
        let pagata = false;
        let payId: string | null = null;
        if (body.mark_paid !== false) {
          const acct = paid
            ? { id: paid, name: 'conto scelto' }
            : await resolvePaymentAccount(oid, token, exp.paid_with, exp.currency);
          if (acct) {
            const pay = await payBill(oid, token, bid, vend.id, exp, acct, Number(bd.bill.total));
            pagata = pay.ok;
            payId = pay.id;
            if (pay.ok) note.push('Segnata pagata da "' + acct.name + '"');
            else note.push('Pagamento non registrato: ' + pay.error);
          } else {
            note.push('Conto di pagamento non riconosciuto da "' + (exp.paid_with || '—') + '": Bill lasciata da pagare');
          }
        }

        await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, {
          status: 'posted', zoho_doc_type: 'bill', zoho_bill_id: bid, zoho_vendor_id: vend.id,
          zoho_payment_id: payId,
          tax_applied: taxApplied, is_billable: isBillable,
          zoho_customer_id: customerId, zoho_customer_name: customerName,
          error_msg: null, post_notes: note.join(' · ') || null,
          approved_at: new Date().toISOString(),
        });
        return json({ ok: true, doc_type: 'bill', zoho_bill_id: bid, attached: att.attached,
                      tax_applied: taxApplied, paid: pagata, notes: note });
      }

      // ── Scontrino: Expense ───────────────────────────────────────────
      const expenseBody: any = {
        date: exp.expense_date,
        amount: total,
        description: label,
        reference_number: exp.paid_with ? ('Paid with: ' + exp.paid_with) : '',
      };
      if (cat) expenseBody.account_id = cat;
      // Senza conto, Zoho usa "Fondi non depositati": lo deduciamo dal "pagato con".
      let expPaid = paid;
      if (!expPaid) {
        const acct = await resolvePaymentAccount(oid, token, exp.paid_with, exp.currency);
        if (acct) { expPaid = acct.id; note.push('Pagata da "' + acct.name + '"'); }
      }
      if (expPaid) expenseBody.paid_through_account_id = expPaid;
      // Riaddebito: Zoho vuole il cliente, altrimenti la spesa resta non fatturabile.
      if (isBillable && customerId) {
        expenseBody.customer_id = customerId;
        expenseBody.is_billable = true;
      } else if (isBillable && !customerId) {
        note.push('Da riaddebitare ma senza cliente Zoho: registrata non fatturabile');
      }

      const r = await fetch(ZOHO_API_BASE + '/expenses?organization_id=' + oid, {
        method: 'POST',
        headers: { Authorization: 'Zoho-oauthtoken ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(expenseBody),
      });
      const cd = await r.json();
      if (cd.code !== 0) {
        const msg = cd.message || 'Zoho create failed';
        await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, { status: 'error', error_msg: msg });
        return json({ ok: false, error: msg }, 400);
      }
      const zid = cd.expense?.expense_id;
      const att = await attachReceipt('expenses', zid, oid, token, exp);
      if (!att.attached) note.push('Allegato non caricato: ' + att.error);

      await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, {
        status: 'posted', zoho_doc_type: 'expense', zoho_expense_id: zid,
        tax_applied: false, is_billable: isBillable && !!customerId,
        zoho_customer_id: customerId, zoho_customer_name: customerName,
        error_msg: null, post_notes: note.join(' · ') || null,
        approved_at: new Date().toISOString(),
      });
      return json({ ok: true, doc_type: 'expense', zoho_expense_id: zid, attached: att.attached,
                    tax_applied: false, notes: note });
    }

    // Segna pagata una Bill gia' registrata, senza rifare la registrazione.
    // Serve in due casi: le fatture messe su Zoho prima che il pagamento
    // fosse automatico, e quelle lasciate da pagare perche' il "pagato con"
    // del cliente non corrispondeva a nessun conto. In entrambi disfare e
    // rifare la registrazione cambierebbe il numero del documento e
    // ricaricherebbe l'allegato: troppo per una cosa che e' solo un pagamento
    // mancante.
    if (action === 'mark_bill_paid' && body.expense_id) {
      const rows = await sbGet('/rest/v1/client_expenses?id=eq.' + body.expense_id + '&select=*');
      const exp = rows?.[0];
      if (!exp) return json({ ok: false, error: 'expense not found' }, 404);
      if (exp.zoho_doc_type !== 'bill' || !exp.zoho_bill_id) {
        return json({ ok: false, error: 'Questa spesa non e' + String.fromCharCode(39)
          + ' una fattura registrata su Zoho' }, 400);
      }
      const oid = exp.zoho_org_id;

      const rb = await fetch(ZOHO_API_BASE + '/bills/' + exp.zoho_bill_id + '?organization_id=' + oid, {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const db = await rb.json();
      if (db.code !== 0) return json({ ok: false, error: db.message || 'fattura non trovata' }, 404);
      const saldo = Number(db.bill?.balance ?? 0);
      if (saldo <= 0) return json({ ok: true, already_paid: true, bill_id: String(exp.zoho_bill_id) });

      const acct = body.paid_through_account_id
        ? { id: String(body.paid_through_account_id), name: 'conto scelto' }
        : await resolvePaymentAccount(oid, token, exp.paid_with, exp.currency);
      if (!acct) {
        return json({ ok: false, error: 'Conto di pagamento non riconosciuto da "'
          + (exp.paid_with || '—') + '": scegline uno.' }, 400);
      }

      const pay = await payBill(oid, token, String(exp.zoho_bill_id), exp.zoho_vendor_id, exp, acct, saldo);
      if (!pay.ok) return json({ ok: false, error: pay.error }, 400);
      await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, { zoho_payment_id: pay.id });
      return json({ ok: true, bill_id: String(exp.zoho_bill_id), payment_id: pay.id, account: acct.name, amount: saldo });
    }

    // Cancella un pagamento registrato da noi. Solo i nostri: quelli messi a
    // mano dalla contabilita' si annullano in Zoho, non da qui.
    if (action === 'delete_vendor_payment' && body.org_id && body.payment_id) {
      const rg = await fetch(ZOHO_API_BASE + '/vendorpayments/' + body.payment_id
        + '?organization_id=' + body.org_id, {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const dg = await rg.json();
      const descr = String(dg.vendorpayment?.description || '');
      if (dg.code !== 0) return json({ ok: false, error: dg.message || 'pagamento non trovato' }, 404);
      if (!descr.startsWith(PAY_MARKER)) {
        return json({ ok: false, error: 'Pagamento non registrato dal portale: annullalo in Zoho.' }, 400);
      }
      const r = await fetch(ZOHO_API_BASE + '/vendorpayments/' + body.payment_id
        + '?organization_id=' + body.org_id, {
        method: 'DELETE', headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      if (d.code !== 0) return json({ ok: false, error: d.message || 'errore' }, 400);
      return json({ ok: true, deleted: String(body.payment_id) });
    }

    // Annulla una registrazione sbagliata: cancella il documento su Zoho e
    // riporta la spesa in attesa, cosi' si puo' ri-approvare corretta.
    if (action === 'undo_posting' && body.expense_id) {
      const rows = await sbGet('/rest/v1/client_expenses?id=eq.' + body.expense_id + '&select=*');
      const exp = rows?.[0];
      if (!exp) return json({ ok: false, error: 'expense not found' }, 404);
      const kind = exp.zoho_doc_type === 'bill' ? 'bills' : 'expenses';
      const zid = exp.zoho_doc_type === 'bill' ? exp.zoho_bill_id : exp.zoho_expense_id;
      if (!zid) return json({ ok: false, error: 'nessun documento Zoho da annullare' }, 400);
      // Prima il pagamento, poi il documento: Zoho rifiuta di cancellare una
      // Bill con pagamenti applicati. E se restasse, sarebbe un acconto al
      // fornitore di cui nessuno saprebbe l'origine.
      const payDeleted: string[] = [];
      if (exp.zoho_doc_type === 'bill') {
        const { nostri, altrui } = await paymentsOfBill(
          exp.zoho_org_id, token, zid, exp.zoho_payment_id || null);
        if (altrui.length) {
          return json({ ok: false, error: 'Sulla fattura c' + String.fromCharCode(39)
            + 'e' + String.fromCharCode(39) + ' un pagamento registrato a mano: '
            + 'annullalo in Zoho prima di disfare la registrazione.' }, 400);
        }
        for (const pid of nostri) {
          const rp = await fetch(ZOHO_API_BASE + '/vendorpayments/' + pid
            + '?organization_id=' + exp.zoho_org_id, {
            method: 'DELETE', headers: { Authorization: 'Zoho-oauthtoken ' + token },
          });
          const dp = await rp.json();
          if (dp.code !== 0) {
            return json({ ok: false, error: 'Pagamento non annullato: ' + (dp.message || 'errore') }, 400);
          }
          payDeleted.push(pid);
        }
      }

      const r = await fetch(ZOHO_API_BASE + '/' + kind + '/' + zid + '?organization_id=' + exp.zoho_org_id, {
        method: 'DELETE', headers: { Authorization: 'Zoho-oauthtoken ' + token },
      });
      const d = await r.json();
      if (d.code !== 0) return json({ ok: false, error: d.message || 'Zoho delete failed' }, 400);

      await sbPatch('/rest/v1/client_expenses?id=eq.' + body.expense_id, {
        status: 'pending', zoho_expense_id: null, zoho_bill_id: null, zoho_doc_type: null,
        zoho_payment_id: null,
        tax_applied: null, post_notes: null, error_msg: null, approved_at: null,
      });
      return json({ ok: true, deleted: zid, payments_deleted: payDeleted });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
});
