// ============================================================
// MCP Server — Unit Tests
// Run: node tests/mcp.test.mjs
//
// Verifica il registro dei tool e, soprattutto, il modello di permessi:
// che un ruolo non veda tool fuori dalle sue pagine, che un token di sola
// lettura non abbia tool di scrittura, che lo scope nell'URL non allarghi
// i privilegi e che i filtri non si possano usare per iniettare query.
// ============================================================

import {
  ALL_TOOLS, visibleTools, describeTools, describeResources, describePrompts, getPrompt,
} from '../api/_mcp-tools.js';
import {
  DOMAINS, SCOPES, TABLES, toolVisible, tablesFor, domainVisible, pagesAllowed,
} from '../api/_mcp-catalog.js';
import {
  allowedPagesFor, buildFilterParams, redactArgs, hashToken, extractBearer,
  ROLE_PAGES_DEFAULT, EXTERNAL_ROLES, clampLimit, isUuid, likeTerm,
} from '../api/_mcp-lib.js';
import { resolveScope, toolContent } from '../api/mcp.js';

let passed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) passed++;
  else { failures.push(name); console.error(`  FAIL: ${name}`); }
}
function assertEq(actual, expected, name) {
  assert(actual === expected, `${name} (atteso ${expected}, ottenuto ${actual})`);
}
function assertThrows(fn, name) {
  try { fn(); failures.push(name); console.error(`  FAIL: ${name} (nessun errore)`); }
  catch { passed++; }
}

function ctxFor(role, { scope = 'all', canWrite = true, allowedTools = null, pages } = {}) {
  return {
    role,
    pages: pages !== undefined ? pages : allowedPagesFor(role, {}),
    scope,
    canWrite: canWrite && !SCOPES[scope]?.readOnly,
    allowedTools,
    profile: { id: '00000000-0000-0000-0000-000000000001', full_name: 'Test' },
    token: { id: 't', name: 'test', calls_count: 0 },
  };
}

console.log('\n── Registro ──');
{
  const names = ALL_TOOLS.map(t => t.name);
  assertEq(new Set(names).size, names.length, 'nomi dei tool unici');
  assert(ALL_TOOLS.length >= 50, 'almeno 50 tool registrati');
  assert(ALL_TOOLS.every(t => DOMAINS[t.domain]), 'ogni tool ha un dominio valido');
  assert(ALL_TOOLS.every(t => typeof t.handler === 'function'), 'ogni tool ha un handler');
  assert(ALL_TOOLS.every(t => t.description?.length > 20), 'ogni tool ha una descrizione utile');
  assert(ALL_TOOLS.every(t => t.inputSchema?.type === 'object'), 'ogni inputSchema e\' un object');
  assert(
    ALL_TOOLS.every(t => !t.inputSchema.required
      || t.inputSchema.required.every(r => r in (t.inputSchema.properties || {}))),
    'i campi required esistono fra le properties',
  );
  assert(
    ALL_TOOLS.filter(t => t.write).length >= 20,
    'ci sono tool di scrittura per le operazioni principali',
  );
}

console.log('\n── Permessi per ruolo ──');
{
  const admin = ctxFor('admin');
  const senior = ctxFor('senior');
  const junior = ctxFor('junior');
  const collab = ctxFor('collaborator');

  assertEq(visibleTools(admin).length, ALL_TOOLS.length, 'admin vede tutti i tool');
  assert(visibleTools(senior).length < ALL_TOOLS.length, 'senior non vede i tool solo-admin');
  assert(visibleTools(junior).length < visibleTools(senior).length, 'junior vede meno del senior');
  assert(visibleTools(collab).length < visibleTools(junior).length, 'collaborator vede meno del junior');

  const seniorNames = new Set(visibleTools(senior).map(t => t.name));
  assert(!seniorNames.has('sql_query'), 'sql_query e\' solo admin');
  assert(!seniorNames.has('user_create'), 'user_create e\' solo admin');
  assert(!seniorNames.has('finance_summary'), 'il cashflow di gruppo e\' solo admin');
  assert(!seniorNames.has('mcp_audit'), 'l\'audit MCP e\' solo admin');
  assert(seniorNames.has('clients_search'), 'il senior lavora sui clienti');

  const juniorNames = new Set(visibleTools(junior).map(t => t.name));
  assert(juniorNames.has('vat_deadlines'), 'il junior vede le scadenze VAT (pagina vat)');
  assert(!juniorNames.has('push_broadcast'), 'il junior non manda push (pagina broadcast negata)');
  assert(!juniorNames.has('board_post'), 'il junior non ha la bacheca');

  const collabNames = new Set(visibleTools(collab).map(t => t.name));
  assert(!collabNames.has('vat_deadlines'), 'il collaborator non vede il VAT register');
  assert(!collabNames.has('statement_set'), 'il collaborator non tocca gli estratti conto');
  assert(collabNames.has('tasks_list'), 'il collaborator vede i task');
  assert(collabNames.has('whoami'), 'i tool di sessione sono sempre disponibili');

  // Ruolo sconosciuto: accesso minimo, non accesso totale.
  const ignoto = ctxFor('qualcosa_di_nuovo');
  const ignotiNames = new Set(visibleTools(ignoto).map(t => t.name));
  assert(!ignotiNames.has('clients_search'), 'un ruolo sconosciuto non vede i clienti');
  assert(ignotiNames.has('tasks_list'), 'un ruolo sconosciuto vede comunque i propri task');
}

