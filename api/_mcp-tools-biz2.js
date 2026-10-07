/**
 * MCP server — tool di dominio, parte 2:
 * operativo (task, pipeline, lead, bacheca, notifiche), finance, HR,
 * ambassador, report, utenti e amministrazione dell'MCP stesso.
 */

import {
  sbSelect, sbSelectOne, sbInsert, sbUpdate, sbFunction, sbSignedUrl, sbAuthAdmin,
  badRequest, forbidden, clampLimit, requireArg, requireUuid, currentYearMonth, likeTerm,
} from './_mcp-lib.js';
import { domainVisible, scopeIncludes } from './_mcp-catalog.js';
import { resolveClient, resolveProfile, logActivity, one, ym, ymProps } from './_mcp-tools-biz.js';

const can = (ctx, d) => domainVisible(ctx, d) && scopeIncludes(ctx, d);

// ── TASK ────────────────────────────────────────────────────────────────────

const TASK_STATUS   = ['open', 'in_progress', 'completed', 'cancelled'];
const TASK_PRIORITY = ['low', 'normal', 'high', 'urgent'];
const TASK_CATEGORY = ['generale', 'vat', 'corporate_tax', 'onboarding', 'estratti', 'pagamenti', 'altro'];

const taskTools = [
  {
    name: 'tasks_list',
    domain: 'tasks',
    title: 'Elenco task',
    description:
      'Task del portale con filtri su stato, assegnatario, cliente, priorita\', categoria e scadenza. '
      + 'Usa assigned_to: "me" per i propri.',
    inputSchema: {
      type: 'object',
      properties: {
        status:      { type: 'string', description: TASK_STATUS.join(' | ') + ' | aperti (open+in_progress)' },
        assigned_to: { type: 'string', description: '"me", UUID o nome' },
        client:      { type: 'string', description: 'Nome o UUID cliente' },
        priority:    { type: 'string', description: TASK_PRIORITY.join(' | ') },
        category:    { type: 'string', description: TASK_CATEGORY.join(' | ') },
        due_before:  { type: 'string', description: 'YYYY-MM-DD: solo task con scadenza entro questa data' },
        overdue:     { type: 'boolean', description: 'true: solo task scadute e non chiuse' },
        limit:       { type: 'integer', description: 'Default 50' },
      },
    },
    handler: async (args, ctx) => {
      const filters = {};
      if (args?.status === 'aperti') filters.status = { op: 'in', value: ['open', 'in_progress'] };
      else if (args?.status) {
        if (!TASK_STATUS.includes(args.status)) throw badRequest(`Stato non valido: ${args.status}`);
        filters.status = args.status;
      }
      if (args?.assigned_to) filters.assigned_to = (await resolveProfile(args.assigned_to, ctx)).id;
      if (args?.client) filters.client_id = (await resolveClient(args, { field: 'client' })).id;
      if (args?.priority) filters.priority = args.priority;
      if (args?.category) filters.category = args.category;
      if (args?.overdue) {
        filters.due_date = { op: 'lt', value: new Date().toISOString().slice(0, 10) };
        filters.status = { op: 'in', value: ['open', 'in_progress'] };
      } else if (args?.due_before) {
        filters.due_date = { op: 'lte', value: args.due_before };
      }
      const rows = await sbSelect('tasks', {
        select: '*,client:clients(id,company_name),assegnato:profiles!tasks_assigned_to_fkey(id,full_name),'
              + 'creato_da:profiles!tasks_created_by_fkey(id,full_name)',
        filters, order: 'due_date.asc,created_at.desc',
        limit: clampLimit(args?.limit, 50, 300),
      }).catch(() => sbSelect('tasks', {
        select: '*,client:clients(id,company_name)',
        filters, order: 'due_date.asc,created_at.desc',
        limit: clampLimit(args?.limit, 50, 300),
      }));
      return { trovati: rows?.length ?? 0, task: rows };
    },
  },

  {
    name: 'task_create',
    domain: 'tasks',
    write: true,
    title: 'Crea task',
    description:
      'Crea un task, eventualmente collegato a un cliente e assegnato a un membro dello staff. '
      + 'L\'assegnatario riceve la notifica in-app dal portale.',
    inputSchema: {
      type: 'object',
      properties: {
        title:         { type: 'string' },
        description:   { type: 'string' },
        client:        { type: 'string', description: 'Nome o UUID cliente (opzionale)' },
        assigned_to:   { type: 'string', description: '"me", UUID o nome' },
        priority:      { type: 'string', description: TASK_PRIORITY.join(' | ') },
        category:      { type: 'string', description: TASK_CATEGORY.join(' | ') },
        due_date:      { type: 'string', description: 'YYYY-MM-DD' },
        notify_client: { type: 'boolean', description: 'Notifica anche il cliente nel suo portale' },
      },
      required: ['title'],
    },
    handler: async (args, ctx) => {
      const row = {
        title: String(requireArg(args, 'title')),
        created_by: ctx.profile.id,
      };
      for (const k of ['description', 'due_date', 'notify_client']) {
        if (args?.[k] !== undefined) row[k] = args[k];
      }
      if (args?.priority) {
        if (!TASK_PRIORITY.includes(args.priority)) throw badRequest(`Priorita' non valida: ${args.priority}`);
        row.priority = args.priority;
      }
      if (args?.category) {
        if (!TASK_CATEGORY.includes(args.category)) throw badRequest(`Categoria non valida: ${args.category}`);
        row.category = args.category;
      }
      if (args?.client) row.client_id = (await resolveClient(args, { field: 'client' })).id;
      if (args?.assigned_to) row.assigned_to = (await resolveProfile(args.assigned_to, ctx)).id;

      const task = one(await sbInsert('tasks', [row]));
      if (task.assigned_to && task.assigned_to !== ctx.profile.id) {
        await sbInsert('notifications', [{
          user_id: task.assigned_to,
          type: 'task_assigned',
          title: 'Nuovo task assegnato',
          body: task.title,
          link: `/tasks.html?id=${task.id}`,
          entity_type: 'task',
          entity_id: task.id,
        }]).catch(() => {});
      }
      await logActivity(ctx, 'task_created', { clientId: task.client_id, details: { task_id: task.id, title: task.title } });
      return { task, _rows: 1 };
    },
  },

  {
    name: 'task_update',
    domain: 'tasks',
    write: true,
    title: 'Aggiorna task',
    description:
      'Cambia stato, assegnatario, priorita\', scadenza o testo di un task. '
      + 'Con status "completed" imposta anche completed_at.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:     { type: 'string' },
        status:      { type: 'string', description: TASK_STATUS.join(' | ') },
        assigned_to: { type: 'string' },
        priority:    { type: 'string' },
        due_date:    { type: 'string' },
        title:       { type: 'string' },
        description: { type: 'string' },
      },
      required: ['task_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'task_id');
      const patch = {};
      for (const k of ['priority', 'due_date', 'title', 'description']) {
        if (args?.[k] !== undefined) patch[k] = args[k];
      }
      if (args?.status) {
        if (!TASK_STATUS.includes(args.status)) throw badRequest(`Stato non valido: ${args.status}`);
        patch.status = args.status;
        patch.completed_at = args.status === 'completed' ? new Date().toISOString() : null;
      }
      if (args?.assigned_to !== undefined) {
        patch.assigned_to = args.assigned_to ? (await resolveProfile(args.assigned_to, ctx)).id : null;
      }
      if (!Object.keys(patch).length) throw badRequest('Niente da aggiornare');
      const task = one(await sbUpdate('tasks', { id }, patch));
      if (!task) throw badRequest(`Nessun task con id ${id}`);
      await logActivity(ctx, 'task_updated', { clientId: task.client_id, details: { task_id: id, ...patch } });
      return { task, _rows: 1 };
    },
  },

  {
    name: 'task_comment',
    domain: 'tasks',
    write: true,
    title: 'Commenta un task',
    description: 'Aggiunge un commento a un task e notifica l\'assegnatario.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['task_id', 'content'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'task_id');
      const content = String(requireArg(args, 'content'));
      const task = await sbSelectOne('tasks', { select: 'id,title,assigned_to,created_by', filters: { id } });
      if (!task) throw badRequest(`Nessun task con id ${id}`);
      const comment = one(await sbInsert('task_comments', [{
        task_id: id, author_id: ctx.profile.id, content,
      }]));
      const targets = [task.assigned_to, task.created_by].filter(u => u && u !== ctx.profile.id);
      for (const u of new Set(targets)) {
        await sbInsert('notifications', [{
          user_id: u, type: 'task_comment', title: `Commento su "${task.title}"`,
          body: content.slice(0, 200), link: `/tasks.html?id=${id}`,
          entity_type: 'task', entity_id: id,
        }]).catch(() => {});
      }
      return { commento: comment, _rows: 1 };
    },
  },
];

