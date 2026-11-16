/**
 * MCP server — tool della Regia Social (dominio smm).
 *
 * Contenuti, agenti, piano editoriale, cervello, approvazione.
 * Non pubblica mai sui social: la pubblicazione la fa il cron via
 * smm_programmati_in_scadenza → edge function smm-publish.
 */

import {
  sbSelect, sbSelectOne, sbInsert, sbUpdate, sbFunction, sbSignedUrl,
  badRequest, forbidden, clampLimit, requireArg, requireUuid,
} from './_mcp-lib.js';
import { logActivity, one } from './_mcp-tools-biz.js';

// ── Helpers ────────────────────────────────────────────────────────────────

async function defaultBrand() {
  const row = await sbSelectOne('smm_brands', {
    select: 'id,slug,nome', filters: { attivo: true }, order: 'created_at.asc',
  });
  if (!row) throw badRequest('Nessun brand attivo');
  return row;
}

async function resolveBrand(args) {
  if (!args?.brand_id) return defaultBrand();
  const row = await sbSelectOne('smm_brands', {
    select: 'id,slug,nome', filters: { id: args.brand_id },
  });
  if (!row) throw badRequest(`Brand non trovato: ${args.brand_id}`);
  return row;
}

const CONTENT_STATI = [
  'idea', 'in_lavorazione', 'da_revisione', 'respinto',
  'da_approvare', 'approvato', 'in_calendario', 'scartato',
  'programmato', 'pubblicato',
];
const CONTENT_TIPI = ['carosello', 'reel', 'storia', 'post'];

// ── Tool ───────────────────────────────────────────────────────────────────

