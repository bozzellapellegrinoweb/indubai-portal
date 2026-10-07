/**
 * MCP server — catalogo di domini, scope e tabelle.
 *
 * Il modello di permessi non ne introduce uno nuovo: ogni dominio di tool e'
 * agganciato alle pagine del portale, e le pagine di un ruolo arrivano da
 * role_permissions (con i default di js/app.js). Se un ruolo non vede la pagina
 * /finance.html, non vede nemmeno i tool del dominio "finance".
 */

// ── Domini ──────────────────────────────────────────────────────────────────
// pages: null  -> sempre disponibile (metadati di sessione, accesso dati generico)
// admin: true  -> solo ruolo admin, come la voce di menu corrispondente

export const DOMAINS = {
  core:           { label: 'Sessione e metadati',     pages: null },
  data:           { label: 'Accesso dati generico',   pages: null },
  clients:        { label: 'Clienti',                 pages: ['clients'] },
  onboarding:     { label: 'Onboarding',              pages: ['onboarding'] },
  documents:      { label: 'Documenti',               pages: ['documents'] },
  statements:     { label: 'Estratti conto',          pages: ['statements'] },
  payments:       { label: 'Abbonamenti',             pages: ['payments'] },
  bilanci:        { label: 'Bilanci',                 pages: ['bilanci'] },
  // vat-partner.html e pw.html sono solo elenchi filtrati di clients: non
  // danno accesso al VAT register, che sta su /vat.html.
  vat:            { label: 'VAT register',            pages: ['vat'] },
  corptax:        { label: 'Corporate Tax',           pages: ['corp-tax'] },
  tasks:          { label: 'Task',                    pages: ['tasks'] },
  pipeline:       { label: 'Pipeline commerciale',    pages: ['pipeline'] },
  leads:          { label: 'Lead',                    pages: ['lead-analytics'] },
  expenses:       { label: 'Spese',                   pages: ['expenses'] },
  reconciliation: { label: 'Riconciliazione',         pages: ['reconciliation'] },
  affinitas:      { label: 'Affinitas',               pages: ['affinitas'] },
  board:          { label: 'Bacheca',                 pages: ['bacheca'] },
  notify:         { label: 'Notifiche e broadcast',   pages: ['notifiche', 'broadcast'] },
  hr:             { label: 'Ferie e dipendenti',      pages: ['ferie'] },
  reports:        { label: 'Report e dashboard',      pages: ['index', 'reports'] },
  finance:        { label: 'Cashflow di gruppo',      pages: ['finance'],      admin: true },
  ambassador:     { label: 'Programma ambassador',    pages: ['ambassadors'],  admin: true },
  users:          { label: 'Utenti e permessi',       pages: ['users'],        admin: true },
  admin:          { label: 'Amministrazione MCP',     pages: ['mcp'],          admin: true },
};

// ── Scope: "MCP dedicati per ruolo" senza duplicare il server ───────────────
// Lo scope restringe i domini; i permessi del ruolo restano l'ultima parola.
// null = tutti i domini che il ruolo puo' vedere.

export const SCOPES = {
  all:      { label: 'Tutto quello che il ruolo consente', domains: null },
  readonly: { label: 'Tutto, ma in sola lettura',          domains: null, readOnly: true },
  admin:    { label: 'Amministrazione completa',           domains: null },

  clients: {
    label: 'Segreteria clienti',
    domains: ['core', 'data', 'clients', 'onboarding', 'documents', 'pipeline', 'leads',
              'tasks', 'notify', 'reports'],
  },
  compliance: {
    label: 'VAT, Corporate Tax, estratti e abbonamenti',
    domains: ['core', 'data', 'clients', 'vat', 'corptax', 'statements', 'payments',
              'bilanci', 'reconciliation', 'tasks', 'reports'],
  },
  finance: {
    label: 'Cashflow, spese, incassi',
    domains: ['core', 'data', 'finance', 'payments', 'expenses', 'bilanci',
              'reconciliation', 'reports', 'clients'],
  },
  hr: {
    label: 'Ferie, permessi, dipendenti',
    domains: ['core', 'data', 'hr', 'board', 'notify', 'users', 'reports'],
  },
  growth: {
    label: 'Ambassador, lead, pipeline',
    domains: ['core', 'data', 'ambassador', 'leads', 'pipeline', 'affinitas',
              'clients', 'notify', 'reports'],
  },
  ops: {
    label: 'Operativo: task, bacheca, notifiche',
    domains: ['core', 'data', 'tasks', 'board', 'notify', 'documents', 'clients', 'reports'],
  },
};

export const SCOPE_NAMES = Object.keys(SCOPES);

// ── Tabelle esposte dai tool generici db_* ──────────────────────────────────
// write: false  -> leggibile ma non scrivibile dai tool generici. Vale per le
// tabelle da cui si possono alzare i propri privilegi (profiles, permessi,
// token MCP) e per i log: si toccano solo dai tool dedicati, che validano.

