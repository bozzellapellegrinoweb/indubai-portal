/**
 * MCP server — tool di dominio.
 *
 * Ogni tool dichiara il dominio (e quindi le pagine del portale) che lo
 * governa: la visibilita' la decide _mcp-catalog.js in base al ruolo.
 * I tool con write: true richiedono un token abilitato alla scrittura.
 */

import {
  sbSelect, sbSelectOne, sbInsert, sbUpdate,
  badRequest, clampLimit, requireArg, requireUuid, isUuid, currentYearMonth, likeTerm,
} from './_mcp-lib.js';
import { domainVisible, scopeIncludes } from './_mcp-catalog.js';

// ── Helpers condivisi ───────────────────────────────────────────────────────

const ymProps = {
  year:  { type: 'integer', description: 'Anno; default: anno corrente' },
  month: { type: 'integer', description: 'Mese 1-12; default: mese corrente' },
};

function ym(args) {
  const cur = currentYearMonth();
  const year = args?.year ? Number(args.year) : cur.year;
  const month = args?.month ? Number(args.month) : cur.month;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Anno non valido');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('Mese non valido');
  return { year, month };
}

/** Risolve un cliente da UUID oppure da parte della ragione sociale. */
async function resolveClient(args, { field = 'client', required = true } = {}) {
  const raw = args?.client_id || args?.[field];
  if (!raw) {
    if (required) throw badRequest(`Indica il cliente con "${field}" (nome o UUID)`);
    return null;
  }
  if (isUuid(raw)) {
    const row = await sbSelectOne('clients', { select: '*', filters: { id: raw } });
    if (!row) throw badRequest(`Nessun cliente con id ${raw}`);
    return row;
  }
  const term = likeTerm(raw);
  const rows = await sbSelect('clients', {
    select: 'id,company_name,contact_name,email,is_active',
    or: `company_name.ilike.*${term}*,contact_name.ilike.*${term}*,email.ilike.*${term}*`,
    limit: 6,
  });
  if (!rows?.length) throw badRequest(`Nessun cliente trovato per "${raw}"`);
  if (rows.length > 1) {
    throw badRequest(
      `"${raw}" corrisponde a piu\' clienti, passa il client_id: `
      + rows.map(r => `${r.company_name} (${r.id})`).join(' | '),
    );
  }
  return sbSelectOne('clients', { select: '*', filters: { id: rows[0].id } });
}

/** Risolve un membro dello staff: "me", UUID o parte del nome. */
async function resolveProfile(value, ctx) {
  if (!value) return null;
  if (value === 'me' || value === 'io') return { id: ctx.profile.id, full_name: ctx.profile.full_name };
  if (isUuid(value)) {
    return sbSelectOne('profiles', { select: 'id,full_name,role', filters: { id: value } });
  }
  const rows = await sbSelect('profiles', {
    select: 'id,full_name,role',
    filters: { full_name: { op: 'ilike', value: `*${likeTerm(value)}*` } },
    limit: 5,
  });
  if (!rows?.length) throw badRequest(`Nessun utente trovato per "${value}"`);
  if (rows.length > 1) {
    throw badRequest(`"${value}" corrisponde a: ${rows.map(r => `${r.full_name} (${r.id})`).join(' | ')}`);
  }
  return rows[0];
}

/** Scrive nell'activity log del portale, cosi' le azioni via MCP sono tracciate anche lato UI. */
async function logActivity(ctx, action, { clientId = null, details = null } = {}) {
  try {
    await sbInsert('activity_log', [{
      user_id: ctx.profile.id,
      client_id: clientId,
      action,
      details: { via: 'mcp', scope: ctx.scope, ...(details || {}) },
    }]);
  } catch (e) {
    console.error('[mcp] activity_log:', e?.message || e);
  }
}

const one = rows => (Array.isArray(rows) ? rows[0] : rows);

// ── CLIENTI ─────────────────────────────────────────────────────────────────

