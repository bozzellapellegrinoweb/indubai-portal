/**
 * MCP server del portale InDubai — privato, per lo staff interno.
 *
 *   POST /api/mcp              → JSON-RPC 2.0 (transport MCP "Streamable HTTP")
 *   POST /api/mcp?scope=finance → restringe i tool a un'area (vedi SCOPES)
 *   GET  /api/mcp?info=1       → descrizione del server, senza dati
 *
 * Autenticazione: header "Authorization: Bearer <token>", dove il token e' uno
 * di quelli emessi da /mcp.html. Il token e' legato a un utente del portale:
 * ruolo e permessi di pagina decidono quali tool esistono per quella sessione.
 *
 * Documentazione: MCP.md
 */

import {
  authenticate, audit, rateLimit, McpError, badRequest, clientIp,
} from './_mcp-lib.js';
import { SCOPES, SCOPE_NAMES } from './_mcp-catalog.js';
import {
  describeTools, runTool, describeResources, readResource,
  describePrompts, getPrompt, visibleTools,
} from './_mcp-tools.js';

const SERVER_NAME    = 'indubai-portal';
const SERVER_VERSION = '1.0.0';

// Versioni del protocollo che sappiamo parlare; la prima e' la preferita.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Tetto alla dimensione della risposta di un tool, per non saturare il contesto.
const MAX_RESULT_CHARS = 400_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-mcp-token, mcp-session-id, mcp-protocol-version, accept',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

// ── Helper di risposta ──────────────────────────────────────────────────────

function sendJson(res, status, body, extraHeaders = {}) {
  for (const [k, v] of Object.entries({ ...CORS, ...extraHeaders })) res.setHeader(k, v);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

/** Risposta SSE a colpo singolo, per i client che accettano solo text/event-stream. */
function sendSse(res, body) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.status(200);
  res.write(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
  res.end();
}

function wantsSse(req) {
  const accept = String(req.headers?.accept || '');
  return accept.includes('text/event-stream') && !accept.includes('application/json');
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) },
});

function parseBody(req) {
  const b = req.body;
  if (b === undefined || b === null || b === '') return null;
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new McpError('JSON non valido', { code: -32700 }); }
  }
  if (Buffer.isBuffer(b)) {
    try { return JSON.parse(b.toString('utf8')); } catch { throw new McpError('JSON non valido', { code: -32700 }); }
  }
  return b;
}

// ── Scope: l'URL puo' restringere, mai allargare ────────────────────────────

function resolveScope(tokenScope, requested) {
  const base = tokenScope && SCOPES[tokenScope] ? tokenScope : 'all';
  if (!requested) return base;
  if (!SCOPES[requested]) {
    throw badRequest(`Scope "${requested}" inesistente. Disponibili: ${SCOPE_NAMES.join(', ')}`);
  }
  // Un token gia' limitato a un'area non si allarga passando uno scope nell'URL.
  if (base === 'all' || base === 'admin') return requested;
  return base;
}

// ── Contenuto del risultato di un tool ──────────────────────────────────────

