/**
 * MCP server — tool di sessione e accesso dati generico.
 *
 * Questi tool sono la parte "vedi tutto / fai tutto": qualunque tabella del
 * portale che il ruolo puo' vedere e' interrogabile e (dove consentito)
 * modificabile, senza dover aggiungere un tool dedicato per ogni schermata.
 */

import {
  sbSelect, sbInsert, sbUpdate, sbDelete, sbRpc,
  badRequest, forbidden, clampLimit, requireArg,
} from './_mcp-lib.js';
import {
  TABLES, SCOPES, DOMAINS, domainsFor, tablesFor, domainVisible, scopeIncludes,
} from './_mcp-catalog.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Verifica che la tabella esista, sia nel perimetro della sessione e, se serve, sia scrivibile. */
function resolveTable(ctx, name, { write = false } = {}) {
  const table = String(requireArg({ table: name }, 'table'));
  const meta = TABLES[table];
  if (!meta) {
    throw badRequest(
      `Tabella "${table}" non esposta dall'MCP. Usa db_tables per l'elenco.`,
    );
  }
  if (!domainVisible(ctx, meta.domain) || !scopeIncludes(ctx, meta.domain)) {
    throw forbidden(
      `Il ruolo "${ctx.role}" (scope "${ctx.scope}") non ha accesso a "${table}" ` +
      `(dominio ${meta.domain}: ${DOMAINS[meta.domain]?.label}).`,
    );
  }
  if (write) {
    if (!meta.write) {
      throw forbidden(
        `"${table}" e' in sola lettura dai tool generici: usa il tool dedicato ` +
        `se devi modificarla (evita escalation di privilegi).`,
      );
    }
    if (meta.view) throw badRequest(`"${table}" e' una view: non e' scrivibile.`);
  }
  return { table, meta };
}

/** Rimuove dai risultati le colonne mai esposte (es. hash dei token). */
function stripHidden(meta, rows) {
  if (!meta.hideColumns?.length || !Array.isArray(rows)) return rows;
  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...row };
    for (const c of meta.hideColumns) delete copy[c];
    return copy;
  });
}

function assertNoHidden(meta, ...values) {
  for (const c of meta.hideColumns || []) {
    for (const v of values) {
      if (v && String(v).includes(c)) throw forbidden(`La colonna "${c}" non e' accessibile.`);
    }
  }
}

function assertSelect(select) {
  if (select === undefined || select === null) return '*';
  const s = String(select);
  // PostgREST accetta embed e alias: lasciamo passare solo caratteri innocui.
  if (!/^[a-zA-Z0-9_,.:()*\s!-]+$/.test(s)) {
    throw badRequest(`Parametro "select" non valido: ${s}`);
  }
  return s;
}

function assertOrder(order) {
  if (!order) return undefined;
  const s = String(order);
  if (!/^[a-zA-Z0-9_,.\s]+$/.test(s)) throw badRequest(`Parametro "order" non valido: ${s}`);
  return s;
}

const FILTERS_SCHEMA = {
  type: 'object',
  description:
    'Filtri colonna → valore. Valore semplice = uguaglianza; array = IN; null = IS NULL; '
    + 'oppure { "op": "gte|lte|gt|lt|neq|like|ilike|in|is|cs", "value": ... }. '
    + 'Esempio: { "is_active": true, "created_at": { "op": "gte", "value": "2026-01-01" } }',
  additionalProperties: true,
};

// ── Tool ────────────────────────────────────────────────────────────────────