// ── PIPELINE / LEAD ─────────────────────────────────────────────────────────

const pipelineTools = [
  {
    name: 'pipeline_board',
    domain: 'pipeline',
    title: 'Pipeline commerciale',
    description: 'Fasi della pipeline con i clienti presenti in ciascuna.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const [stages, clients] = await Promise.all([
        sbSelect('pipeline_stages', { select: '*', order: 'position.asc', limit: 100 }),
        sbSelect('clients', {
          select: 'id,company_name,contact_name,service_cost,pipeline_stage_id,is_active',
          filters: { is_active: true }, limit: 500,
        }),
      ]);
      return (stages || []).map(s => ({
        fase: s.name,
        stage_id: s.id,
        posizione: s.position,
        vinta: s.is_won,
        clienti: (clients || []).filter(c => c.pipeline_stage_id === s.id)
          .map(c => ({ id: c.id, cliente: c.company_name, valore_aed: c.service_cost })),
      }));
    },
  },

  {
    name: 'client_set_stage',
    domain: 'pipeline',
    write: true,
    title: 'Sposta un cliente di fase',
    description: 'Assegna un cliente a una fase della pipeline (per nome della fase o stage_id).',
    inputSchema: {
      type: 'object',
      properties: {
        client:    { type: 'string' },
        client_id: { type: 'string' },
        stage:     { type: 'string', description: 'Nome della fase o UUID' },
      },
      required: ['stage'],
    },
    handler: async (args, ctx) => {
      const client = await resolveClient(args);
      const raw = String(requireArg(args, 'stage'));
      let stage;
      if (/^[0-9a-f-]{36}$/i.test(raw)) {
        stage = await sbSelectOne('pipeline_stages', { select: '*', filters: { id: raw } });
      } else {
        const rows = await sbSelect('pipeline_stages', {
          select: '*', filters: { name: { op: 'ilike', value: `*${likeTerm(raw)}*` } }, limit: 5,
        });
        if (rows?.length > 1) throw badRequest(`"${raw}" corrisponde a: ${rows.map(r => r.name).join(', ')}`);
        stage = rows?.[0];
      }
      if (!stage) throw badRequest(`Fase "${raw}" non trovata`);
      await sbUpdate('clients', { id: client.id }, { pipeline_stage_id: stage.id });
      await logActivity(ctx, 'pipeline_stage_changed', { clientId: client.id, details: { fase: stage.name } });
      return { cliente: client.company_name, fase: stage.name, _rows: 1 };
    },
  },

  {
    name: 'leads_list',
    domain: 'leads',
    title: 'Lead',
    description: 'Lead registrate dal sito/chat, con ultima attivita\' e sezioni visitate.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Testo su nome o email' },
        since: { type: 'string', description: 'YYYY-MM-DD: solo lead create da questa data' },
        limit: { type: 'integer', description: 'Default 50' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.since) filters.created_at = { op: 'gte', value: args.since };
      let or;
      if (args?.query) {
        const t = likeTerm(args.query);
        or = `name.ilike.*${t}*,email.ilike.*${t}*`;
      }
      const rows = await sbSelect('leads', {
        select: '*', filters, or, order: 'created_at.desc',
        limit: clampLimit(args?.limit, 50, 300),
      });
      return { trovate: rows?.length ?? 0, lead: rows };
    },
  },
];

// ── SPESE ───────────────────────────────────────────────────────────────────

const expenseTools = [
  {
    name: 'expenses_list',
    domain: 'expenses',
    title: 'Spese clienti',
    description: 'Spese caricate dai clienti, con stato di approvazione, categoria Zoho e IVA.',
    inputSchema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        status: { type: 'string', description: 'pending | approved | posted | rejected | error' },
        since:  { type: 'string', description: 'YYYY-MM-DD sulla data spesa' },
        limit:  { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.client) filters.client_id = (await resolveClient(args, { field: 'client' })).id;
      if (args?.status) filters.status = args.status;
      if (args?.since) filters.expense_date = { op: 'gte', value: args.since };
      const rows = await sbSelect('client_expenses', {
        select: 'id,client_id,vendor,expense_date,amount,currency,vat_amount,status,'
              + 'category_name,paid_with,note,error_msg,created_at,client:clients(company_name)',
        filters, order: 'expense_date.desc', limit: clampLimit(args?.limit, 50, 300),
      });
      const totale = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      return { trovate: rows?.length ?? 0, totale_importi: Math.round(totale * 100) / 100, spese: rows };
    },
  },

  {
    name: 'expense_review',
    domain: 'expenses',
    write: true,
    title: 'Approva o rifiuta una spesa',
    description:
      'Imposta lo stato di una spesa cliente (approved / rejected / pending), registrando chi ha deciso.',
    inputSchema: {
      type: 'object',
      properties: {
        expense_id: { type: 'string' },
        decision:   { type: 'string', description: 'approved | rejected | pending' },
        note:       { type: 'string' },
      },
      required: ['expense_id', 'decision'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'expense_id');
      const decision = String(requireArg(args, 'decision'));
      if (!['approved', 'rejected', 'pending'].includes(decision)) {
        throw badRequest('decision deve essere approved, rejected o pending');
      }
      const patch = { status: decision };
      if (decision === 'approved') {
        patch.approved_by = ctx.profile.id;
        patch.approved_at = new Date().toISOString();
      }
      if (args?.note !== undefined) patch.note = args.note;
      const out = one(await sbUpdate('client_expenses', { id }, patch));
      if (!out) throw badRequest(`Nessuna spesa con id ${id}`);
      await logActivity(ctx, 'expense_reviewed', { clientId: out.client_id, details: { expense_id: id, decision } });
      return { spesa: out, _rows: 1 };
    },
  },
];