const clientTools = [
  {
    name: 'clients_search',
    domain: 'clients',
    title: 'Cerca clienti',
    description:
      'Cerca clienti per ragione sociale, referente, email o telefono, con filtri su stato, '
      + 'partner contabile, VAT, referente interno.',
    inputSchema: {
      type: 'object',
      properties: {
        query:              { type: 'string', description: 'Testo libero su nome/referente/email/telefono' },
        is_active:          { type: 'boolean' },
        in_bilancio:        { type: 'boolean' },
        vat_registered:     { type: 'boolean' },
        accounting_partner: { type: 'string', description: 'noi | vat_consultant | affinitas | in_sospeso | altro' },
        assigned_to:        { type: 'string', description: '"me", UUID o nome di un membro dello staff' },
        limit:              { type: 'integer', description: 'Default 50' },
      },
    },
    handler: async (args, ctx) => {
      const filters = {};
      for (const k of ['is_active', 'in_bilancio', 'vat_registered', 'accounting_partner']) {
        if (args?.[k] !== undefined) filters[k] = args[k];
      }
      if (args?.assigned_to) {
        const p = await resolveProfile(args.assigned_to, ctx);
        filters.assigned_to = p.id;
      }
      let or;
      if (args?.query) {
        const t = likeTerm(args.query);
        or = `company_name.ilike.*${t}*,contact_name.ilike.*${t}*,email.ilike.*${t}*,phone_uae.ilike.*${t}*`;
      }
      const rows = await sbSelect('clients', {
        select: 'id,company_name,contact_name,email,phone_uae,service_cost,subscription_day,'
              + 'accounting_partner,vat_registered,vat_partner,corporate_tax_registered,'
              + 'is_active,in_bilancio,source,assigned_to,created_at',
        filters, or, order: 'company_name.asc',
        limit: clampLimit(args?.limit, 50, 300),
      });
      return { trovati: rows?.length ?? 0, clienti: rows };
    },
  },

  {
    name: 'client_get',
    domain: 'clients',
    title: 'Scheda cliente completa',
    description:
      'Vista 360° di un cliente: anagrafica, onboarding, VAT, Corporate Tax, estratti conto e '
      + 'pagamenti recenti, task aperti, spese, documenti, snapshot Zoho, ambassador di provenienza. '
      + 'Le sezioni che il ruolo non puo\' vedere vengono omesse.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string', description: 'Nome o UUID del cliente' },
        client_id: { type: 'string', description: 'UUID del cliente' },
        months:    { type: 'integer', description: 'Quanti mesi di storico (default 6)' },
      },
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const months = clampLimit(args?.months, 6, 36);
      const can = d => domainVisible(ctx, d) && scopeIncludes(ctx, d);
      const out = { cliente: client };

      const jobs = [];
      if (can('onboarding')) {
        jobs.push(sbSelect('onboarding_checklist', { select: '*', filters: { client_id: client.id } })
          .then(r => { out.onboarding = one(r) || null; }));
      }
      if (can('vat')) {
        jobs.push(sbSelect('vat_register', { select: '*', filters: { client_id: client.id } })
          .then(r => { out.vat = one(r) || null; }));
      }
      if (can('corptax')) {
        jobs.push(sbSelect('corporate_tax', { select: '*', filters: { client_id: client.id }, order: 'created_at.desc', limit: 12 })
          .then(r => { out.corporate_tax = r; }));
      }
      if (can('statements')) {
        jobs.push(sbSelect('bank_statements', { select: '*', filters: { client_id: client.id }, order: 'year.desc,month.desc', limit: months })
          .then(r => { out.estratti_conto = r; }));
      }
      if (can('payments')) {
        jobs.push(sbSelect('subscription_payments', { select: '*', filters: { client_id: client.id }, order: 'year.desc,month.desc', limit: months })
          .then(r => { out.pagamenti = r; }));
      }
      if (can('bilanci')) {
        jobs.push(sbSelect('monthly_balance', { select: '*', filters: { client_id: client.id }, order: 'year.desc,month.desc', limit: months })
          .then(r => { out.bilanci = r; }));
      }
      if (can('tasks')) {
        jobs.push(sbSelect('tasks', {
          select: 'id,title,status,priority,due_date,assigned_to,category',
          filters: { client_id: client.id, status: { op: 'in', value: ['open', 'in_progress'] } },
          order: 'due_date.asc', limit: 20,
        }).then(r => { out.task_aperti = r; }));
      }
      if (can('expenses')) {
        jobs.push(sbSelect('client_expenses', {
          select: 'id,vendor,expense_date,amount,currency,status,category_name',
          filters: { client_id: client.id }, order: 'expense_date.desc', limit: 20,
        }).then(r => { out.spese = r; }));
      }
      if (can('documents')) {
        jobs.push(sbSelect('client_files', {
          select: 'id,display_name,folder,mime_type,file_size,created_at',
          filters: { client_id: client.id }, order: 'created_at.desc', limit: 50,
        }).then(r => { out.documenti = r; }));
      }
      if (can('clients')) {
        jobs.push(sbSelect('zoho_snapshots', { select: '*', filters: { client_id: client.id } })
          .then(r => { out.zoho = one(r) || null; }).catch(() => {}));
      }
      if (client.ambassador_id && can('ambassador')) {
        jobs.push(sbSelect('ambassadors', { select: 'id,full_name,ref_code,status', filters: { id: client.ambassador_id } })
          .then(r => { out.ambassador = one(r) || null; }));
      }
      await Promise.all(jobs);
      return out;
    },
  },

  {
    name: 'client_create',
    domain: 'clients',
    write: true,
    title: 'Crea cliente',
    description:
      'Crea un nuovo cliente. La checklist di onboarding viene generata automaticamente dal '
      + 'trigger del database. Per creare anche l\'accesso al portale cliente usa l\'area Clienti.',
    inputSchema: {
      type: 'object',
      properties: {
        company_name:       { type: 'string' },
        contact_name:       { type: 'string' },
        email:              { type: 'string' },
        phone_uae:          { type: 'string' },
        service_cost:       { type: 'number', description: 'Costo abbonamento in AED' },
        subscription_day:   { type: 'integer', description: 'Giorno del mese di addebito (1-31)' },
        start_date:         { type: 'string', description: 'YYYY-MM-DD' },
        accounting_partner: { type: 'string' },
        source:             { type: 'string', description: 'pellegrino | giuseppe' },
        assigned_to:        { type: 'string', description: '"me", UUID o nome' },
        vat_registered:     { type: 'boolean' },
        in_bilancio:        { type: 'boolean' },
        notes:              { type: 'string' },
      },
      required: ['company_name'],
    },
    handler: async (args, ctx) => {
      const row = {};
      for (const k of ['company_name', 'contact_name', 'email', 'phone_uae', 'service_cost',
        'subscription_day', 'start_date', 'accounting_partner', 'source', 'vat_registered',
        'in_bilancio', 'notes']) {
        if (args?.[k] !== undefined) row[k] = args[k];
      }
      requireArg(row, 'company_name');
      if (args?.assigned_to) row.assigned_to = (await resolveProfile(args.assigned_to, ctx)).id;
      const created = one(await sbInsert('clients', [row]));
      await logActivity(ctx, 'client_created', { clientId: created.id, details: { company_name: created.company_name } });
      return { creato: created, _rows: 1 };
    },
  },

  {
    name: 'client_update',
    domain: 'clients',
    write: true,
    title: 'Aggiorna cliente',
    description: 'Modifica i campi di un cliente esistente.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string', description: 'Nome o UUID' },
        client_id: { type: 'string' },
        patch:     { type: 'object', description: 'Campi da aggiornare', additionalProperties: true },
      },
      required: ['patch'],
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const patch = args?.patch;
      if (!patch || !Object.keys(patch).length) throw badRequest('Patch vuota');
      if ('id' in patch) throw badRequest('L\'id non si puo\' modificare');
      const out = one(await sbUpdate('clients', { id: client.id }, patch));
      await logActivity(ctx, 'client_updated', { clientId: client.id, details: { campi: Object.keys(patch) } });
      return { aggiornato: out, _rows: 1 };
    },
  },

  {
    name: 'client_timeline',
    domain: 'clients',
    title: 'Cronologia cliente',
    description: 'Ultime attivita\' registrate su un cliente: audit log, task, email inviate.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        limit:     { type: 'integer', description: 'Default 40' },
      },
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const limit = clampLimit(args?.limit, 40, 200);
      const [log, tasks] = await Promise.all([
        sbSelect('activity_log', {
          select: 'created_at,action,details,user:profiles(full_name)',
          filters: { client_id: client.id }, order: 'created_at.desc', limit,
        }),
        domainVisible(ctx, 'tasks')
          ? sbSelect('tasks', {
            select: 'created_at,title,status,completed_at',
            filters: { client_id: client.id }, order: 'created_at.desc', limit: 20,
          })
          : [],
      ]);
      return { cliente: client.company_name, attivita: log, task: tasks };
    },
  },
];