export const dataTools = [
  // ── Sessione ──────────────────────────────────────────────────────────────
  {
    name: 'whoami',
    domain: 'core',
    title: 'Chi sono',
    description:
      'Identita\' della sessione MCP: utente del portale, ruolo, scope, se puo\' scrivere, '
      + 'quali aree del portale sono accessibili. Chiamalo per primo se non sai cosa puoi fare.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => ({
      utente: ctx.profile.full_name,
      profile_id: ctx.profile.id,
      ruolo: ctx.role,
      scope: ctx.scope,
      scope_descrizione: SCOPES[ctx.scope]?.label,
      sola_lettura: !ctx.canWrite,
      token: { nome: ctx.token.name, scade: ctx.token.expires_at, chiamate: ctx.token.calls_count },
      pagine_portale: ctx.pages === null ? 'tutte' : ctx.pages,
      domini_disponibili: domainsFor(ctx).map(d => `${d.name} — ${d.label}`),
      tool_disponibili: ctx.visibleToolNames,
    }),
  },

  {
    name: 'portal_map',
    domain: 'core',
    title: 'Mappa del portale',
    description:
      'Struttura del portale InDubai: aree funzionali, scope MCP disponibili e tabelle '
      + 'raggiungibili dalla sessione corrente. Utile per orientarsi prima di una ricerca.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => ({
      domini: domainsFor(ctx),
      scope_disponibili: Object.entries(SCOPES).map(([name, s]) => ({
        name, label: s.label, attivo: name === ctx.scope,
      })),
      tabelle_leggibili: tablesFor(ctx),
      tabelle_scrivibili: ctx.canWrite ? tablesFor(ctx, { write: true }) : [],
    }),
  },

  // ── Introspezione dati ────────────────────────────────────────────────────
  {
    name: 'db_tables',
    domain: 'data',
    title: 'Tabelle disponibili',
    description:
      'Elenco delle tabelle e view interrogabili dalla sessione, con dominio e se sono scrivibili.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const writable = new Set(ctx.canWrite ? tablesFor(ctx, { write: true }) : []);
      return tablesFor(ctx).map(name => ({
        tabella: name,
        dominio: TABLES[name].domain,
        tipo: TABLES[name].view ? 'view' : 'tabella',
        scrivibile: writable.has(name),
      }));
    },
  },

  {
    name: 'db_schema',
    domain: 'data',
    title: 'Schema delle tabelle',
    description:
      'Colonne, tipi e default delle tabelle accessibili. Senza argomenti restituisce solo '
      + 'i nomi di colonna per tabella; passando "table" restituisce il dettaglio completo.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Una tabella specifica (opzionale)' },
      },
    },
    handler: async (args, ctx) => {
      const names = args?.table
        ? [resolveTable(ctx, args.table).table]
        : tablesFor(ctx);
      if (!names.length) return { tabelle: [] };
      const safe = names.filter(n => /^[a-z0-9_]+$/.test(n));
      const list = safe.map(n => `'${n}'`).join(',');
      const rows = await sbRpc('mcp_readonly_query', {
        q: `select table_name, column_name, data_type, is_nullable, column_default
            from information_schema.columns
            where table_schema = 'public' and table_name in (${list})
            order by table_name, ordinal_position`,
        max_rows: 1000,
      });
      const byTable = {};
      for (const r of rows || []) {
        const meta = TABLES[r.table_name];
        if (meta?.hideColumns?.includes(r.column_name)) continue;
        (byTable[r.table_name] ||= []).push(
          args?.table
            ? {
              colonna: r.column_name,
              tipo: r.data_type,
              nullable: r.is_nullable === 'YES',
              default: r.column_default,
            }
            : r.column_name,
        );
      }
      return byTable;
    },
  },

  // ── Lettura ───────────────────────────────────────────────────────────────
  {
    name: 'db_select',
    domain: 'data',
    title: 'Query su una tabella',
    description:
      'Legge righe da una qualsiasi tabella o view accessibile, con filtri, ordinamento e '
      + 'paginazione. Supporta le relazioni PostgREST nel parametro select '
      + '(es. "id,company_name,tasks(title,status)").',
    inputSchema: {
      type: 'object',
      properties: {
        table:   { type: 'string', description: 'Nome tabella/view (vedi db_tables)' },
        select:  { type: 'string', description: 'Colonne, default "*". Supporta embed PostgREST.' },
        filters: FILTERS_SCHEMA,
        order:   { type: 'string', description: 'Es. "created_at.desc" o "company_name.asc"' },
        limit:   { type: 'integer', description: 'Default 50, massimo 500' },
        offset:  { type: 'integer' },
      },
      required: ['table'],
    },
    handler: async (args, ctx) => {
      const { table, meta } = resolveTable(ctx, args.table);
      const select = assertSelect(args.select);
      assertNoHidden(meta, select, args.order, JSON.stringify(args.filters || {}));
      const rows = await sbSelect(table, {
        select,
        filters: args.filters,
        order: assertOrder(args.order),
        limit: clampLimit(args.limit, 50, 500),
        offset: args.offset ? Number(args.offset) : undefined,
      });
      const clean = stripHidden(meta, rows);
      return { table, righe: clean?.length ?? 0, dati: clean };
    },
  },

  {
    name: 'db_count',
    domain: 'data',
    title: 'Conteggio righe',
    description: 'Quante righe soddisfano i filtri, senza scaricarle.',
    inputSchema: {
      type: 'object',
      properties: {
        table:   { type: 'string' },
        filters: FILTERS_SCHEMA,
      },
      required: ['table'],
    },
    handler: async (args, ctx) => {
      const { table } = resolveTable(ctx, args.table);
      // Con filtri passiamo da PostgREST, che li applica senza interpolazione.
      if (args.filters && Object.keys(args.filters).length) {
        const found = await sbSelect(table, { select: '*', filters: args.filters, limit: 10000 });
        const n = found?.length ?? 0;
        return { table, conteggio: n, ...(n === 10000 ? { nota: 'conteggio troncato a 10000' } : {}) };
      }
      // Senza filtri basta un count: il nome tabella viene dalla whitelist TABLES.
      const rows = await sbRpc('mcp_readonly_query', {
        q: `select count(*)::int as n from ${table}`,
        max_rows: 1,
      });
      return { table, conteggio: rows?.[0]?.n ?? null };
    },
  },

  {
    name: 'sql_query',
    domain: 'admin',
    adminOnly: true,
    title: 'Query SQL di sola lettura',
    description:
      'Esegue una SELECT (o WITH) arbitraria sul database del portale. Solo lettura: la '
      + 'transazione e\' read-only e le parole chiave di scrittura sono rifiutate. Gli schemi '
      + 'auth e vault non sono accessibili. Usalo per join, aggregazioni e analisi che i tool '
      + 'specifici non coprono.',
    inputSchema: {
      type: 'object',
      properties: {
        query:    { type: 'string', description: 'Una sola istruzione SELECT/WITH, senza ";"' },
        max_rows: { type: 'integer', description: 'Default 200, massimo 1000' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const q = String(requireArg(args, 'query'));
      const rows = await sbRpc('mcp_readonly_query', {
        q,
        max_rows: clampLimit(args.max_rows, 200, 1000),
      });
      return { righe: rows?.length ?? 0, dati: rows };
    },
  },

  // ── Scrittura ─────────────────────────────────────────────────────────────
  {
    name: 'db_insert',
    domain: 'data',
    write: true,
    title: 'Inserisci righe',
    description:
      'Inserisce una o piu\' righe. Con "upsert_on" aggiorna le righe in conflitto '
      + '(es. upsert_on: "client_id,year,month" su bank_statements).',
    inputSchema: {
      type: 'object',
      properties: {
        table:     { type: 'string' },
        rows:      { type: 'array', description: 'Massimo 50 righe per chiamata', items: { type: 'object' } },
        upsert_on: { type: 'string', description: 'Colonne del vincolo univoco, separate da virgola' },
      },
      required: ['table', 'rows'],
    },
    handler: async (args, ctx) => {
      const { table, meta } = resolveTable(ctx, args.table, { write: true });
      const rows = Array.isArray(args.rows) ? args.rows : [args.rows];
      if (!rows.length) throw badRequest('Nessuna riga da inserire');
      if (rows.length > 50) throw badRequest('Massimo 50 righe per chiamata');
      if (args.upsert_on && !/^[a-z0-9_,]+$/i.test(String(args.upsert_on))) {
        throw badRequest('upsert_on non valido');
      }
      const out = await sbInsert(table, rows, { upsertOn: args.upsert_on });
      return { table, inserite: out?.length ?? 0, dati: stripHidden(meta, out), _rows: out?.length ?? 0 };
    },
  },

  {
    name: 'db_update',
    domain: 'data',
    write: true,
    title: 'Aggiorna righe',
    description:
      'Applica una patch alle righe che soddisfano i filtri. I filtri sono obbligatori e, per '
      + 'sicurezza, la chiamata si rifiuta se toccherebbe piu\' di max_rows righe (default 50).',
    inputSchema: {
      type: 'object',
      properties: {
        table:    { type: 'string' },
        filters:  FILTERS_SCHEMA,
        patch:    { type: 'object', description: 'Colonne da aggiornare', additionalProperties: true },
        max_rows: { type: 'integer', description: 'Tetto di sicurezza, default 50, massimo 500' },
      },
      required: ['table', 'filters', 'patch'],
    },
    handler: async (args, ctx) => {
      const { table, meta } = resolveTable(ctx, args.table, { write: true });
      if (!args.filters || !Object.keys(args.filters).length) {
        throw badRequest('Servono dei filtri: un update senza filtri toccherebbe tutta la tabella');
      }
      if (!args.patch || !Object.keys(args.patch).length) throw badRequest('Patch vuota');
      const cap = clampLimit(args.max_rows, 50, 500);
      const target = await sbSelect(table, { select: '*', filters: args.filters, limit: cap + 1 });
      if ((target?.length ?? 0) > cap) {
        throw badRequest(
          `I filtri selezionano piu\' di ${cap} righe. Restringi i filtri o alza max_rows.`,
        );
      }
      if (!target?.length) return { table, aggiornate: 0, dati: [], _rows: 0 };
      const out = await sbUpdate(table, args.filters, args.patch);
      return { table, aggiornate: out?.length ?? 0, dati: stripHidden(meta, out), _rows: out?.length ?? 0 };
    },
  },

  {
    name: 'db_delete',
    domain: 'data',
    write: true,
    title: 'Elimina righe',
    description:
      'Elimina le righe che soddisfano i filtri. Richiede confirm: true e tocca al massimo '
      + 'max_rows righe (default 10). Operazione irreversibile.',
    inputSchema: {
      type: 'object',
      properties: {
        table:    { type: 'string' },
        filters:  FILTERS_SCHEMA,
        confirm:  { type: 'boolean', description: 'Deve essere true: conferma esplicita' },
        max_rows: { type: 'integer', description: 'Tetto di sicurezza, default 10, massimo 100' },
      },
      required: ['table', 'filters', 'confirm'],
    },
    handler: async (args, ctx) => {
      const { table, meta } = resolveTable(ctx, args.table, { write: true });
      if (args.confirm !== true) {
        throw badRequest('Passa confirm: true per confermare l\'eliminazione');
      }
      if (!args.filters || !Object.keys(args.filters).length) throw badRequest('Servono dei filtri');
      const cap = clampLimit(args.max_rows, 10, 100);
      const target = await sbSelect(table, { select: '*', filters: args.filters, limit: cap + 1 });
      if ((target?.length ?? 0) > cap) {
        throw badRequest(`I filtri selezionano piu\' di ${cap} righe. Restringi o alza max_rows.`);
      }
      if (!target?.length) return { table, eliminate: 0, _rows: 0 };
      const out = await sbDelete(table, args.filters);
      return { table, eliminate: out?.length ?? 0, dati: stripHidden(meta, out), _rows: out?.length ?? 0 };
    },
  },
];

export { FILTERS_SCHEMA, resolveTable, assertSelect, assertOrder, stripHidden };