// ── FINANCE (solo admin) ────────────────────────────────────────────────────

const financeTools = [
  {
    name: 'finance_summary',
    domain: 'finance',
    title: 'Riepilogo cashflow',
    description:
      'Sintesi mensile del cashflow di gruppo per categoria e conto, dalla view finance_monthly_summary.',
    inputSchema: {
      type: 'object',
      properties: {
        from:  { type: 'string', description: 'YYYY-MM-DD' },
        to:    { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.from) filters.month = { op: 'gte', value: args.from };
      if (args?.to) filters.month = { op: 'lte', value: args.to };
      const rows = await sbSelect('finance_monthly_summary', {
        select: '*', filters, order: 'month.desc', limit: clampLimit(args?.limit, 100, 500),
      });
      return { righe: rows?.length ?? 0, dati: rows };
    },
  },

  {
    name: 'finance_transactions',
    domain: 'finance',
    title: 'Movimenti bancari',
    description:
      'Movimenti del cashflow di gruppo, con filtri su conto, periodo, categoria, importo e testo.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id:  { type: 'string' },
        from:        { type: 'string', description: 'YYYY-MM-DD' },
        to:          { type: 'string', description: 'YYYY-MM-DD' },
        category:    { type: 'string' },
        uncategorized: { type: 'boolean', description: 'true: solo movimenti senza categoria' },
        query:       { type: 'string', description: 'Testo su descrizione o controparte' },
        min_amount:  { type: 'number' },
        limit:       { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.account_id) filters.account_id = args.account_id;
      if (args?.from) filters.txn_date = { op: 'gte', value: args.from };
      if (args?.to && !args?.from) filters.txn_date = { op: 'lte', value: args.to };
      if (args?.category) filters.category = args.category;
      if (args?.uncategorized) filters.category = null;
      if (args?.min_amount !== undefined) filters.amount = { op: 'gte', value: args.min_amount };
      let or;
      if (args?.query) {
        const t = likeTerm(args.query);
        or = `description.ilike.*${t}*,counterparty.ilike.*${t}*`;
      }
      const rows = await sbSelect('finance_transactions', {
        select: '*,account:finance_accounts(label,entity,currency)',
        filters, or, order: 'txn_date.desc', limit: clampLimit(args?.limit, 100, 500),
      });
      const tot = (rows || []).reduce((s, r) => s + Number(r.amount_aed ?? r.amount ?? 0), 0);
      return { movimenti: rows?.length ?? 0, totale_aed: Math.round(tot * 100) / 100, dati: rows };
    },
  },

  {
    name: 'finance_categorize',
    domain: 'finance',
    write: true,
    title: 'Categorizza un movimento',
    description: 'Imposta categoria, flag interno e note di un movimento bancario.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string' },
        category:       { type: 'string' },
        is_internal:    { type: 'boolean' },
        lock:           { type: 'boolean', description: 'true: blocca la categoria contro le regole automatiche' },
        notes:          { type: 'string' },
      },
      required: ['transaction_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'transaction_id');
      const patch = {};
      if (args?.category !== undefined) patch.category = args.category;
      if (args?.is_internal !== undefined) patch.is_internal = !!args.is_internal;
      if (args?.lock !== undefined) patch.category_locked = !!args.lock;
      if (args?.notes !== undefined) patch.notes = args.notes;
      if (!Object.keys(patch).length) throw badRequest('Niente da aggiornare');
      const out = one(await sbUpdate('finance_transactions', { id }, patch));
      if (!out) throw badRequest(`Nessun movimento con id ${id}`);
      await logActivity(ctx, 'finance_categorized', { details: { transaction_id: id, ...patch } });
      return { movimento: out, _rows: 1 };
    },
  },
];

// ── HR: ferie e dipendenti ──────────────────────────────────────────────────

const hrTools = [
  {
    name: 'leave_requests_list',
    domain: 'hr',
    title: 'Richieste di ferie e permessi',
    description:
      'Richieste di ferie, permessi e malattia, con stato e dipendente. '
      + 'Di default mostra quelle da approvare.',
    inputSchema: {
      type: 'object',
      properties: {
        status:   { type: 'string', description: 'pending | approved | rejected | tutti (default pending)' },
        employee: { type: 'string', description: '"me", UUID profilo o nome' },
        from:     { type: 'string', description: 'YYYY-MM-DD: richieste che iniziano da questa data' },
        limit:    { type: 'integer' },
      },
    },
    handler: async (args, ctx) => {
      const filters = {};
      const status = args?.status || 'pending';
      if (status !== 'tutti') filters.status = status;
      if (args?.employee) {
        const p = await resolveProfile(args.employee, ctx);
        const emp = await sbSelectOne('employees', { select: 'id', filters: { profile_id: p.id } });
        if (!emp) throw badRequest(`${p.full_name} non ha una scheda dipendente`);
        filters.employee_id = emp.id;
      }
      if (args?.from) filters.date_from = { op: 'gte', value: args.from };
      const rows = await sbSelect('leave_requests', {
        select: '*,employee:employees(id,annual_leave_days,profile:profiles(id,full_name,role))',
        filters, order: 'date_from.asc', limit: clampLimit(args?.limit, 100, 300),
      });
      return {
        trovate: rows?.length ?? 0,
        richieste: (rows || []).map(r => ({
          id: r.id,
          dipendente: r.employee?.profile?.full_name,
          tipo: r.type,
          dal: r.date_from,
          al: r.date_to,
          giorni: r.days,
          stato: r.status,
          nota_dipendente: r.note_employee,
          nota_admin: r.note_admin,
        })),
      };
    },
  },

  {
    name: 'leave_decide',
    domain: 'hr',
    write: true,
    adminOnly: true,
    title: 'Approva o rifiuta una richiesta di ferie',
    description:
      'Approva o rifiuta una richiesta di ferie/permesso e notifica il dipendente. Solo admin, '
      + 'come nel portale.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        decision:   { type: 'string', description: 'approved | rejected' },
        note:       { type: 'string', description: 'Nota per il dipendente' },
      },
      required: ['request_id', 'decision'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'request_id');
      const decision = String(requireArg(args, 'decision'));
      if (!['approved', 'rejected'].includes(decision)) {
        throw badRequest('decision deve essere approved o rejected');
      }
      const patch = { status: decision };
      if (args?.note !== undefined) patch.note_admin = args.note;
      const out = one(await sbUpdate('leave_requests', { id }, patch));
      if (!out) throw badRequest(`Nessuna richiesta con id ${id}`);
      const emp = await sbSelectOne('employees', { select: 'profile_id', filters: { id: out.employee_id } });
      if (emp?.profile_id) {
        await sbInsert('notifications', [{
          user_id: emp.profile_id,
          type: 'leave_decision',
          title: decision === 'approved' ? 'Richiesta approvata' : 'Richiesta rifiutata',
          body: `${out.type} dal ${out.date_from} al ${out.date_to}${args?.note ? ` — ${args.note}` : ''}`,
          link: '/ferie.html',
          entity_type: 'leave_request',
          entity_id: out.id,
        }]).catch(() => {});
      }
      await logActivity(ctx, 'leave_decided', { details: { request_id: id, decision } });
      return { richiesta: out, _rows: 1 };
    },
  },

  {
    name: 'employees_overview',
    domain: 'hr',
    title: 'Dipendenti e ferie residue',
    description:
      'Elenco dei dipendenti con giorni di ferie annuali, giorni approvati nell\'anno e residuo.',
    inputSchema: {
      type: 'object',
      properties: { year: { type: 'integer', description: 'Default anno corrente' } },
    },
    handler: async (args) => {
      const year = args?.year ? Number(args.year) : currentYearMonth().year;
      const [emps, leaves] = await Promise.all([
        sbSelect('employees', { select: '*,profile:profiles(id,full_name,role)', limit: 200 }),
        sbSelect('leave_requests', {
          select: 'employee_id,type,days,status,date_from',
          filters: {
            status: 'approved',
            date_from: { op: 'gte', value: `${year}-01-01` },
          },
          limit: 1000,
        }),
      ]);
      return (emps || []).map(e => {
        const mine = (leaves || []).filter(l => l.employee_id === e.id && l.date_from <= `${year}-12-31`);
        const ferie = mine.filter(l => l.type === 'ferie').reduce((s, l) => s + Number(l.days || 0), 0);
        const permessi = mine.filter(l => l.type === 'permesso').reduce((s, l) => s + Number(l.days || 0), 0);
        const malattia = mine.filter(l => l.type === 'malattia').reduce((s, l) => s + Number(l.days || 0), 0);
        return {
          employee_id: e.id,
          dipendente: e.profile?.full_name,
          ruolo: e.profile?.role,
          inizio: e.start_date,
          ferie_annuali: e.annual_leave_days,
          ferie_usate: ferie,
          ferie_residue: Number(e.annual_leave_days || 0) - ferie,
          permessi_usati: permessi,
          giorni_malattia: malattia,
        };
      });
    },
  },
];