// ── ONBOARDING ──────────────────────────────────────────────────────────────

const ONBOARDING_STEPS = ['whatsapp_group', 'call_scheduled', 'docs_in_drive', 'eid_verified',
  'uae_phone_verified', 'corporate_tax_check', 'fta_profile_created', 'ct_registration_done',
  'payment_link_sent', 'bank_accounts_noted'];

const onboardingTools = [
  {
    name: 'onboarding_status',
    domain: 'onboarding',
    title: 'Stato onboarding',
    description:
      'Checklist di onboarding dei clienti, con percentuale di completamento e passi mancanti. '
      + 'Di default mostra solo gli onboarding non completati.',
    inputSchema: {
      type: 'object',
      properties: {
        client:         { type: 'string', description: 'Nome o UUID per un singolo cliente' },
        only_open:      { type: 'boolean', description: 'Default true: solo i non completati' },
        limit:          { type: 'integer', description: 'Default 50' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.client) filters.client_id = (await resolveClient(args)).id;
      else if (args?.only_open !== false) filters.completed_at = null;
      const rows = await sbSelect('onboarding_checklist', {
        select: '*,client:clients(id,company_name,is_active)',
        filters, order: 'created_at.desc',
        limit: clampLimit(args?.limit, 50, 300),
      });
      return (rows || []).map(r => {
        const done = ONBOARDING_STEPS.filter(s => r[s]);
        return {
          client_id: r.client_id,
          cliente: r.client?.company_name,
          completato_il: r.completed_at,
          percentuale: Math.round((done.length / ONBOARDING_STEPS.length) * 100),
          mancanti: ONBOARDING_STEPS.filter(s => !r[s]),
          note: r.notes,
        };
      });
    },
  },

  {
    name: 'onboarding_set',
    domain: 'onboarding',
    write: true,
    title: 'Aggiorna onboarding',
    description:
      'Spunta o rimuove passi della checklist di onboarding. Passi validi: '
      + ONBOARDING_STEPS.join(', ') + '. Con completed: true segna l\'onboarding come chiuso.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        steps:     { type: 'object', description: 'Es. { "docs_in_drive": true }', additionalProperties: true },
        call_date: { type: 'string', description: 'YYYY-MM-DD' },
        notes:     { type: 'string' },
        completed: { type: 'boolean' },
      },
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const patch = {};
      for (const [k, v] of Object.entries(args?.steps || {})) {
        if (!ONBOARDING_STEPS.includes(k)) throw badRequest(`Passo non valido: ${k}`);
        patch[k] = !!v;
      }
      if (args?.call_date) patch.call_date = args.call_date;
      if (args?.notes !== undefined) patch.notes = args.notes;
      if (args?.completed !== undefined) patch.completed_at = args.completed ? new Date().toISOString() : null;
      if (!Object.keys(patch).length) throw badRequest('Niente da aggiornare');
      const out = one(await sbInsert('onboarding_checklist', [{ client_id: client.id, ...patch }], { upsertOn: 'client_id' }));
      await logActivity(ctx, 'onboarding_updated', { clientId: client.id, details: patch });
      return { cliente: client.company_name, onboarding: out, _rows: 1 };
    },
  },
];