console.log('\n── Sola lettura ──');
{
  const ro = ctxFor('admin', { canWrite: false });
  assert(visibleTools(ro).every(t => !t.write), 'un token read-only non espone tool di scrittura');
  assert(visibleTools(ro).length > 20, 'ma espone tutti quelli di lettura');

  const roScope = ctxFor('admin', { scope: 'readonly' });
  assertEq(roScope.canWrite, false, 'lo scope readonly spegne la scrittura');
  assert(visibleTools(roScope).every(t => !t.write), 'scope readonly: nessun tool di scrittura');

  assert(!toolVisible(ro, ALL_TOOLS.find(t => t.name === 'db_delete')), 'db_delete nascosto in lettura');
  assert(toolVisible(ctxFor('admin'), ALL_TOOLS.find(t => t.name === 'db_delete')), 'db_delete visibile in scrittura');
}

console.log('\n── Scope ──');
{
  const fin = ctxFor('admin', { scope: 'finance' });
  const names = new Set(visibleTools(fin).map(t => t.name));
  assert(names.has('finance_transactions'), 'scope finance: i movimenti ci sono');
  assert(!names.has('leave_decide'), 'scope finance: le ferie no');
  assert(!names.has('ambassadors_list'), 'scope finance: gli ambassador no');
  assert(names.has('whoami'), 'scope finance: i tool di sessione restano');

  const hr = new Set(visibleTools(ctxFor('admin', { scope: 'hr' })).map(t => t.name));
  assert(hr.has('leave_requests_list') && hr.has('employees_overview'), 'scope hr: ferie e dipendenti');
  assert(!hr.has('finance_transactions'), 'scope hr: niente cashflow');

  // L'URL puo' restringere, mai allargare.
  assertEq(resolveScope('all', 'finance'), 'finance', 'un token "all" accetta lo scope dell\'URL');
  assertEq(resolveScope('finance', 'all'), 'finance', 'un token "finance" non si allarga ad "all"');
  assertEq(resolveScope('finance', 'hr'), 'finance', 'un token "finance" non diventa "hr"');
  assertEq(resolveScope('hr', null), 'hr', 'senza scope nell\'URL vale quello del token');
  assertEq(resolveScope(null, null), 'all', 'default: all');
  assertEq(resolveScope('inesistente', null), 'all', 'uno scope ignoto sul token ricade su all');
  assertThrows(() => resolveScope('all', 'inesistente'), 'uno scope ignoto nell\'URL e\' un errore');
}

console.log('\n── Whitelist di tool sul token ──');
{
  const ctx = ctxFor('admin', { allowedTools: ['whoami', 'clients_search'] });
  const names = visibleTools(ctx).map(t => t.name).sort();
  assertEq(names.join(','), 'clients_search,whoami', 'la whitelist del token limita i tool');
}