// ── AMBASSADOR (solo admin) ─────────────────────────────────────────────────

const ambassadorTools = [
  {
    name: 'ambassadors_list',
    domain: 'ambassador',
    title: 'Ambassador',
    description: 'Ambassador con codice referral, stato, moltiplicatore e totali di segnalazioni e commissioni.',
    inputSchema: {
      type: 'object',
      properties: {
        query:  { type: 'string' },
        status: { type: 'string', description: 'active | paused | disabled' },
        limit:  { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.status) filters.status = args.status;
      let or;
      if (args?.query) {
        const t = likeTerm(args.query);
        or = `full_name.ilike.*${t}*,email.ilike.*${t}*,ref_code.ilike.*${t}*`;
      }
      const rows = await sbSelect('ambassador_summary', {
        select: '*', filters, limit: clampLimit(args?.limit, 100, 300),
      }).catch(() => sbSelect('ambassadors', {
        select: '*', filters, or, order: 'created_at.desc', limit: clampLimit(args?.limit, 100, 300),
      }));
      return { trovati: rows?.length ?? 0, ambassador: rows };
    },
  },

  {
    name: 'ambassador_referrals',
    domain: 'ambassador',
    title: 'Segnalazioni ambassador',
    description: 'Segnalazioni arrivate dai link ambassador, con stato e cliente collegato.',
    inputSchema: {
      type: 'object',
      properties: {
        ambassador_id: { type: 'string' },
        status:        { type: 'string', description: 'nuovo | contattato | in_trattativa | cliente | perso' },
        since:         { type: 'string', description: 'YYYY-MM-DD' },
        limit:         { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.ambassador_id) filters.ambassador_id = args.ambassador_id;
      if (args?.status) filters.status = args.status;
      if (args?.since) filters.created_at = { op: 'gte', value: args.since };
      const rows = await sbSelect('ambassador_referrals', {
        select: '*,ambassador:ambassadors(full_name,ref_code),client:clients(id,company_name),'
              + 'service:ambassador_services(name,price_aed)',
        filters, order: 'created_at.desc', limit: clampLimit(args?.limit, 100, 300),
      });
      return { trovate: rows?.length ?? 0, segnalazioni: rows };
    },
  },

  {
    name: 'ambassador_commissions',
    domain: 'ambassador',
    title: 'Commissioni ambassador',
    description: 'Commissioni maturate, pagate o annullate, con totali per stato.',
    inputSchema: {
      type: 'object',
      properties: {
        ambassador_id: { type: 'string' },
        status:        { type: 'string', description: 'maturata | pagata | annullata' },
        limit:         { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.ambassador_id) filters.ambassador_id = args.ambassador_id;
      if (args?.status) filters.status = args.status;
      const rows = await sbSelect('ambassador_commissions', {
        select: '*,ambassador:ambassadors(full_name,ref_code),client:clients(company_name)',
        filters, order: 'earned_at.desc', limit: clampLimit(args?.limit, 200, 500),
      });
      const tot = {};
      for (const r of rows || []) {
        tot[r.status] = Math.round(((tot[r.status] || 0) + Number(r.commission_amount_aed || 0)) * 100) / 100;
      }
      return { righe: rows?.length ?? 0, totali_aed_per_stato: tot, commissioni: rows };
    },
  },

  {
    name: 'commission_set_status',
    domain: 'ambassador',
    write: true,
    title: 'Cambia stato di una commissione',
    description: 'Segna una commissione come pagata, maturata o annullata.',
    inputSchema: {
      type: 'object',
      properties: {
        commission_id: { type: 'string' },
        status:        { type: 'string', description: 'maturata | pagata | annullata' },
        notes:         { type: 'string' },
      },
      required: ['commission_id', 'status'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'commission_id');
      const status = String(requireArg(args, 'status'));
      if (!['maturata', 'pagata', 'annullata'].includes(status)) {
        throw badRequest('status deve essere maturata, pagata o annullata');
      }
      const patch = { status, paid_at: status === 'pagata' ? new Date().toISOString() : null };
      if (args?.notes !== undefined) patch.notes = args.notes;
      const out = one(await sbUpdate('ambassador_commissions', { id }, patch));
      if (!out) throw badRequest(`Nessuna commissione con id ${id}`);
      await logActivity(ctx, 'commission_status_changed', { clientId: out.client_id, details: { id, status } });
      return { commissione: out, _rows: 1 };
    },
  },
];

// ── AFFINITAS ───────────────────────────────────────────────────────────────

const affinitasTools = [
  {
    name: 'affinitas_list',
    domain: 'affinitas',
    title: 'Abbonati Affinitas',
    description: 'Abbonamenti Affinitas con pacchetto, importo, stato e prossimo pagamento.',
    inputSchema: {
      type: 'object',
      properties: {
        query:         { type: 'string' },
        status:        { type: 'string' },
        in_segreteria: { type: 'boolean' },
        due_before:    { type: 'string', description: 'YYYY-MM-DD sul prossimo pagamento' },
        limit:         { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.status) filters.status = args.status;
      if (args?.in_segreteria !== undefined) filters.in_segreteria = args.in_segreteria;
      if (args?.due_before) filters.next_payment = { op: 'lte', value: args.due_before };
      let or;
      if (args?.query) {
        const t = likeTerm(args.query);
        or = `company_name.ilike.*${t}*,subscription_ref.ilike.*${t}*`;
      }
      const rows = await sbSelect('affinitas_subscriptions', {
        select: '*,client:clients(id,company_name)', filters, or,
        order: 'next_payment.asc', limit: clampLimit(args?.limit, 100, 300),
      });
      return { trovati: rows?.length ?? 0, abbonamenti: rows };
    },
  },
];

// ── BACHECA ─────────────────────────────────────────────────────────────────

const boardTools = [
  {
    name: 'board_feed',
    domain: 'board',
    title: 'Bacheca interna',
    description: 'Post della bacheca con autore, allegati e commenti.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:        { type: 'integer', description: 'Default 20' },
        con_commenti: { type: 'boolean', description: 'Default true' },
      },
    },
    handler: async (args) => {
      const limit = clampLimit(args?.limit, 20, 100);
      const posts = await sbSelect('board_posts', {
        select: '*,author:profiles(id,full_name)',
        order: 'pinned.desc,created_at.desc', limit,
      });
      if (args?.con_commenti === false || !posts?.length) return { post: posts };
      const comments = await sbSelect('board_comments', {
        select: '*,author:profiles(id,full_name)',
        filters: { post_id: { op: 'in', value: posts.map(p => p.id) } },
        order: 'created_at.asc', limit: 500,
      });
      return {
        post: posts.map(p => ({
          ...p,
          commenti: (comments || []).filter(c => c.post_id === p.id),
        })),
      };
    },
  },

  {
    name: 'board_post',
    domain: 'board',
    write: true,
    title: 'Pubblica in bacheca',
    description: 'Crea un post in bacheca a nome dell\'utente del token.',
    inputSchema: {
      type: 'object',
      properties: {
        title:  { type: 'string' },
        body:   { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['title'],
    },
    handler: async (args, ctx) => {
      const post = one(await sbInsert('board_posts', [{
        author_id: ctx.profile.id,
        title: String(requireArg(args, 'title')),
        body: args?.body ?? null,
        pinned: !!args?.pinned,
      }]));
      await logActivity(ctx, 'board_post_created', { details: { post_id: post.id } });
      return { post, _rows: 1 };
    },
  },

  {
    name: 'board_comment',
    domain: 'board',
    write: true,
    title: 'Commenta un post in bacheca',
    description: 'Aggiunge un commento a un post della bacheca.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id:  { type: 'string' },
        body:     { type: 'string' },
        reply_to: { type: 'string', description: 'UUID del commento a cui si risponde' },
      },
      required: ['post_id', 'body'],
    },
    handler: async (args, ctx) => {
      const comment = one(await sbInsert('board_comments', [{
        post_id: requireUuid(args, 'post_id'),
        author_id: ctx.profile.id,
        body: String(requireArg(args, 'body')),
        reply_to: args?.reply_to || null,
      }]));
      return { commento: comment, _rows: 1 };
    },
  },
];

// ── NOTIFICHE ───────────────────────────────────────────────────────────────

const notifyTools = [
  {
    name: 'notifications_list',
    domain: 'notify',
    title: 'Notifiche in-app',
    description: 'Notifiche in-app del portale. Per default solo le proprie non lette.',
    inputSchema: {
      type: 'object',
      properties: {
        user:   { type: 'string', description: '"me" (default), UUID o nome. "tutti" per tutte (solo admin)' },
        unread: { type: 'boolean', description: 'Default true' },
        limit:  { type: 'integer' },
      },
    },
    handler: async (args, ctx) => {
      const filters = {};
      const who = args?.user || 'me';
      if (who === 'tutti') {
        if (ctx.role !== 'admin') throw forbidden('Solo un admin puo\' leggere le notifiche di tutti');
      } else {
        filters.user_id = (await resolveProfile(who, ctx)).id;
      }
      if (args?.unread !== false) filters.read = false;
      const rows = await sbSelect('notifications', {
        select: '*,destinatario:profiles(full_name)', filters,
        order: 'created_at.desc', limit: clampLimit(args?.limit, 50, 300),
      });
      return { trovate: rows?.length ?? 0, notifiche: rows };
    },
  },

  {
    name: 'notification_send',
    domain: 'notify',
    write: true,
    title: 'Invia notifica in-app',
    description:
      'Crea una notifica in-app per uno o piu\' membri dello staff (visibile nel portale, '
      + 'campanella in alto). Non invia push: per quello usa push_broadcast.',
    inputSchema: {
      type: 'object',
      properties: {
        users: {
          type: 'array',
          description: 'Destinatari: "me", UUID o nomi. Oppure ["staff"] per tutto lo staff interno.',
          items: { type: 'string' },
        },
        title: { type: 'string' },
        body:  { type: 'string' },
        link:  { type: 'string', description: 'Es. /tasks.html?id=...' },
      },
      required: ['users', 'title'],
    },
    handler: async (args, ctx) => {
      const title = String(requireArg(args, 'title'));
      const list = Array.isArray(args?.users) ? args.users : [args?.users];
      if (!list.length) throw badRequest('Nessun destinatario');
      let ids;
      if (list.length === 1 && String(list[0]).toLowerCase() === 'staff') {
        if (ctx.role !== 'admin') throw forbidden('Solo un admin puo\' notificare tutto lo staff');
        const staff = await sbSelect('profiles', {
          select: 'id',
          filters: { role: { op: 'not_in', value: ['client', 'ambassador'] } },
          limit: 200,
        });
        ids = (staff || []).map(p => p.id);
      } else {
        ids = [];
        for (const u of list) ids.push((await resolveProfile(u, ctx)).id);
      }
      const rows = [...new Set(ids)].map(user_id => ({
        user_id, type: 'mcp_message', title,
        body: args?.body ?? null, link: args?.link ?? null,
      }));
      const out = await sbInsert('notifications', rows);
      await logActivity(ctx, 'notification_sent', { details: { destinatari: rows.length, title } });
      return { inviate: out?.length ?? 0, _rows: out?.length ?? 0 };
    },
  },

  {
    name: 'push_broadcast',
    domain: 'notify',
    pages: ['broadcast'],
    write: true,
    title: 'Invia una push',
    description:
      'Invia una notifica push via OneSignal a tutti, a un cliente specifico o a una company. '
      + 'Richiede l\'accesso alla pagina Broadcast.',
    inputSchema: {
      type: 'object',
      properties: {
        target:  { type: 'string', description: 'all | client | company (default all)' },
        client_id: { type: 'string', description: 'Richiesto con target "client"' },
        company:   { type: 'string', description: 'Richiesto con target "company"' },
        title:   { type: 'string' },
        message: { type: 'string' },
        url:     { type: 'string' },
      },
      required: ['title', 'message'],
    },
    handler: async (args, ctx) => {
      const title = String(requireArg(args, 'title'));
      const message = String(requireArg(args, 'message'));
      const target = args?.target || 'all';
      const payload = { title, message, url: args?.url };
      if (target === 'client') {
        payload.action = 'send_to_user';
        payload.user_id = requireUuid(args, 'client_id');
      } else if (target === 'company') {
        payload.action = 'send_to_company';
        payload.company = String(requireArg(args, 'company'));
      } else {
        payload.action = 'send_to_all';
      }
      const res = await sbFunction('send-notification', payload);
      await logActivity(ctx, 'push_broadcast', { details: { target, title } });
      return { esito: res, _rows: 1 };
    },
  },
];

// ── DOCUMENTI ───────────────────────────────────────────────────────────────

const documentTools = [
  {
    name: 'documents_list',
    domain: 'documents',
    title: 'Documenti',
    description: 'Documenti caricati nel portale, per cliente o cartella.',
    inputSchema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        folder: { type: 'string' },
        query:  { type: 'string', description: 'Testo sul nome del file' },
        limit:  { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.client) filters.client_id = (await resolveClient(args, { field: 'client' })).id;
      if (args?.folder) filters.folder = args.folder;
      let or;
      if (args?.query) {
        const t = likeTerm(args.query);
        or = `display_name.ilike.*${t}*,original_name.ilike.*${t}*`;
      }
      const rows = await sbSelect('client_files', {
        select: 'id,client_id,display_name,original_name,folder,mime_type,file_size,notes,'
              + 'storage_path,created_at,client:clients(company_name)',
        filters, or, order: 'created_at.desc', limit: clampLimit(args?.limit, 50, 300),
      });
      return { trovati: rows?.length ?? 0, documenti: rows };
    },
  },

  {
    name: 'document_link',
    domain: 'documents',
    title: 'Link temporaneo a un documento',
    description:
      'Genera un URL firmato per scaricare un documento del portale. Il link scade (default 1 ora).',
    inputSchema: {
      type: 'object',
      properties: {
        file_id:    { type: 'string', description: 'UUID della riga client_files' },
        expires_in: { type: 'integer', description: 'Secondi di validita\', default 3600, max 86400' },
      },
      required: ['file_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'file_id');
      const file = await sbSelectOne('client_files', {
        select: 'id,display_name,storage_path,client_id', filters: { id },
      });
      if (!file) throw badRequest(`Nessun documento con id ${id}`);
      const ttl = clampLimit(args?.expires_in, 3600, 86400);
      const url = await sbSignedUrl('client-documents', file.storage_path, ttl);
      await logActivity(ctx, 'document_link_created', { clientId: file.client_id, details: { file_id: id } });
      return { documento: file.display_name, url, scade_in_secondi: ttl };
    },
  },
];

// ── REPORT ──────────────────────────────────────────────────────────────────

const reportTools = [
  {
    name: 'dashboard_kpis',
    domain: 'reports',
    title: 'KPI della dashboard',
    description:
      'Gli stessi indicatori della home del portale: clienti attivi, estratti mancanti, '
      + 'abbonamenti con problemi, scadenze VAT nei prossimi 30 giorni.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const rows = await sbSelect('dashboard_current_month', { select: '*', limit: 1 });
      return one(rows) || {};
    },
  },

  {
    name: 'monthly_report',
    domain: 'reports',
    title: 'Report mensile',
    description:
      'Riepilogo di un mese: incassi abbonamenti per stato, estratti conto ricevuti/registrati, '
      + 'task chiusi e aperti, spese approvate.',
    inputSchema: { type: 'object', properties: { ...ymProps } },
    handler: async (args, ctx) => {
      const { year, month } = ym(args);
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(Date.UTC(year, month, 1));
      const end = endDate.toISOString().slice(0, 10);
      const out = { periodo: `${month}/${year}` };

      const jobs = [];
      if (can(ctx, 'payments')) {
        jobs.push(sbSelect('subscription_payments', {
          select: 'status,amount', filters: { year, month }, limit: 1000,
        }).then(rows => {
          const perStato = {};
          let incassato = 0;
          for (const r of rows || []) {
            perStato[r.status] = (perStato[r.status] || 0) + 1;
            if (['ok', 'manual', 'annual'].includes(r.status)) incassato += Number(r.amount || 0);
          }
          out.abbonamenti = { per_stato: perStato, incassato_aed: Math.round(incassato * 100) / 100 };
        }));
      }
      if (can(ctx, 'statements')) {
        jobs.push(sbSelect('bank_statements', {
          select: 'received,registered', filters: { year, month }, limit: 1000,
        }).then(rows => {
          out.estratti_conto = {
            righe: rows?.length ?? 0,
            ricevuti: (rows || []).filter(r => r.received).length,
            registrati: (rows || []).filter(r => r.registered).length,
          };
        }));
      }
      if (can(ctx, 'tasks')) {
        jobs.push(Promise.all([
          sbSelect('tasks', {
            select: 'id', filters: { status: 'completed', completed_at: { op: 'gte', value: start } }, limit: 1000,
          }),
          sbSelect('tasks', {
            select: 'id', filters: { status: { op: 'in', value: ['open', 'in_progress'] } }, limit: 1000,
          }),
        ]).then(([done, open]) => {
          out.task = { chiusi_nel_mese: done?.length ?? 0, ancora_aperti: open?.length ?? 0 };
        }));
      }
      if (can(ctx, 'expenses')) {
        jobs.push(sbSelect('client_expenses', {
          select: 'amount,status',
          filters: { expense_date: { op: 'gte', value: start } }, limit: 1000,
        }).then(rows => {
          const inMese = (rows || []);
          out.spese = {
            caricate: inMese.length,
            approvate: inMese.filter(r => ['approved', 'posted'].includes(r.status)).length,
            totale_aed: Math.round(inMese.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100,
          };
        }));
      }
      await Promise.all(jobs);
      out.fine_periodo = end;
      return out;
    },
  },

  {
    name: 'activity_log_list',
    domain: 'reports',
    title: 'Audit trail del portale',
    description: 'Attivita\' registrate nel portale, filtrabili per utente, cliente, azione e periodo.',
    inputSchema: {
      type: 'object',
      properties: {
        user:   { type: 'string', description: '"me", UUID o nome' },
        client: { type: 'string' },
        action: { type: 'string' },
        since:  { type: 'string', description: 'YYYY-MM-DD' },
        limit:  { type: 'integer' },
      },
    },
    handler: async (args, ctx) => {
      const filters = {};
      if (args?.user) filters.user_id = (await resolveProfile(args.user, ctx)).id;
      if (args?.client) filters.client_id = (await resolveClient(args, { field: 'client' })).id;
      if (args?.action) filters.action = args.action;
      if (args?.since) filters.created_at = { op: 'gte', value: args.since };
      const rows = await sbSelect('activity_log', {
        select: '*,user:profiles(full_name,role),client:clients(company_name)',
        filters, order: 'created_at.desc', limit: clampLimit(args?.limit, 100, 500),
      });
      return { righe: rows?.length ?? 0, attivita: rows };
    },
  },
];

// ── UTENTI E PERMESSI (solo admin) ──────────────────────────────────────────

const PORTAL_ROLES = ['admin', 'senior', 'junior', 'mini_admin', 'collaborator', 'staff'];

const userTools = [
  {
    name: 'users_list',
    domain: 'users',
    title: 'Utenti del portale',
    description: 'Profili interni con ruolo e data di creazione.',
    inputSchema: {
      type: 'object',
      properties: {
        role:  { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
    handler: async (args) => {
      const filters = {};
      if (args?.role) filters.role = args.role;
      if (args?.query) {
        filters.full_name = { op: 'ilike', value: `*${likeTerm(args.query)}*` };
      }
      const rows = await sbSelect('profiles', {
        select: 'id,full_name,role,created_at,updated_at', filters,
        order: 'full_name.asc', limit: clampLimit(args?.limit, 100, 300),
      });
      return { utenti: rows };
    },
  },

  {
    name: 'user_create',
    domain: 'users',
    write: true,
    adminOnly: true,
    title: 'Crea utente interno',
    description:
      'Crea un account staff (auth + profilo) con un ruolo del portale. '
      + 'Per clienti e ambassador usa le rispettive aree del portale.',
    inputSchema: {
      type: 'object',
      properties: {
        email:     { type: 'string' },
        password:  { type: 'string', description: 'Almeno 8 caratteri' },
        full_name: { type: 'string' },
        role:      { type: 'string', description: PORTAL_ROLES.join(' | ') },
      },
      required: ['email', 'password', 'full_name', 'role'],
    },
    handler: async (args, ctx) => {
      const email = String(requireArg(args, 'email'));
      const password = String(requireArg(args, 'password'));
      const full_name = String(requireArg(args, 'full_name'));
      const role = String(requireArg(args, 'role'));
      if (!PORTAL_ROLES.includes(role)) {
        throw badRequest(`Ruolo non valido. Ammessi: ${PORTAL_ROLES.join(', ')}`);
      }
      if (password.length < 8) throw badRequest('La password deve avere almeno 8 caratteri');
      const created = await sbAuthAdmin('users', {
        method: 'POST',
        body: { email, password, email_confirm: true, user_metadata: { full_name, role } },
      });
      if (!created?.id) throw badRequest(`Creazione utente fallita: ${created?.msg || created?.message || 'errore'}`);
      await new Promise(r => setTimeout(r, 800));
      await sbInsert('profiles', [{ id: created.id, full_name, role }], { upsertOn: 'id' });
      await logActivity(ctx, 'user_created', { details: { email, role } });
      return { id: created.id, email, full_name, role, _rows: 1 };
    },
  },

  {
    name: 'user_set_role',
    domain: 'users',
    write: true,
    adminOnly: true,
    title: 'Cambia ruolo di un utente',
    description: 'Imposta il ruolo di un profilo interno. Non puoi cambiare il tuo stesso ruolo.',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: 'UUID o nome' },
        role: { type: 'string', description: PORTAL_ROLES.join(' | ') },
      },
      required: ['user', 'role'],
    },
    handler: async (args, ctx) => {
      const p = await resolveProfile(String(requireArg(args, 'user')), ctx);
      const role = String(requireArg(args, 'role'));
      if (!PORTAL_ROLES.includes(role)) {
        throw badRequest(`Ruolo non valido. Ammessi: ${PORTAL_ROLES.join(', ')}`);
      }
      if (p.id === ctx.profile.id) throw forbidden('Non puoi cambiare il tuo stesso ruolo');
      const out = one(await sbUpdate('profiles', { id: p.id }, { role }));
      await sbAuthAdmin(`users/${p.id}`, { method: 'PUT', body: { user_metadata: { role } } }).catch(() => {});
      await logActivity(ctx, 'user_role_changed', { details: { user_id: p.id, role } });
      return { utente: out, _rows: 1 };
    },
  },

  {
    name: 'user_reset_password',
    domain: 'users',
    write: true,
    adminOnly: true,
    title: 'Imposta una nuova password',
    description: 'Sostituisce la password di un utente interno. Comunicala tu all\'interessato.',
    inputSchema: {
      type: 'object',
      properties: {
        user:         { type: 'string', description: 'UUID o nome' },
        new_password: { type: 'string', description: 'Almeno 8 caratteri' },
      },
      required: ['user', 'new_password'],
    },
    handler: async (args, ctx) => {
      const p = await resolveProfile(String(requireArg(args, 'user')), ctx);
      const pwd = String(requireArg(args, 'new_password'));
      if (pwd.length < 8) throw badRequest('La password deve avere almeno 8 caratteri');
      await sbAuthAdmin(`users/${p.id}`, { method: 'PUT', body: { password: pwd } });
      await logActivity(ctx, 'user_password_reset', { details: { user_id: p.id } });
      return { utente: p.full_name, esito: 'password aggiornata', _rows: 1 };
    },
  },

  {
    name: 'role_permissions_get',
    domain: 'users',
    title: 'Matrice dei permessi per ruolo',
    description:
      'Pagine del portale abilitate per ogni ruolo (tabella role_permissions). '
      + 'Un array vuoto significa "tutte le pagine".',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const rows = await sbSelect('role_permissions', { select: '*', limit: 50 }).catch(() => []);
      return { permessi: rows };
    },
  },

  {
    name: 'role_permissions_set',
    domain: 'users',
    write: true,
    adminOnly: true,
    title: 'Modifica i permessi di un ruolo',
    description:
      'Imposta le pagine abilitate per un ruolo. Array vuoto = tutte le pagine. '
      + 'Vale anche per i tool MCP: cambiare qui cambia cosa quel ruolo vede da Claude.',
    inputSchema: {
      type: 'object',
      properties: {
        role:  { type: 'string', description: PORTAL_ROLES.join(' | ') },
        pages: { type: 'array', description: 'Id pagina, es. ["index","tasks","clients"]', items: { type: 'string' } },
      },
      required: ['role', 'pages'],
    },
    handler: async (args, ctx) => {
      const role = String(requireArg(args, 'role'));
      if (!PORTAL_ROLES.includes(role)) throw badRequest(`Ruolo non valido. Ammessi: ${PORTAL_ROLES.join(', ')}`);
      if (!Array.isArray(args?.pages)) throw badRequest('pages deve essere un array');
      const out = one(await sbInsert('role_permissions', [{ role, allowed_pages: args.pages }], { upsertOn: 'role' }));
      await logActivity(ctx, 'role_permissions_changed', { details: { role, pages: args.pages } });
      return { permessi: out, _rows: 1 };
    },
  },
];

// ── AMMINISTRAZIONE MCP ─────────────────────────────────────────────────────

const adminTools = [
  {
    name: 'mcp_tokens_list',
    domain: 'admin',
    adminOnly: true,
    title: 'Token MCP attivi',
    description: 'Token MCP emessi, con utente, scope, permessi di scrittura, uso e scadenza.',
    inputSchema: {
      type: 'object',
      properties: { include_revoked: { type: 'boolean', description: 'Default false' } },
    },
    handler: async (args) => {
      const filters = args?.include_revoked ? {} : { revoked_at: null };
      const rows = await sbSelect('mcp_tokens', {
        select: 'id,name,token_prefix,scope,can_write,allowed_tools,expires_at,last_used_at,'
              + 'calls_count,revoked_at,created_at,profile:profiles(full_name,role)',
        filters, order: 'created_at.desc', limit: 200,
      });
      return { token: rows };
    },
  },

  {
    name: 'mcp_token_revoke',
    domain: 'admin',
    write: true,
    adminOnly: true,
    title: 'Revoca un token MCP',
    description: 'Disattiva immediatamente un token MCP. Operazione non reversibile.',
    inputSchema: {
      type: 'object',
      properties: { token_id: { type: 'string' } },
      required: ['token_id'],
    },
    handler: async (args, ctx) => {
      const id = requireUuid(args, 'token_id');
      if (id === ctx.token.id) throw badRequest('Non revocare il token che stai usando: fallo dal portale');
      const out = one(await sbUpdate('mcp_tokens', { id }, { revoked_at: new Date().toISOString() }));
      if (!out) throw badRequest(`Nessun token con id ${id}`);
      await logActivity(ctx, 'mcp_token_revoked', { details: { token_id: id, name: out.name } });
      return { revocato: { id: out.id, name: out.name }, _rows: 1 };
    },
  },

  {
    name: 'mcp_audit',
    domain: 'admin',
    adminOnly: true,
    title: 'Audit delle chiamate MCP',
    description: 'Ultime chiamate ai tool MCP: chi, cosa, con quali argomenti e con che esito.',
    inputSchema: {
      type: 'object',
      properties: {
        tool:       { type: 'string' },
        user:       { type: 'string', description: '"me", UUID o nome' },
        only_errors:{ type: 'boolean' },
        since:      { type: 'string', description: 'YYYY-MM-DD' },
        limit:      { type: 'integer', description: 'Default 50' },
      },
    },
    handler: async (args, ctx) => {
      const filters = {};
      if (args?.tool) filters.tool = args.tool;
      if (args?.user) filters.profile_id = (await resolveProfile(args.user, ctx)).id;
      if (args?.only_errors) filters.ok = false;
      if (args?.since) filters.created_at = { op: 'gte', value: args.since };
      const rows = await sbSelect('mcp_audit_log', {
        select: '*,profile:profiles(full_name,role)', filters,
        order: 'created_at.desc', limit: clampLimit(args?.limit, 50, 300),
      });
      return { righe: rows?.length ?? 0, chiamate: rows };
    },
  },
];

// ── RICERCA TRASVERSALE ─────────────────────────────────────────────────────

const searchTools = [
  {
    name: 'search_everything',
    domain: 'core',
    title: 'Ricerca globale',
    description:
      'Cerca un testo in tutto il portale: clienti, task, lead, documenti, ambassador, bacheca. '
      + 'Interroga solo le aree che il ruolo della sessione puo\' vedere.',
    inputSchema: {
      type: 'object',
      properties: {
        query:    { type: 'string' },
        per_area: { type: 'integer', description: 'Risultati massimi per area, default 10' },
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      const t = likeTerm(requireArg(args, 'query'));
      if (t.length < 2) throw badRequest('Servono almeno 2 caratteri');
      const n = clampLimit(args?.per_area, 10, 50);
      const out = {};
      const jobs = [];

      if (can(ctx, 'clients')) {
        jobs.push(sbSelect('clients', {
          select: 'id,company_name,contact_name,email,is_active',
          or: `company_name.ilike.*${t}*,contact_name.ilike.*${t}*,email.ilike.*${t}*,notes.ilike.*${t}*`,
          limit: n,
        }).then(r => { if (r?.length) out.clienti = r; }));
      }
      if (can(ctx, 'tasks')) {
        jobs.push(sbSelect('tasks', {
          select: 'id,title,status,priority,due_date,client_id',
          or: `title.ilike.*${t}*,description.ilike.*${t}*`, limit: n,
        }).then(r => { if (r?.length) out.task = r; }));
      }
      if (can(ctx, 'leads')) {
        jobs.push(sbSelect('leads', {
          select: 'id,name,email,phone,created_at',
          or: `name.ilike.*${t}*,email.ilike.*${t}*`, limit: n,
        }).then(r => { if (r?.length) out.lead = r; }).catch(() => {}));
      }
      if (can(ctx, 'documents')) {
        jobs.push(sbSelect('client_files', {
          select: 'id,display_name,folder,client_id',
          or: `display_name.ilike.*${t}*,original_name.ilike.*${t}*,notes.ilike.*${t}*`, limit: n,
        }).then(r => { if (r?.length) out.documenti = r; }));
      }
      if (can(ctx, 'ambassador')) {
        jobs.push(sbSelect('ambassadors', {
          select: 'id,full_name,email,ref_code,status',
          or: `full_name.ilike.*${t}*,email.ilike.*${t}*,ref_code.ilike.*${t}*`, limit: n,
        }).then(r => { if (r?.length) out.ambassador = r; }));
      }
      if (can(ctx, 'board')) {
        jobs.push(sbSelect('board_posts', {
          select: 'id,title,created_at',
          or: `title.ilike.*${t}*,body.ilike.*${t}*`, limit: n,
        }).then(r => { if (r?.length) out.bacheca = r; }));
      }
      if (can(ctx, 'expenses')) {
        jobs.push(sbSelect('client_expenses', {
          select: 'id,vendor,amount,currency,expense_date,status,client_id',
          or: `vendor.ilike.*${t}*,note.ilike.*${t}*`, limit: n,
        }).then(r => { if (r?.length) out.spese = r; }));
      }
      await Promise.all(jobs);
      const totale = Object.values(out).reduce((s, v) => s + v.length, 0);
      return { cercato: t, risultati: totale, per_area: out };
    },
  },
];

export const bizToolsPart2 = [
  ...taskTools, ...pipelineTools, ...expenseTools, ...financeTools, ...hrTools,
  ...ambassadorTools, ...affinitasTools, ...boardTools, ...notifyTools,
  ...documentTools, ...reportTools, ...userTools, ...adminTools, ...searchTools,
];