// ── ESTRATTI CONTO / ABBONAMENTI / BILANCI ──────────────────────────────────

const monthlyTools = [
  {
    name: 'statements_month',
    domain: 'statements',
    title: 'Estratti conto del mese',
    description:
      'Stato degli estratti conto per un mese: ricevuti, registrati, mancanti. '
      + 'Considera solo i clienti attivi in bilancio.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ymProps,
        stato: { type: 'string', description: 'tutti | mancanti | da_registrare | completi (default tutti)' },
        limit: { type: 'integer' },
      },
    },
    handler: async (args) => {
      const { year, month } = ym(args);
      const clients = await sbSelect('clients', {
        select: 'id,company_name,bank_accounts',
        filters: { is_active: true, in_bilancio: true },
        order: 'company_name.asc', limit: 500,
      });
      const stmts = await sbSelect('bank_statements', {
        select: 'client_id,received,registered,notes',
        filters: { year, month }, limit: 1000,
      });
      const byClient = new Map((stmts || []).map(s => [s.client_id, s]));
      let rows = (clients || []).map(c => {
        const s = byClient.get(c.id) || {};
        return {
          client_id: c.id,
          cliente: c.company_name,
          conti: c.bank_accounts,
          ricevuto: !!s.received,
          registrato: !!s.registered,
          note: s.notes || null,
        };
      });
      const stato = args?.stato || 'tutti';
      if (stato === 'mancanti') rows = rows.filter(r => !r.ricevuto);
      else if (stato === 'da_registrare') rows = rows.filter(r => r.ricevuto && !r.registrato);
      else if (stato === 'completi') rows = rows.filter(r => r.ricevuto && r.registrato);
      return {
        periodo: `${month}/${year}`,
        totale_clienti: clients?.length ?? 0,
        ricevuti: rows.filter(r => r.ricevuto).length,
        registrati: rows.filter(r => r.registrato).length,
        righe: rows.slice(0, clampLimit(args?.limit, 300, 500)),
      };
    },
  },

  {
    name: 'statement_set',
    domain: 'statements',
    write: true,
    title: 'Segna estratto conto',
    description: 'Imposta ricevuto/registrato (e note) per l\'estratto conto di un cliente in un mese.',
    inputSchema: {
      type: 'object',
      properties: {
        client:     { type: 'string' },
        client_id:  { type: 'string' },
        ...ymProps,
        received:   { type: 'boolean' },
        registered: { type: 'boolean' },
        notes:      { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const { year, month } = ym(args);
      const row = { client_id: client.id, year, month };
      if (args?.received !== undefined) row.received = !!args.received;
      if (args?.registered !== undefined) row.registered = !!args.registered;
      if (args?.notes !== undefined) row.notes = args.notes;
      const out = one(await sbInsert('bank_statements', [row], { upsertOn: 'client_id,year,month' }));
      await logActivity(ctx, 'statement_set', { clientId: client.id, details: { year, month, ...row } });
      return { cliente: client.company_name, estratto: out, _rows: 1 };
    },
  },

  {
    name: 'payments_month',
    domain: 'payments',
    title: 'Abbonamenti del mese',
    description:
      'Stato dei pagamenti di abbonamento per un mese, con totale incassato e clienti in sospeso.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ymProps,
        status: { type: 'string', description: 'ok | failed | no_tentativo | pending | manual | annual' },
        limit:  { type: 'integer' },
      },
    },
    handler: async (args) => {
      const { year, month } = ym(args);
      const filters = { year, month };
      if (args?.status) filters.status = args.status;
      const rows = await sbSelect('subscription_payments', {
        select: '*,client:clients(id,company_name,service_cost,subscription_day,is_active)',
        filters, order: 'status.asc',
        limit: clampLimit(args?.limit, 300, 500),
      });
      const incassato = (rows || [])
        .filter(r => r.status === 'ok' || r.status === 'manual' || r.status === 'annual')
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      const perStato = {};
      for (const r of rows || []) perStato[r.status] = (perStato[r.status] || 0) + 1;
      return {
        periodo: `${month}/${year}`,
        per_stato: perStato,
        incassato_aed: Math.round(incassato * 100) / 100,
        righe: (rows || []).map(r => ({
          client_id: r.client_id,
          cliente: r.client?.company_name,
          stato: r.status,
          importo: r.amount,
          costo_servizio: r.client?.service_cost,
          giorno_addebito: r.client?.subscription_day,
          note: r.notes,
        })),
      };
    },
  },

  {
    name: 'payment_set',
    domain: 'payments',
    write: true,
    title: 'Segna pagamento abbonamento',
    description: 'Imposta stato, importo e note del pagamento di abbonamento di un cliente per un mese.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        ...ymProps,
        status:    { type: 'string', description: 'ok | failed | no_tentativo | pending | manual | annual' },
        amount:    { type: 'number' },
        notes:     { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const { year, month } = ym(args);
      const VALID = ['ok', 'failed', 'no_tentativo', 'pending', 'manual', 'annual'];
      const row = { client_id: client.id, year, month };
      if (args?.status) {
        if (!VALID.includes(args.status)) throw badRequest(`Stato non valido. Ammessi: ${VALID.join(', ')}`);
        row.status = args.status;
      }
      if (args?.amount !== undefined) row.amount = args.amount;
      if (args?.notes !== undefined) row.notes = args.notes;
      const out = one(await sbInsert('subscription_payments', [row], { upsertOn: 'client_id,year,month' }));
      await logActivity(ctx, 'payment_set', { clientId: client.id, details: { year, month, ...row } });
      return { cliente: client.company_name, pagamento: out, _rows: 1 };
    },
  },

  {
    name: 'balance_month',
    domain: 'bilanci',
    title: 'Bilancio mensile',
    description: 'Righe di bilancio mensile per cliente: estratti ricevuti, pagato a noi, pagato al VAT.',
    inputSchema: { type: 'object', properties: { ...ymProps, limit: { type: 'integer' } } },
    handler: async (args) => {
      const { year, month } = ym(args);
      const rows = await sbSelect('monthly_balance', {
        select: '*,client:clients(company_name,in_bilancio)',
        filters: { year, month }, limit: clampLimit(args?.limit, 300, 500),
      });
      const tot = (rows || []).reduce((acc, r) => ({
        noi: acc.noi + Number(r.paid_to_us || 0),
        vat: acc.vat + Number(r.paid_to_vat || 0),
      }), { noi: 0, vat: 0 });
      return { periodo: `${month}/${year}`, totale_a_noi_aed: tot.noi, totale_a_vat_aed: tot.vat, righe: rows };
    },
  },

  {
    name: 'balance_set',
    domain: 'bilanci',
    write: true,
    title: 'Aggiorna bilancio mensile',
    description: 'Imposta gli importi di bilancio mensile di un cliente.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        ...ymProps,
        bank_statements_received: { type: 'boolean' },
        paid_to_us:  { type: 'number' },
        paid_to_vat: { type: 'number' },
        notes:       { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const { year, month } = ym(args);
      const row = { client_id: client.id, year, month };
      for (const k of ['bank_statements_received', 'paid_to_us', 'paid_to_vat', 'notes']) {
        if (args?.[k] !== undefined) row[k] = args[k];
      }
      const out = one(await sbInsert('monthly_balance', [row], { upsertOn: 'client_id,year,month' }));
      await logActivity(ctx, 'balance_set', { clientId: client.id, details: { year, month } });
      return { cliente: client.company_name, bilancio: out, _rows: 1 };
    },
  },
];