function toolContent(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text === undefined) text = 'null';
  let truncated = false;
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n\n… risultato troncato: restringi i filtri o abbassa "limit".`;
    truncated = true;
  }
  const out = { content: [{ type: 'text', text }] };
  if (!truncated && value && typeof value === 'object' && !Array.isArray(value)) {
    out.structuredContent = value;
  }
  return out;
}

function instructionsFor(ctx) {
  const tools = visibleTools(ctx);
  const writes = tools.filter(t => t.write).length;
  return [
    `Portale InDubai (gestione clienti UAE: segreteria, VAT, Corporate Tax, abbonamenti,`,
    `task, ambassador, cashflow). Sei collegato come ${ctx.profile.full_name}, ruolo`,
    `"${ctx.role}", scope "${ctx.scope}" (${SCOPES[ctx.scope]?.label}).`,
    '',
    `Hai ${tools.length} tool, di cui ${writes} che scrivono dati.`,
    ctx.canWrite
      ? 'Le scritture sono abilitate: su operazioni che toccano piu\' righe o eliminano dati, conferma prima con l\'utente.'
      : 'Il token e\' di SOLA LETTURA: i tool di scrittura non sono disponibili.',
    '',
    'Come muoverti:',
    '• `whoami` e `portal_map` dicono cosa puoi vedere e fare.',
    '• Per cercare qualunque cosa senza sapere dove sta: `search_everything`.',
    '• I tool di dominio (clients_search, client_get, tasks_list, vat_deadlines, …) sono',
    '  la via preferita: filtrano e aggregano come fa il portale.',
    '• `db_select` / `db_schema` servono per quello che i tool specifici non coprono,',
    '  e `sql_query` (solo admin) per join e aggregazioni libere in sola lettura.',
    '• I clienti si indicano per nome: i tool risolvono il nome in UUID e chiedono',
    '  conferma se e\' ambiguo.',
    '',
    'Ogni chiamata e\' registrata nell\'audit log del portale con utente, tool e argomenti.',
    'Quello che non e\' incluso nel ruolo non e\' nascosto: non esiste per questa sessione.',
  ].join('\n');
}

// ── Dispatch JSON-RPC ───────────────────────────────────────────────────────

async function dispatch(ctx, msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      const version = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: {
          tools:     { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts:   { listChanged: false },
          logging:   {},
        },
        serverInfo: {
          name: SERVER_NAME,
          title: 'InDubai Portal (interno)',
          version: SERVER_VERSION,
        },
        instructions: instructionsFor(ctx),
      });
    }

    case 'ping':
      return rpcResult(id, {});

    case 'logging/setLevel':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: describeTools(ctx) });

    case 'tools/call': {
      const name = params?.name;
      if (!name) return rpcError(id, -32602, 'Manca il nome del tool');
      const started = Date.now();
      try {
        const { value, rows } = await runTool(ctx, name, params?.arguments);
        await audit(ctx, {
          tool: name, args: params?.arguments, ok: true,
          rowsAffected: rows, durationMs: Date.now() - started,
        });
        return rpcResult(id, toolContent(value));
      } catch (e) {
        const message = e?.message || 'Errore sconosciuto';
        await audit(ctx, {
          tool: name, args: params?.arguments, ok: false,
          error: message, durationMs: Date.now() - started,
        });
        // Gli errori di un tool tornano nel risultato, cosi' il modello puo' correggersi.
        return rpcResult(id, { content: [{ type: 'text', text: `Errore: ${message}` }], isError: true });
      }
    }

    case 'resources/list':
      return rpcResult(id, { resources: describeResources(ctx) });

    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });

    case 'resources/read': {
      const uri = params?.uri;
      if (!uri) return rpcError(id, -32602, 'Manca il parametro uri');
      try {
        return rpcResult(id, await readResource(ctx, uri));
      } catch (e) {
        return rpcError(id, e?.code || -32603, e?.message || 'Lettura risorsa fallita');
      }
    }

    case 'prompts/list':
      return rpcResult(id, { prompts: describePrompts(ctx) });

    case 'prompts/get': {
      try {
        return rpcResult(id, getPrompt(ctx, params?.name, params?.arguments));
      } catch (e) {
        return rpcError(id, e?.code || -32603, e?.message || 'Prompt non disponibile');
      }
    }

    case 'completion/complete':
      return rpcResult(id, { completion: { values: [], hasMore: false } });

    default:
      return rpcError(id, -32601, `Metodo non supportato: ${method}`);
  }
}

// ── Handler HTTP ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.status(204).end();
  }

  // Il server e' stateless: niente sessioni da chiudere.
  if (req.method === 'DELETE') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    if (req.query?.info !== undefined) {
      return sendJson(res, 200, {
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: 'streamable-http',
        protocol_versions: PROTOCOL_VERSIONS,
        auth: 'Authorization: Bearer <token MCP del portale>',
        scope_disponibili: Object.entries(SCOPES).map(([name, s]) => ({ name, label: s.label })),
        documentazione: 'https://github.com/bozzellapellegrinoweb/indubai-portal/blob/main/MCP.md',
      });
    }
    // Nessuno stream aperto dal server: il client usa POST.
    return sendJson(res, 405, rpcError(null, -32000, 'Usa POST per parlare con questo server MCP'), {
      Allow: 'POST, DELETE, OPTIONS',
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, rpcError(null, -32000, 'Metodo HTTP non supportato'), {
      Allow: 'POST, GET, DELETE, OPTIONS',
    });
  }

  let body;
  try {
    body = parseBody(req);
  } catch (e) {
    return sendJson(res, 400, rpcError(null, -32700, e.message));
  }
  if (!body) return sendJson(res, 400, rpcError(null, -32600, 'Corpo della richiesta vuoto'));

  const messages = Array.isArray(body) ? body : [body];
  const requests = messages.filter(m => m && m.id !== undefined && m.id !== null);

  // Notifiche (senza id): niente risposta, solo conferma.
  if (!requests.length) {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.status(202).end();
  }

  // ── Autenticazione e permessi ──
  const requested = req.query?.scope ? String(req.query.scope) : null;
  let ctx;
  try {
    ctx = await authenticate(req);
    ctx.scope = resolveScope(ctx.token.scope, requested);
    // Un token di sola lettura, o uno scope read-only, spengono tutti i tool di scrittura.
    ctx.canWrite = ctx.canWrite && !SCOPES[ctx.scope]?.readOnly;
    ctx.visibleToolNames = visibleTools(ctx).map(t => t.name);
  } catch (e) {
    const status = e?.http || 401;
    if (status === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="indubai-mcp"');
    }
    console.error('[mcp] auth:', e?.message, 'ip:', clientIp(req));
    return sendJson(res, status, rpcError(requests[0]?.id ?? null, e?.code || -32001,
      e?.message || 'Non autorizzato'));
  }

  try {
    rateLimit(ctx.token.id);
  } catch (e) {
    return sendJson(res, 429, rpcError(requests[0]?.id ?? null, e.code, e.message));
  }

  // ── Esecuzione ──
  const responses = [];
  for (const msg of requests) {
    if (msg.jsonrpc !== '2.0') {
      responses.push(rpcError(msg.id, -32600, 'Campo jsonrpc diverso da "2.0"'));
      continue;
    }
    try {
      responses.push(await dispatch(ctx, msg));
    } catch (e) {
      console.error('[mcp]', msg.method, e);
      responses.push(rpcError(msg.id, e?.code || -32603, e?.message || 'Errore interno'));
    }
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  if (wantsSse(req)) return sendSse(res, payload);
  return sendJson(res, 200, payload);
}

// Esportati per i test (tests/mcp.test.mjs).
export { resolveScope, toolContent, instructionsFor, PROTOCOL_VERSIONS };