export const TABLES = {
  // Clienti e anagrafica
  clients:                   { domain: 'clients',        write: true },
  zoho_snapshots:            { domain: 'clients',        write: false },
  client_files:              { domain: 'documents',      write: true },
  onboarding_checklist:      { domain: 'onboarding',     write: true },

  // Compliance e contabilita'
  bank_statements:           { domain: 'statements',     write: true },
  subscription_payments:     { domain: 'payments',       write: true },
  monthly_balance:           { domain: 'bilanci',        write: true },
  vat_register:              { domain: 'vat',            write: true },
  corporate_tax:             { domain: 'corptax',        write: true },
  client_expenses:           { domain: 'expenses',       write: true },
  statement_uploads:         { domain: 'reconciliation', write: true },
  parsed_transactions:       { domain: 'reconciliation', write: true },
  affinitas_subscriptions:   { domain: 'affinitas',      write: true },

  // Operativo
  tasks:                     { domain: 'tasks',          write: true },
  task_comments:             { domain: 'tasks',          write: true },
  pipeline_stages:           { domain: 'pipeline',       write: true },
  leads:                     { domain: 'leads',          write: false },
  lead_activity:             { domain: 'leads',          write: false },
  board_posts:               { domain: 'board',          write: true },
  board_comments:            { domain: 'board',          write: true },
  board_mentions:            { domain: 'board',          write: false },
  notifications:             { domain: 'notify',         write: true },
  notification_settings:     { domain: 'notify',         write: true },

  // HR
  employees:                 { domain: 'hr',             write: true },
  leave_requests:            { domain: 'hr',             write: true },

  // Finance (solo admin, per dominio)
  finance_accounts:          { domain: 'finance',        write: true },
  finance_batches:           { domain: 'finance',        write: true },
  finance_transactions:      { domain: 'finance',        write: true },
  finance_fx_rates:          { domain: 'finance',        write: true },
  finance_rules:             { domain: 'finance',        write: true },
  finance_internal_parties:  { domain: 'finance',        write: true },
  finance_settings:          { domain: 'finance',        write: true },

  // Ambassador (solo admin)
  ambassadors:               { domain: 'ambassador',     write: true },
  ambassador_referrals:      { domain: 'ambassador',     write: true },
  ambassador_commissions:    { domain: 'ambassador',     write: true },
  ambassador_services:       { domain: 'ambassador',     write: true },

  // Lettura sola: privilegi e audit.
  // app_config non compare di proposito: contiene il segreto condiviso
  // dell'import da Drive e non deve finire in una chat.
  profiles:                  { domain: 'users',          write: false },
  role_permissions:          { domain: 'users',          write: false },
  activity_log:              { domain: 'reports',        write: false },
  email_log:                 { domain: 'reports',        write: false },
  mcp_tokens:                { domain: 'admin',          write: false, hideColumns: ['token_hash'] },
  mcp_audit_log:             { domain: 'admin',          write: false },

  // Views
  dashboard_current_month:        { domain: 'reports',    write: false, view: true },
  clients_subscription_status:    { domain: 'payments',   write: false, view: true },
  clients_missing_bank_statements:{ domain: 'statements',  write: false, view: true },
  finance_monthly_summary:        { domain: 'finance',    write: false, view: true },
  ambassador_summary:             { domain: 'ambassador', write: false, view: true },
};

// ── Visibilita' ─────────────────────────────────────────────────────────────

/** Il ruolo della sessione puo' vedere questo dominio? */
export function domainVisible(ctx, domainName) {
  const d = DOMAINS[domainName];
  if (!d) return false;
  if (d.admin && ctx.role !== 'admin') return false;
  if (d.pages === null) return true;
  if (ctx.pages === null) return true;              // admin / senior: tutte le pagine
  return d.pages.some(p => ctx.pages.includes(p));
}

/** Lo scope della sessione include questo dominio? */
export function scopeIncludes(ctx, domainName) {
  const scope = SCOPES[ctx.scope] || SCOPES.all;
  if (!scope.domains) return true;
  return scope.domains.includes(domainName);
}

/** La sessione ha accesso a tutte queste pagine del portale? */
export function pagesAllowed(ctx, pages) {
  if (!pages?.length) return true;
  if (ctx.pages === null) return true;
  return pages.every(p => ctx.pages.includes(p));
}

/** Tool esposto a questa sessione? */
export function toolVisible(ctx, tool) {
  if (tool.adminOnly && ctx.role !== 'admin') return false;
  // Un tool puo' chiedere una pagina piu' specifica del suo dominio
  // (es. push_broadcast richiede /broadcast.html, non la sola /notifiche.html).
  if (!pagesAllowed(ctx, tool.pages)) return false;
  if (tool.write) {
    if (!ctx.canWrite) return false;
    if (SCOPES[ctx.scope]?.readOnly) return false;
  }
  if (ctx.allowedTools && !ctx.allowedTools.includes(tool.name)) return false;
  if (!scopeIncludes(ctx, tool.domain)) return false;
  return domainVisible(ctx, tool.domain);
}

/** Tabelle leggibili (o scrivibili, con { write: true }) dalla sessione. */
export function tablesFor(ctx, { write = false } = {}) {
  return Object.entries(TABLES)
    .filter(([, meta]) => (write ? meta.write : true))
    .filter(([, meta]) => domainVisible(ctx, meta.domain) && scopeIncludes(ctx, meta.domain))
    .map(([name]) => name)
    .sort();
}

/** Elenco dei domini visibili, per i tool di introspezione. */
export function domainsFor(ctx) {
  return Object.entries(DOMAINS)
    .filter(([name]) => domainVisible(ctx, name) && scopeIncludes(ctx, name))
    .map(([name, d]) => ({ name, label: d.label, pages: d.pages }));
}