// ── VAT / CORPORATE TAX ─────────────────────────────────────────────────────

const complianceTools = [
  {
    name: 'vat_deadlines',
    domain: 'vat',
    title: 'Scadenze VAT',
    description:
      'Scadenze dei VAT return nei prossimi N giorni (default 30), ordinate per data. '
      + 'Include il partner contabile e i pagamenti registrati.',
    inputSchema: {
      type: 'object',
      properties: {
        days:     { type: 'integer', description: 'Finestra in giorni, default 30' },
        overdue:  { type: 'boolean', description: 'true: include anche le scadenze passate' },
      },
    },
    handler: async (args) => {
      const days = clampLimit(args?.days, 30, 365);
      const today = new Date();
      const from = args?.overdue
        ? new Date(today.getTime() - 365 * 86400000)
        : today;
      const to = new Date(today.getTime() + days * 86400000);
      const iso = d => d.toISOString().slice(0, 10);
      const rows = await sbSelect('vat_register', {
        select: '*,client:clients(id,company_name,is_active,vat_registered)',
        limit: 500,
      });
      const out = [];
      for (const r of rows || []) {
        if (r.client && r.client.is_active === false) continue;
        for (const n of [1, 2, 3, 4]) {
          const d = r[`return_deadline_${n}`];
          if (!d) continue;
          if (d >= iso(from) && d <= iso(to)) {
            out.push({
              client_id: r.client_id,
              cliente: r.client?.company_name,
              scadenza: d,
              giorni_residui: Math.round((new Date(d) - today) / 86400000),
              numero: n,
              partner: r.accounting_partner,
              pagamento_studio: r.payment_to_studio,
              pagamento_vat: r.payment_vat,
              note: r.notes,
            });
          }
        }
      }
      out.sort((a, b) => a.scadenza.localeCompare(b.scadenza));
      return { finestra_giorni: days, scadenze: out.length, dati: out };
    },
  },

  {
    name: 'vat_set',
    domain: 'vat',
    write: true,
    title: 'Aggiorna VAT register',
    description: 'Crea o aggiorna la riga VAT di un cliente: date di domanda/approvazione, scadenze, pagamenti.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        patch:     { type: 'object', description: 'Campi di vat_register da impostare', additionalProperties: true },
      },
      required: ['patch'],
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const ALLOWED = ['accounting_partner', 'application_date', 'approval_date', 'return_deadline_1',
        'return_deadline_2', 'return_deadline_3', 'return_deadline_4', 'payment_to_studio',
        'payment_vat', 'notes'];
      const patch = {};
      for (const [k, v] of Object.entries(args?.patch || {})) {
        if (!ALLOWED.includes(k)) throw badRequest(`Campo non modificabile: ${k}. Ammessi: ${ALLOWED.join(', ')}`);
        patch[k] = v;
      }
      if (!Object.keys(patch).length) throw badRequest('Patch vuota');
      const out = one(await sbInsert('vat_register', [{ client_id: client.id, ...patch }], { upsertOn: 'client_id' }));
      await logActivity(ctx, 'vat_set', { clientId: client.id, details: patch });
      return { cliente: client.company_name, vat: out, _rows: 1 };
    },
  },

  {
    name: 'corptax_list',
    domain: 'corptax',
    title: 'Corporate Tax',
    description: 'Registrazioni Corporate Tax dei clienti, con scadenze e stato della domanda.',
    inputSchema: {
      type: 'object',
      properties: {
        client:      { type: 'string' },
        month_group: { type: 'string', description: 'Raggruppamento mensile, es. "GENNAIO"' },
        pending:     { type: 'boolean', description: 'true: solo senza data di approvazione' },
        limit:       { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.client) filters.client_id = (await resolveClient(args)).id;
      if (args?.month_group) filters.month_group = args.month_group;
      if (args?.pending) filters.approval_date = null;
      const rows = await sbSelect('corporate_tax', {
        select: '*,client:clients(id,company_name,corporate_tax_registered,corporate_tax_expiry,trade_license_date)',
        filters, order: 'created_at.desc', limit: clampLimit(args?.limit, 100, 500),
      });
      return { righe: rows?.length ?? 0, dati: rows };
    },
  },

  {
    name: 'corptax_set',
    domain: 'corptax',
    write: true,
    title: 'Aggiorna Corporate Tax',
    description:
      'Crea una registrazione Corporate Tax per un cliente, oppure aggiorna quella indicata con record_id.',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        record_id: { type: 'string', description: 'UUID della riga da aggiornare (opzionale)' },
        patch:     { type: 'object', additionalProperties: true },
      },
      required: ['patch'],
    },
    handler: async (args, ctx) => {
      const ALLOWED = ['deadline', 'application_submitted', 'approval_date', 'month_group', 'notes'];
      const patch = {};
      for (const [k, v] of Object.entries(args?.patch || {})) {
        if (!ALLOWED.includes(k)) throw badRequest(`Campo non modificabile: ${k}. Ammessi: ${ALLOWED.join(', ')}`);
        patch[k] = v;
      }
      if (!Object.keys(patch).length) throw badRequest('Patch vuota');
      if (args?.record_id) {
        const out = one(await sbUpdate('corporate_tax', { id: requireUuid(args, 'record_id') }, patch));
        if (!out) throw badRequest(`Nessuna riga corporate_tax con id ${args.record_id}`);
        await logActivity(ctx, 'corptax_updated', { clientId: out.client_id, details: patch });
        return { corporate_tax: out, _rows: 1 };
      }
      const client = await resolveClient(args);
      const out = one(await sbInsert('corporate_tax', [{ client_id: client.id, ...patch }]));
      await logActivity(ctx, 'corptax_created', { clientId: client.id, details: patch });
      return { cliente: client.company_name, corporate_tax: out, _rows: 1 };
    },
  },
];

export const bizToolsPart1 = [
  ...clientTools, ...onboardingTools, ...monthlyTools, ...complianceTools,
];

export { resolveClient, resolveProfile, logActivity, one, ym, ymProps };