const smmTools = [

  // ── Contenuti ──────────────────────────────────────────────────────────

  {
    name: 'smm_contents_list',
    domain: 'smm',
    title: 'Elenco contenuti social',
    description:
      'Contenuti della Regia con filtri su stato, tipo, agente e data.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid', description: 'UUID brand; default: primo attivo' },
        stato:    { type: 'string', description: CONTENT_STATI.join(' | ') },
        tipo:     { type: 'string', description: CONTENT_TIPI.join(' | ') },
        created_by: { type: 'string', format: 'uuid', description: 'UUID agente creatore' },
        da:       { type: 'string', description: 'YYYY-MM-DD: contenuti creati da questa data' },
        a:        { type: 'string', description: 'YYYY-MM-DD: contenuti creati fino a questa data' },
        limit:    { type: 'integer', description: 'Default 50' },
      },
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const filters = { brand_id: brand.id };
      if (args?.stato) {
        if (!CONTENT_STATI.includes(args.stato)) throw badRequest(`Stato non valido: ${args.stato}`);
        filters.stato = args.stato;
      }
      if (args?.tipo) {
        if (!CONTENT_TIPI.includes(args.tipo)) throw badRequest(`Tipo non valido: ${args.tipo}`);
        filters.tipo = args.tipo;
      }
      if (args?.created_by) filters.created_by = args.created_by;
      if (args?.da) filters.created_at = { op: 'gte', value: args.da };
      if (args?.a) {
        const upper = { op: 'lte', value: `${args.a}T23:59:59` };
        filters.created_at = filters.created_at
          ? { op: 'and', value: [filters.created_at, upper] }
          : upper;
      }
      const rows = await sbSelect('smm_contents', {
        select: 'id,titolo,tipo,stato,pillar,categoria,sensibile,caption,hashtags,piattaforme,'
              + 'revisore_ok,approvato_da,approvato_at,slot_at,pubblicato_at,created_by,created_at',
        filters,
        order: 'created_at.desc',
        limit: clampLimit(args?.limit, 50, 200),
      });
      return { brand: brand.nome, trovati: rows?.length ?? 0, contenuti: rows };
    },
  },

  {
    name: 'smm_content_get',
    domain: 'smm',
    title: 'Dettaglio contenuto social',
    description:
      'Restituisce un contenuto con il suo storico versioni e le note.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', format: 'uuid', description: 'UUID del contenuto' },
      },
      required: ['content_id'],
    },
    handler: async (args) => {
      const id = requireUuid(args, 'content_id');
      const content = await sbSelectOne('smm_contents', { select: '*', filters: { id } });
      if (!content) throw badRequest(`Contenuto non trovato: ${id}`);
      const [versions, notes] = await Promise.all([
        sbSelect('smm_content_versions', {
          select: 'id,campo,vecchio,nuovo,created_by,created_at',
          filters: { content_id: id }, order: 'created_at.desc', limit: 20,
        }).catch(() => []),
        sbSelect('smm_notes', {
          select: 'id,testo,autore,created_at',
          filters: { content_id: id }, order: 'created_at.desc', limit: 20,
        }).catch(() => []),
      ]);
      return { contenuto: content, versioni: versions, note: notes };
    },
  },

  {
    name: 'smm_content_update',
    domain: 'smm',
    write: true,
    title: 'Aggiorna contenuto social',
    description:
      'Modifica caption, hashtags, categoria, pillar, sensibile o piattaforme '
      + 'di un contenuto. Non modifica lo stato: usa smm_content_approve o smm_content_reject.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id:  { type: 'string', format: 'uuid' },
        caption:     { type: 'string' },
        hashtags:    { type: 'array', items: { type: 'string' } },
        pillar:      { type: 'string' },
        categoria:   { type: 'string' },
        sensibile:   { type: 'boolean' },
        piattaforme: { type: 'array', items: { type: 'string' } },
      },
      required: ['content_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'content_id');
      const patch = {};
      for (const k of ['caption', 'hashtags', 'pillar', 'categoria', 'sensibile', 'piattaforme']) {
        if (args?.[k] !== undefined) patch[k] = args[k];
      }
      if (!Object.keys(patch).length) throw badRequest('Nessun campo da aggiornare');
      const out = one(await sbUpdate('smm_contents', { id }, patch));
      if (!out) throw badRequest(`Contenuto non trovato: ${id}`);
      await logActivity(ctx, 'smm_content_updated', { details: { content_id: id, ...patch } });
      return { contenuto: out, _rows: 1 };
    },
  },

  {
    name: 'smm_content_approve',
    domain: 'smm',
    write: true,
    title: 'Approva contenuto social',
    description:
      'Approva un contenuto in stato "da_approvare". '
      + 'Il trigger smm_programma_approvato gli assegnera\' una data.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', format: 'uuid' },
      },
      required: ['content_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'content_id');
      const content = await sbSelectOne('smm_contents', { select: 'id,stato', filters: { id } });
      if (!content) throw badRequest(`Contenuto non trovato: ${id}`);
      if (content.stato !== 'da_approvare') {
        throw badRequest(`Il contenuto e\' in stato "${content.stato}", non "da_approvare"`);
      }
      const out = one(await sbUpdate('smm_contents', { id }, {
        stato: 'approvato',
        approvato_da: ctx.profile.id,
        approvato_at: new Date().toISOString(),
      }));
      await logActivity(ctx, 'smm_content_approved', { details: { content_id: id } });
      return { contenuto: out, _rows: 1 };
    },
  },

  {
    name: 'smm_content_reject',
    domain: 'smm',
    write: true,
    title: 'Scarta contenuto social',
    description:
      'Scarta un contenuto chiamando la funzione smm_scarta, con motivo opzionale.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', format: 'uuid' },
        perche:     { type: 'string', description: 'Motivo dello scarto' },
      },
      required: ['content_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'content_id');
      const { data, error } = await sbFunction('smm_scarta', {
        p_content: id,
        p_perche: args?.perche || null,
      }).catch(e => ({ data: null, error: e }));
      if (error) throw badRequest(error?.message || 'Errore nello scarto');
      await logActivity(ctx, 'smm_content_rejected', { details: { content_id: id, perche: args?.perche } });
      return { scartato: true, content_id: id };
    },
  },

  // ── Note ────────────────────────────────────────────────────────────────

  {
    name: 'smm_note_add',
    domain: 'smm',
    write: true,
    title: 'Aggiungi nota a contenuto',
    description: 'Aggiunge una nota testuale a un contenuto social.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', format: 'uuid' },
        testo:      { type: 'string', description: 'Testo della nota' },
      },
      required: ['content_id', 'testo'],
    },
    handler: async (args, ctx) => {
      const contentId = requireUuid(args, 'content_id');
      const testo = requireArg(args, 'testo');
      const content = await sbSelectOne('smm_contents', {
        select: 'id,brand_id', filters: { id: contentId },
      });
      if (!content) throw badRequest(`Contenuto non trovato: ${contentId}`);
      const out = one(await sbInsert('smm_notes', [{
        content_id: contentId,
        brand_id: content.brand_id,
        testo,
        autore: ctx.profile.id,
      }]));
      return { nota: out, _rows: 1 };
    },
  },

  // ── Agenti ──────────────────────────────────────────────────────────────

  {
    name: 'smm_agents_list',
    domain: 'smm',
    title: 'Elenco agenti Regia',
    description:
      'Gli agenti della Regia Social, con nome, ruolo, zona, stato e modello.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid', description: 'UUID brand; default: primo attivo' },
        attivo:   { type: 'boolean', description: 'Filtra per attivo/spento' },
      },
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const filters = { brand_id: brand.id };
      if (args?.attivo !== undefined) filters.attivo = args.attivo;
      const rows = await sbSelect('smm_agents', {
        select: 'id,slug,nome,ruolo,zona,descrizione,model,attivo,colore,ordine',
        filters, order: 'ordine.asc',
      });
      return { brand: brand.nome, agenti: rows };
    },
  },

  // ── Piano editoriale ────────────────────────────────────────────────────

  {
    name: 'smm_piano_list',
    domain: 'smm',
    title: 'Piano editoriale',
    description:
      'Righe del piano editoriale: tipo, frequenza, giorni, pillar, agente incaricato.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid', description: 'UUID brand; default: primo attivo' },
        attivo:   { type: 'boolean', description: 'Filtra per attivo/spento; default: solo attivi' },
      },
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const filters = { brand_id: brand.id };
      if (args?.attivo !== undefined) filters.attivo = args.attivo;
      else filters.attivo = true;
      const rows = await sbSelect('smm_piano', {
        select: 'id,nome,tipo,quanti_a_settimana,giorni,ora,pillar,categorie,'
              + 'agente_id,come,attivo,ordine',
        filters, order: 'ordine.asc',
      });
      return { brand: brand.nome, righe: rows };
    },
  },

  {
    name: 'smm_piano_update',
    domain: 'smm',
    write: true,
    title: 'Modifica riga del piano',
    description:
      'Modifica una riga del piano editoriale: frequenza, giorni, ora, pillar, agente, istruzioni.',
    inputSchema: {
      type: 'object',
      properties: {
        piano_id:           { type: 'string', format: 'uuid' },
        quanti_a_settimana: { type: 'integer' },
        giorni:             { type: 'array', items: { type: 'integer' }, description: '1=lun..7=dom; vuoto=tutti' },
        ora:                { type: 'string', description: 'HH:MM, fuso Dubai' },
        pillar:             { type: 'array', items: { type: 'string' } },
        categorie:          { type: 'array', items: { type: 'string' } },
        agente_id:          { type: 'string', format: 'uuid' },
        come:               { type: 'string', description: 'Istruzioni in italiano' },
        attivo:             { type: 'boolean' },
      },
      required: ['piano_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'piano_id');
      const patch = {};
      for (const k of ['quanti_a_settimana', 'giorni', 'ora', 'pillar', 'categorie',
                        'agente_id', 'come', 'attivo']) {
        if (args?.[k] !== undefined) patch[k] = args[k];
      }
      if (!Object.keys(patch).length) throw badRequest('Nessun campo da aggiornare');
      const out = one(await sbUpdate('smm_piano', { id }, patch));
      if (!out) throw badRequest(`Riga piano non trovata: ${id}`);
      await logActivity(ctx, 'smm_piano_updated', { details: { piano_id: id, ...patch } });
      return { riga: out, _rows: 1 };
    },
  },

  // ── Settimana e direzione ───────────────────────────────────────────────

  {
    name: 'smm_settimana',
    domain: 'smm',
    title: 'Settimana editoriale',
    description:
      'Mappa della settimana: quali slot sono coperti, quali liberi, con il conteggio '
      + 'per tipo. offset 0 = settimana corrente, 1 = prossima.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid' },
        offset:   { type: 'integer', description: '0 = corrente, 1 = prossima, -1 = scorsa' },
      },
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const offset = args?.offset ?? 0;
      const rows = await sbSelect('smm_contents', {
        select: 'id,titolo,tipo,stato,slot_at,piattaforme',
        filters: { brand_id: brand.id, stato: { op: 'in', value: ['in_calendario', 'programmato', 'pubblicato'] } },
        order: 'slot_at.asc', limit: 200,
      });
      return { brand: brand.nome, offset, contenuti_in_calendario: rows };
    },
  },

  // ── Cervello ────────────────────────────────────────────────────────────

  {
    name: 'smm_brain_search',
    domain: 'smm',
    title: 'Cerca nel cervello SMM',
    description:
      'Cerca nella knowledge base SMM (cervello). '
      + 'Restituisce le voci piu\' rilevanti per la query.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid' },
        query:    { type: 'string', description: 'Testo da cercare' },
        limit:    { type: 'integer', description: 'Default 10' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const q = requireArg(args, 'query');
      const rows = await sbSelect('smm_brain', {
        select: 'id,titolo,corpo,fonte,tags,created_at',
        filters: { brand_id: brand.id },
        or: `titolo.ilike.*${q}*,corpo.ilike.*${q}*,fonte.ilike.*${q}*`,
        order: 'created_at.desc',
        limit: clampLimit(args?.limit, 10, 50),
      });
      return { brand: brand.nome, cercato: q, risultati: rows?.length ?? 0, voci: rows };
    },
  },

  // ── Impostazioni ────────────────────────────────────────────────────────

  {
    name: 'smm_settings_get',
    domain: 'smm',
    title: 'Impostazioni Regia',
    description:
      'Impostazioni del brand: interruttore generale, budget, doppia approvazione, '
      + 'categorie sensibili, tipi fermi.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid' },
      },
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const settings = await sbSelectOne('smm_settings', {
        select: '*', filters: { brand_id: brand.id },
      });
      return { brand: brand.nome, impostazioni: settings };
    },
  },

  // ── Messaggi (chat agenti) ──────────────────────────────────────────────

  {
    name: 'smm_messages_list',
    domain: 'smm',
    title: 'Messaggi agenti',
    description:
      'I messaggi scambiati dagli agenti su un contenuto (la chat del lavoro).',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', format: 'uuid', description: 'UUID del contenuto' },
        limit:      { type: 'integer', description: 'Default 50' },
      },
      required: ['content_id'],
    },
    handler: async (args) => {
      const contentId = requireUuid(args, 'content_id');
      const rows = await sbSelect('smm_messages', {
        select: 'id,agent_id,ruolo,testo,created_at',
        filters: { content_id: contentId },
        order: 'created_at.asc',
        limit: clampLimit(args?.limit, 50, 200),
      });
      return { content_id: contentId, messaggi: rows };
    },
  },

  // ── Media ───────────────────────────────────────────────────────────────

  {
    name: 'smm_media_list',
    domain: 'smm',
    title: 'Media di un contenuto',
    description:
      'File media (immagini, video) collegati a un contenuto, con URL firmato per la preview.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', format: 'uuid' },
      },
      required: ['content_id'],
    },
    handler: async (args) => {
      const contentId = requireUuid(args, 'content_id');
      const rows = await sbSelect('smm_media', {
        select: 'id,tipo,path,ruolo,ordine,meta,created_at',
        filters: { content_id: contentId },
        order: 'ordine.asc',
      });
      const withUrls = await Promise.all(rows.map(async r => {
        try {
          const url = await sbSignedUrl('smm', r.path, 600);
          return { ...r, preview_url: url };
        } catch {
          return r;
        }
      }));
      return { content_id: contentId, media: withUrls };
    },
  },

  // ── Account collegati (GHL) ─────────────────────────────────────────────

  {
    name: 'smm_accounts',
    domain: 'smm',
    title: 'Account social collegati',
    description:
      'Chiede a smm-publish quali account sono collegati su GoHighLevel. '
      + 'Non pubblica niente.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', format: 'uuid' },
      },
    },
    handler: async (args) => {
      const brand = await resolveBrand(args);
      const result = await sbFunction('smm-publish', {
        azione: 'account',
        brand_id: brand.id,
      });
      return { brand: brand.nome, account: result };
    },
  },
];

export const smmToolsPart = smmTools;