console.log('\n── Tabelle dei tool generici ──');
{
  const admin = ctxFor('admin');
  const writable = tablesFor(admin, { write: true });
  for (const t of ['profiles', 'role_permissions', 'mcp_tokens', 'mcp_audit_log', 'activity_log']) {
    assert(!writable.includes(t), `${t} non e' scrivibile dai tool generici (escalation)`);
  }
  assert(tablesFor(admin).includes('mcp_tokens'), 'mcp_tokens e\' leggibile dall\'admin');
  assert(!TABLES.app_config, 'app_config non e\' esposta: contiene un segreto condiviso');
  assertEq(TABLES.mcp_tokens.hideColumns.join(','), 'token_hash', 'l\'hash del token non si legge mai');

  const collab = ctxFor('collaborator');
  const collabTables = tablesFor(collab);
  assert(!collabTables.includes('finance_transactions'), 'il collaborator non legge il cashflow');
  assert(!collabTables.includes('vat_register'), 'il collaborator non legge il VAT register');
  assert(collabTables.includes('tasks'), 'il collaborator legge i task');

  assert(Object.values(TABLES).every(m => DOMAINS[m.domain]), 'ogni tabella ha un dominio valido');
  assert(Object.values(TABLES).every(m => !m.view || !m.write), 'nessuna view e\' dichiarata scrivibile');
}

console.log('\n── Default di ruolo allineati al portale ──');
{
  assertEq(allowedPagesFor('admin', {}), null, 'admin: tutte le pagine');
  assertEq(allowedPagesFor('senior', {}), null, 'senior: tutte le pagine');
  assert(allowedPagesFor('junior', {}).includes('vat'), 'junior: VAT incluso');
  assert(!allowedPagesFor('junior', {}).includes('bacheca'), 'junior: bacheca esclusa');
  assertEq(
    allowedPagesFor('junior', { junior: ['index'] }).join(','), 'index',
    'role_permissions dal DB vince sui default',
  );
  assertEq(
    allowedPagesFor('junior', { junior: null }).join(','),
    ROLE_PAGES_DEFAULT.junior.join(','),
    'allowed_pages vuoto in DB = default del codice',
  );
  assert(EXTERNAL_ROLES.includes('client') && EXTERNAL_ROLES.includes('ambassador'),
    'clienti e ambassador sono esclusi da questo MCP');

  // Pagine extra richieste da singoli tool.
  assert(pagesAllowed({ pages: null }, ['broadcast']), 'chi vede tutto vede anche broadcast');
  assert(!pagesAllowed({ pages: ['notifiche'] }, ['broadcast']), 'notifiche non implica broadcast');
  assert(pagesAllowed({ pages: ['notifiche', 'broadcast'] }, ['broadcast']), 'broadcast esplicito');
  assert(pagesAllowed({ pages: ['x'] }, undefined), 'un tool senza pagine extra passa sempre');
}

console.log('\n── Filtri PostgREST ──');
{
  const eq = buildFilterParams({ status: 'open' });
  assertEq(eq[0].join('='), 'status=eq.open', 'valore semplice = uguaglianza');
  assertEq(buildFilterParams({ year: { op: 'gte', value: 2026 } })[0][1], 'gte.2026', 'operatore esplicito');
  assertEq(buildFilterParams({ notes: null })[0][1], 'is.null', 'null = IS NULL');
  assertEq(buildFilterParams({ id: ['a', 'b'] })[0][1], 'in.("a","b")', 'array = IN');
  assertEq(
    buildFilterParams({ role: { op: 'not_in', value: ['client', 'ambassador'] } })[0][1],
    'not.in.("client","ambassador")', 'not_in = NOT IN',
  );
  assertEq(buildFilterParams({ a: { op: 'in', value: 'solo' } })[0][1], 'in.("solo")', 'in con valore singolo');
  assertEq(Object.keys(buildFilterParams({})).length, 0, 'nessun filtro = nessun parametro');

  assertThrows(() => buildFilterParams({ 'id; drop table clients': 1 }), 'nome colonna con SQL rifiutato');
  assertThrows(() => buildFilterParams({ 'a b': 1 }), 'nome colonna con spazio rifiutato');
  assertThrows(() => buildFilterParams({ id: { op: 'exec', value: 1 } }), 'operatore ignoto rifiutato');
  // I valori restano dati: vengono codificati da URLSearchParams, non interpolati.
  assertEq(
    buildFilterParams({ company_name: "x' or 1=1--" })[0][1],
    "eq.x' or 1=1--",
    'il valore resta un valore',
  );
}

