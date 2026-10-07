/**
 * MCP server — registro dei tool, delle risorse e dei prompt.
 *
 * Mette insieme i tool generici (_mcp-tools-data.js) e quelli di dominio
 * (_mcp-tools-biz*.js), li filtra in base alla sessione e li espone nel
 * formato previsto dal protocollo MCP.
 */

import { badRequest, forbidden, sbSelect, sbRpc } from './_mcp-lib.js';
import { toolVisible, domainsFor, tablesFor, SCOPES, DOMAINS, TABLES, domainVisible, scopeIncludes }
  from './_mcp-catalog.js';
import { dataTools } from './_mcp-tools-data.js';
import { bizToolsPart1 } from './_mcp-tools-biz.js';
import { bizToolsPart2 } from './_mcp-tools-biz2.js';

export const ALL_TOOLS = [...dataTools, ...bizToolsPart1, ...bizToolsPart2];

const BY_NAME = new Map(ALL_TOOLS.map(t => [t.name, t]));

// Controllo di coerenza: nomi unici e dominio dichiarato.
for (const t of ALL_TOOLS) {
  if (!DOMAINS[t.domain]) throw new Error(`[mcp] tool ${t.name}: dominio sconosciuto "${t.domain}"`);
}
if (BY_NAME.size !== ALL_TOOLS.length) {
  const seen = new Set();
  const dup = ALL_TOOLS.map(t => t.name).filter(n => (seen.has(n) ? true : (seen.add(n), false)));
  throw new Error(`[mcp] nomi di tool duplicati: ${dup.join(', ')}`);
}

// ── Tool ────────────────────────────────────────────────────────────────────

/** I tool visibili alla sessione. */
export function visibleTools(ctx) {
  return ALL_TOOLS.filter(t => toolVisible(ctx, t));
}

/** Descrittori nel formato tools/list. */
export function describeTools(ctx) {
  return visibleTools(ctx).map(t => ({
    name: t.name,
    title: t.title,
    description:
      `[${DOMAINS[t.domain].label}${t.write ? ' · scrive' : ''}] ${t.description}`,
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
    annotations: {
      readOnlyHint: !t.write,
      destructiveHint: !!t.destructive,
      idempotentHint: !t.write,
    },
  }));
}

/**
 * Esegue un tool applicando i controlli di permesso.
 * @returns {Promise<{value:any, rows:number|null}>}
 */
export async function runTool(ctx, name, args) {
  const tool = BY_NAME.get(name);
  if (!tool) throw badRequest(`Tool sconosciuto: ${name}`);
  if (!toolVisible(ctx, tool)) {
    // Messaggio esplicito: aiuta a capire se manca il ruolo, lo scope o la scrittura.
    if (tool.write && !ctx.canWrite) {
      throw forbidden(`"${name}" scrive dati, ma questo token e' di sola lettura.`);
    }
    if (tool.adminOnly && ctx.role !== 'admin') {
      throw forbidden(`"${name}" e' riservato agli admin (ruolo attuale: ${ctx.role}).`);
    }
    if (!scopeIncludes(ctx, tool.domain)) {
      throw forbidden(`"${name}" non e' incluso nello scope "${ctx.scope}". Usa lo scope "all".`);
    }
    throw forbidden(
      `Il ruolo "${ctx.role}" non ha accesso all'area "${DOMAINS[tool.domain].label}".`,
    );
  }
  const value = await tool.handler(args || {}, ctx);
  let rows = null;
  if (value && typeof value === 'object' && '_rows' in value) {
    rows = value._rows;
    delete value._rows;
  }
  return { value, rows };
}

// ── Risorse ─────────────────────────────────────────────────────────────────

const RESOURCES = [
  {
    uri: 'indubai://sessione',
    name: 'Sessione MCP',
    title: 'Chi sono e cosa posso fare',
    description: 'Utente, ruolo, scope, aree e tool disponibili per questo token.',
    mimeType: 'application/json',
    load: async (ctx) => ({
      utente: ctx.profile.full_name,
      ruolo: ctx.role,
      scope: ctx.scope,
      sola_lettura: !ctx.canWrite,
      pagine_portale: ctx.pages === null ? 'tutte' : ctx.pages,
      domini: domainsFor(ctx),
      tool: visibleTools(ctx).map(t => t.name),
    }),
  },
  {
    uri: 'indubai://schema',
    name: 'Schema database',
    title: 'Tabelle e colonne accessibili',
    description: 'Colonne delle tabelle del portale che questa sessione puo\' interrogare.',
    mimeType: 'application/json',
    load: async (ctx) => {
      const names = tablesFor(ctx).filter(n => /^[a-z0-9_]+$/.test(n));
      if (!names.length) return {};
      const rows = await sbRpc('mcp_readonly_query', {
        q: `select table_name, column_name, data_type
            from information_schema.columns
            where table_schema = 'public' and table_name in (${names.map(n => `'${n}'`).join(',')})
            order by table_name, ordinal_position`,
        max_rows: 1000,
      });
      const out = {};
      for (const r of rows || []) {
        if (TABLES[r.table_name]?.hideColumns?.includes(r.column_name)) continue;
        (out[r.table_name] ||= []).push(`${r.column_name} ${r.data_type}`);
      }
      return out;
    },
  },
  {
    uri: 'indubai://permessi',
    name: 'Permessi per ruolo',
    title: 'Matrice ruolo → pagine → domini MCP',
    description: 'Come i ruoli del portale si traducono in aree e tool dell\'MCP.',
    mimeType: 'application/json',
    load: async (ctx) => {
      if (ctx.role !== 'admin') {
        return {
          nota: 'Il dettaglio completo e\' visibile solo agli admin.',
          mio_ruolo: ctx.role,
          mie_pagine: ctx.pages === null ? 'tutte' : ctx.pages,
        };
      }
      const rows = await sbSelect('role_permissions', { select: '*', limit: 50 }).catch(() => []);
      return {
        role_permissions: rows,
        domini: Object.entries(DOMAINS).map(([name, d]) => ({
          dominio: name, label: d.label, pagine: d.pages, solo_admin: !!d.admin,
          tool: ALL_TOOLS.filter(t => t.domain === name).map(t => t.name),
        })),
        scope: Object.entries(SCOPES).map(([name, s]) => ({ scope: name, label: s.label, domini: s.domains })),
      };
    },
  },
  {
    uri: 'indubai://dashboard',
    name: 'Dashboard',
    title: 'KPI del mese corrente',
    description: 'Gli indicatori della home del portale.',
    mimeType: 'application/json',
    domain: 'reports',
    load: async () => {
      const rows = await sbSelect('dashboard_current_month', { select: '*', limit: 1 });
      return Array.isArray(rows) ? rows[0] || {} : rows;
    },
  },
];

export function describeResources(ctx) {
  return RESOURCES
    .filter(r => !r.domain || (domainVisible(ctx, r.domain) && scopeIncludes(ctx, r.domain)))
    .map(({ uri, name, title, description, mimeType }) => ({ uri, name, title, description, mimeType }));
}

export async function readResource(ctx, uri) {
  const r = RESOURCES.find(x => x.uri === uri);
  if (!r) throw badRequest(`Risorsa sconosciuta: ${uri}`);
  if (r.domain && !(domainVisible(ctx, r.domain) && scopeIncludes(ctx, r.domain))) {
    throw forbidden(`Il ruolo "${ctx.role}" non ha accesso a ${uri}`);
  }
  const data = await r.load(ctx);
  return {
    contents: [{
      uri: r.uri,
      mimeType: r.mimeType,
      text: JSON.stringify(data, null, 2),
    }],
  };
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: 'briefing',
    title: 'Briefing operativo',
    description: 'Cosa serve sapere oggi: scadenze, task, estratti mancanti, pagamenti falliti.',
    arguments: [],
    domain: 'reports',
    build: () => [
      'Fai il briefing operativo di oggi sul portale InDubai. In ordine:',
      '1. dashboard_kpis per il quadro generale;',
      '2. vat_deadlines (30 giorni) e segnala le scadenze a rischio;',
      '3. tasks_list con overdue: true e poi status "aperti" assegnati a me;',
      '4. statements_month con stato "mancanti";',
      '5. payments_month con status "failed" e "no_tentativo".',
      'Chiudi con un elenco puntato di azioni concrete, in ordine di urgenza.',
    ].join('\n'),
  },
  {
    name: 'chiusura_mese',
    title: 'Chiusura del mese',
    description: 'Checklist di chiusura: estratti, pagamenti, bilanci, spese.',
    arguments: [
      { name: 'mese', description: 'Mese 1-12 (default: corrente)', required: false },
      { name: 'anno', description: 'Anno (default: corrente)', required: false },
    ],
    domain: 'reports',
    build: (a) => [
      `Prepara la chiusura del mese ${a?.mese || 'corrente'}/${a?.anno || 'corrente'} per InDubai.`,
      'Usa monthly_report, poi statements_month (stato "mancanti" e "da_registrare"),',
      'payments_month per gli stati diversi da ok, balance_month e expenses_list con status "pending".',
      'Restituisci: cosa e\' chiuso, cosa manca, e chi va sollecitato.',
    ].join('\n'),
  },
  {
    name: 'check_cliente',
    title: 'Controllo completo di un cliente',
    description: 'Fotografia di un cliente con i problemi aperti e le prossime scadenze.',
    arguments: [{ name: 'cliente', description: 'Nome o UUID del cliente', required: true }],
    domain: 'clients',
    build: (a) => [
      `Analizza il cliente "${a?.cliente}" sul portale InDubai.`,
      'Parti da client_get, poi completa con onboarding_status, vat_deadlines e tasks_list sul cliente.',
      'Dimmi: cosa e\' in regola, cosa manca, quali scadenze arrivano, cosa farei questa settimana.',
    ].join('\n'),
  },
  {
    name: 'scadenze',
    title: 'Scadenze fiscali',
    description: 'VAT e Corporate Tax in arrivo, con i clienti da contattare.',
    arguments: [{ name: 'giorni', description: 'Finestra in giorni (default 45)', required: false }],
    domain: 'vat',
    build: (a) => [
      `Elenca le scadenze fiscali dei prossimi ${a?.giorni || 45} giorni su InDubai.`,
      'Usa vat_deadlines (con overdue: true per vedere anche gli arretrati) e corptax_list con pending: true.',
      'Raggruppa per settimana e indica per ogni cliente l\'azione necessaria.',
    ].join('\n'),
  },
];

export function describePrompts(ctx) {
  return PROMPTS
    .filter(p => !p.domain || (domainVisible(ctx, p.domain) && scopeIncludes(ctx, p.domain)))
    .map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args }));
}

export function getPrompt(ctx, name, args) {
  const p = PROMPTS.find(x => x.name === name);
  if (!p) throw badRequest(`Prompt sconosciuto: ${name}`);
  if (p.domain && !(domainVisible(ctx, p.domain) && scopeIncludes(ctx, p.domain))) {
    throw forbidden(`Il ruolo "${ctx.role}" non ha accesso al prompt "${name}"`);
  }
  for (const a of p.arguments || []) {
    if (a.required && !args?.[a.name]) throw badRequest(`Argomento obbligatorio: ${a.name}`);
  }
  return {
    description: p.description,
    messages: [{ role: 'user', content: { type: 'text', text: p.build(args || {}) } }],
  };
}