console.log('\n── Termini di ricerca ──');
{
  // I termini finiscono dentro un'espressione `or` di PostgREST, dove virgole
  // e parentesi sono separatori: vanno via, o la query cambia significato.
  assertEq(likeTerm('ACME, srl (dubai)'), 'ACME srl dubai', 'virgole e parentesi rimosse');
  assertEq(likeTerm('  spazi  '), 'spazi', 'spazi esterni rimossi');
  assertEq(likeTerm('100% *tutto*'), '100 tutto', 'jolly rimossi');
  assertEq(likeTerm('mail@indubai.it'), 'mail@indubai.it', 'le email restano intatte');
  assertEq(likeTerm(null), '', 'null diventa stringa vuota');
}

console.log('\n── Audit e utility ──');
{
  const r = redactArgs({ password: 'segreto', new_password: 'x', nome: 'ok', nested: { token: 'k' } });
  assertEq(r.password, '***', 'password oscurata');
  assertEq(r.new_password, '***', 'new_password oscurata');
  assertEq(r.nested.token, '***', 'token oscurato anche annidato');
  assertEq(r.nome, 'ok', 'gli altri campi restano');
  assert(redactArgs({ q: 'a'.repeat(5000) }).q.length < 2100, 'i valori lunghi vengono troncati');

  assertEq(hashToken('abc').length, 64, 'hash sha256 esadecimale');
  assert(hashToken('abc') !== hashToken('abd'), 'hash diversi per token diversi');
  assertEq(extractBearer({ headers: { authorization: 'Bearer  tok123 ' } }), 'tok123', 'bearer estratto');
  assertEq(extractBearer({ headers: { 'x-mcp-token': 'tok' } }), 'tok', 'fallback x-mcp-token');
  assertEq(extractBearer({ headers: {} }), null, 'nessun token');

  assertEq(clampLimit(undefined, 50, 500), 50, 'limit: default');
  assertEq(clampLimit(9999, 50, 500), 500, 'limit: tetto');
  assertEq(clampLimit(0, 50, 500), 1, 'limit: minimo 1');
  assert(isUuid('11111111-2222-3333-4444-555555555555'), 'uuid valido');
  assert(!isUuid('non-un-uuid'), 'uuid non valido');
}

console.log('\n── Risultati dei tool ──');
{
  const small = toolContent({ a: 1 });
  assertEq(small.content[0].type, 'text', 'il contenuto e\' testo');
  assert(small.structuredContent, 'gli oggetti hanno anche structuredContent');
  assert(!toolContent([1, 2, 3]).structuredContent, 'gli array non vanno in structuredContent');
  const big = toolContent({ x: 'y'.repeat(500000) });
  assert(big.content[0].text.includes('troncato'), 'i risultati enormi vengono troncati');
  assert(!big.structuredContent, 'un risultato troncato non va in structuredContent');
}

console.log('\n── Descrittori MCP ──');
{
  const admin = ctxFor('admin');
  const tools = describeTools(admin);
  assert(tools.every(t => t.name && t.description && t.inputSchema), 'tools/list e\' completo');
  assert(tools.every(t => typeof t.annotations.readOnlyHint === 'boolean'), 'annotations presenti');
  assert(tools.find(t => t.name === 'db_delete').annotations.readOnlyHint === false, 'db_delete non e\' read-only');

  assert(describeResources(admin).length >= 3, 'risorse esposte');
  assert(describeResources(ctxFor('collaborator')).length >= 1, 'il collaborator ha almeno una risorsa');

  const prompts = describePrompts(admin);
  assert(prompts.length >= 3, 'prompt esposti');
  const p = getPrompt(admin, 'check_cliente', { cliente: 'ACME' });
  assert(p.messages[0].content.text.includes('ACME'), 'il prompt usa l\'argomento');
  assertThrows(() => getPrompt(admin, 'check_cliente', {}), 'argomento obbligatorio mancante');
  assertThrows(() => getPrompt(admin, 'inesistente', {}), 'prompt inesistente');
  assertThrows(() => getPrompt(ctxFor('collaborator'), 'scadenze', {}),
    'un prompt fuori ruolo non e\' accessibile');
}

console.log(`\n${failures.length ? '✗' : '✓'} ${passed} asserzioni passate, ${failures.length} fallite`);
if (failures.length) {
  console.error('\nFallite:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
