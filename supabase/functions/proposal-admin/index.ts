// ============================================================
// Edge Function "proposal-admin" — lato amministratore del modulo Proposte
// ============================================================
// Richiede il login del portale: il JWT viene verificato davvero
// (auth.getUser), non solo decodificato. Le azioni che cambiano qualcosa
// sono riservate all'admin; lo staff può solo vedere i file.
//
// Azioni (POST JSON { action, ... }):
//   config                 provider dei codici, firma di controfirma salvata
//   extract                lettura AI del PDF -> dati proposti
//   create                 bozza con PDF originale e destinatari
//   add_page               carica l'immagine di una pagina (resa nel browser)
//   publish                fissa il contenuto, attiva il link, pipeline
//   delete_draft           elimina una bozza mai pubblicata
//   link                   ricopia il link
//   revoke | extend | regenerate_link
//   files                  URL firmati di breve durata per l'anteprima
//   save_countersignature  salva la firma di chi controfirma
//   countersign            controfirma, PDF finale, email, client_files, pipeline
//   verify_log             verifica la catena di hash del registro
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.132.1';
import { betaZodOutputFormat } from 'npm:@anthropic-ai/sdk@0.132.1/helpers/beta/zod';
import { z } from 'npm:zod@4.1.12';

import { BRAND, BUCKET, CONSENT_TEXT, CONSENT_VERSION, env, PORTAL_URL, SERVICE_KEY, SUPABASE_URL } from '../_shared/proposals/env.ts';
import { b64Decode, decryptString, encryptString, randomToken, sha256Hex } from '../_shared/proposals/crypto.ts';
import { CORS, dubaiTime, EMAIL_RE, escapeHtml, formatAmount, HttpError, json, normalizePhone, reqCtx, type ReqCtx } from '../_shared/proposals/util.ts';
import { logEvent } from '../_shared/proposals/events.ts';
import { notifyStaff } from '../_shared/proposals/notify.ts';
import { sendEmail } from '../_shared/proposals/email.ts';
import { buildFinalPdf, type SignatureInfo } from '../_shared/proposals/final-pdf.ts';
import { getOtpProvider } from '../_shared/proposals/otp.ts';

const LINK_KEY = env('PROPOSAL_LINK_KEY');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface Caller { userId: string; role: string; name: string; email: string | null }

async function authenticate(req: Request): Promise<Caller> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthorized', 'Login richiesto');
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'unauthorized', 'Sessione non valida o scaduta');
  const { data: prof } = await sb.from('profiles').select('role, full_name').eq('id', data.user.id).maybeSingle();
  const role = String(prof?.role || '');
  if (!role || role === 'client' || role === 'ambassador') throw new HttpError(403, 'forbidden', 'Riservato allo staff');
  return { userId: data.user.id, role, name: prof?.full_name || data.user.email || 'Staff', email: data.user.email || null };
}

function requireAdmin(c: Caller) {
  if (c.role !== 'admin') throw new HttpError(403, 'forbidden', 'Solo l\'admin può gestire le proposte');
}

const linkFor = (token: string) => `${PORTAL_URL}/p/${token}`;

async function loadProposal(id: unknown): Promise<Row> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'bad_request', 'id proposta non valido');
  const { data, error } = await sb.from('proposals').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'not_found', 'Proposta non trovata');
  return data;
}

async function upload(path: string, bytes: Uint8Array, contentType: string, upsert = false, bucket = BUCKET) {
  const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert });
  if (error) throw new Error(`Storage ${bucket}/${path}: ${error.message}`);
}

async function download(path: string, bucket = BUCKET): Promise<Uint8Array> {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Download ${path}: ${error?.message || 'vuoto'}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function stageId(key: 'proposals_stage_sent' | 'proposals_stage_signed'): Promise<string | null> {
  const { data } = await sb.from('app_config').select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}

async function moveClientToStage(clientId: string, key: 'proposals_stage_sent' | 'proposals_stage_signed', actor: string | null) {
  const id = await stageId(key);
  if (!id) return;
  const { error } = await sb.from('clients').update({ pipeline_stage_id: id }).eq('id', clientId);
  if (!error) {
    await sb.from('activity_log').insert({ user_id: actor, client_id: clientId, action: 'client_stage_moved', details: { stage_id: id, source: 'proposte' } })
      .then(() => {}, () => {});
  }
}

const isPdf = (b: Uint8Array) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

// ── Lettura AI del PDF ─────────────────────────────────────
const Extraction = z.object({
  client_name: z.string().describe('Nome e cognome della persona a cui è indirizzata la proposta, o ragione sociale se non c\'è una persona. Stringa vuota se assente.'),
  company_name: z.string().describe('Ragione sociale del cliente, se presente. Stringa vuota se assente.'),
  phone_e164: z.string().describe('Telefono del cliente in formato E.164 con prefisso internazionale (es. +971501234567). Stringa vuota se assente o se il prefisso non è ricavabile con certezza.'),
  email: z.string().describe('Email del cliente. Stringa vuota se assente.'),
  title: z.string().describe('Titolo breve e chiaro della proposta (max 120 caratteri), nella lingua del documento.'),
  amount: z.number().nullable().describe('Importo totale della proposta (numero, senza simboli). null se non è indicato un totale univoco.'),
  currency: z.string().describe('Codice valuta ISO 4217 a 3 lettere (AED, EUR, USD...). Stringa vuota se assente.'),
  language: z.enum(['it', 'en']).describe('Lingua principale del documento.'),
  notes: z.string().describe('Dubbi o ambiguità utili a chi controlla i dati (es. più importi, più destinatari). Stringa vuota se nessuno.'),
});

async function extractWithAI(pdf: Uint8Array) {
  if (!env('ANTHROPIC_API_KEY')) throw new HttpError(503, 'ai_unavailable', 'ANTHROPIC_API_KEY non configurata');
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  let b64 = '';
  const CH = 0x8000;
  for (let i = 0; i < pdf.length; i += CH) b64 += String.fromCharCode(...pdf.subarray(i, i + CH));
  b64 = btoa(b64);

  const res = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Extraction) },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text:
          'Questo PDF è una proposta commerciale di PB TAX (studio di consulenza fiscale a Dubai) indirizzata a un cliente. ' +
          'Estrai i dati del CLIENTE destinatario, non quelli di PB TAX o di InDubai (ignora indirizzi, telefoni ed email dello studio). ' +
          'Un collaboratore controllerà e correggerà i dati prima dell\'invio: se un dato non c\'è o non è certo, lascialo vuoto e spiegalo in notes invece di indovinarlo.' },
      ],
    }],
  });
  if (res.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused', 'Il modello non ha elaborato il documento: compila i dati a mano.');
  const out = res.parsed_output;
  if (!out) throw new HttpError(422, 'ai_unparsed', 'Lettura AI non riuscita: compila i dati a mano.');
  return {
    ...out,
    phone_e164: normalizePhone(out.phone_e164) || '',
    email: EMAIL_RE.test(out.email || '') ? out.email.toLowerCase() : '',
    currency: /^[A-Z]{3}$/.test(out.currency || '') ? out.currency : '',
    model: res.model,
  };
}

// ── Validazione destinatari ────────────────────────────────
function cleanRecipients(raw: unknown) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, 'bad_request', 'Serve almeno un destinatario');
  if (raw.length > 10) throw new HttpError(400, 'bad_request', 'Massimo 10 destinatari');
  const seen = new Set<string>();
  const list = raw.map((r: Row, i: number) => {
    const full_name = String(r?.full_name || '').trim().slice(0, 160);
    const phone = normalizePhone(r?.phone);
    const email = String(r?.email || '').trim().toLowerCase();
    if (!full_name) throw new HttpError(400, 'bad_request', `Destinatario ${i + 1}: nome mancante`);
    if (!phone) throw new HttpError(400, 'bad_request', `Destinatario ${i + 1}: telefono non valido (serve il prefisso, es. +971...)`);
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'bad_request', `Destinatario ${i + 1}: email non valida`);
    if (seen.has(phone)) throw new HttpError(400, 'bad_request', `Numero ripetuto: ${phone}`);
    seen.add(phone);
    return { full_name, phone_e164: phone, email: email || null, can_sign: r?.can_sign === true, position: i };
  });
  if (!list.some((r) => r.can_sign)) throw new HttpError(400, 'bad_request', 'Indica almeno un destinatario che può firmare');
  return list;
}

// ── Azioni ─────────────────────────────────────────────────

async function actConfig(c: Caller) {
  const { data } = await sb.from('proposal_countersigners').select('display_name, role_title, updated_at').eq('user_id', c.userId).maybeSingle();
  const provider = getOtpProvider(sb).name;
  return { otp_provider: provider, recipients_need_email: provider === 'email', countersignature: data || null, is_admin: c.role === 'admin' };
}

async function actCreate(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const clientId = String(b.client_id || '');
  const { data: client } = await sb.from('clients').select('id, company_name').eq('id', clientId).maybeSingle();
  if (!client) throw new HttpError(404, 'not_found', 'Cliente non trovato');

  const title = String(b.title || '').trim().slice(0, 300);
  if (!title) throw new HttpError(400, 'bad_request', 'Titolo obbligatorio');
  const amount = b.amount === null || b.amount === '' || b.amount === undefined ? null : Number(b.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new HttpError(400, 'bad_request', 'Importo non valido');
  const currency = String(b.currency || 'AED').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'bad_request', 'Valuta non valida');
  const locale = b.locale === 'en' ? 'en' : 'it';
  const days = Math.round(Number(b.expires_in_days));
  if (!(days >= 1 && days <= 365)) throw new HttpError(400, 'bad_request', 'Scadenza tra 1 e 365 giorni');
  const pageCount = Math.round(Number(b.page_count));
  if (!(pageCount >= 1 && pageCount <= 200)) throw new HttpError(400, 'bad_request', 'Numero di pagine non valido');
  const recipients = cleanRecipients(b.recipients);
  if (getOtpProvider(sb).name === 'email' && recipients.some((r) => !r.email)) {
    throw new HttpError(400, 'bad_request', 'Con i codici via email ogni destinatario deve avere un\'email');
  }

  const pdf = b64Decode(String(b.pdf_base64 || ''));
  if (!isPdf(pdf)) throw new HttpError(400, 'bad_request', 'Il file non è un PDF');
  if (pdf.length > 30 * 1024 * 1024) throw new HttpError(400, 'bad_request', 'PDF oltre 30 MB');
  const pdfSha = await sha256Hex(pdf);

  const id = crypto.randomUUID();
  const token = randomToken(32);
  const pdfPath = `${id}/original.pdf`;
  await upload(pdfPath, pdf, 'application/pdf');

  const { error } = await sb.from('proposals').insert({
    id, client_id: clientId, title, amount, currency, locale, status: 'draft',
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
    link_token_hash: await sha256Hex(token),
    link_token_enc: await encryptString(LINK_KEY, token),
    original_pdf_path: pdfPath,
    original_pdf_name: String(b.pdf_name || '').slice(0, 200) || null,
    original_pdf_sha256: pdfSha,
    page_count: pageCount,
    ai_extraction: b.ai_extraction && typeof b.ai_extraction === 'object' ? b.ai_extraction : null,
    created_by: c.userId,
  });
  if (error) {
    await sb.storage.from(BUCKET).remove([pdfPath]);
    throw new Error(error.message);
  }
  const { error: rErr } = await sb.from('proposal_recipients').insert(recipients.map((r) => ({ ...r, proposal_id: id })));
  if (rErr) {
    await sb.from('proposals').delete().eq('id', id);
    await sb.storage.from(BUCKET).remove([pdfPath]);
    throw new HttpError(400, 'bad_request', rErr.message);
  }
  void ctx;
  return { id, original_pdf_sha256: pdfSha };
}

async function actAddPage(c: Caller, b: Row) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (p.status !== 'draft') throw new HttpError(409, 'conflict', 'Le pagine si caricano solo in bozza');
  const n = Math.round(Number(b.n));
  if (!(n >= 1 && n <= p.page_count)) throw new HttpError(400, 'bad_request', 'Numero pagina non valido');
  const img = b64Decode(String(b.jpeg_base64 || ''));
  if (!isJpeg(img)) throw new HttpError(400, 'bad_request', 'La pagina deve essere un JPEG');
  if (img.length > 6 * 1024 * 1024) throw new HttpError(400, 'bad_request', 'Pagina troppo pesante');
  const w = Math.round(Number(b.w)), h = Math.round(Number(b.h));
  const path = `${p.id}/pages/${String(n).padStart(3, '0')}.jpg`;
  await upload(path, img, 'image/jpeg', true);
  const entry = { n, path, w, h, sha256: await sha256Hex(img) };
  const pages = (Array.isArray(p.pages) ? p.pages : []).filter((x: Row) => x.n !== n).concat(entry).sort((a: Row, z: Row) => a.n - z.n);
  const { error } = await sb.from('proposals').update({ pages }).eq('id', p.id).eq('status', 'draft');
  if (error) throw new Error(error.message);
  return { ok: true, pages: pages.length };
}

async function actPublish(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (p.status !== 'draft') throw new HttpError(409, 'conflict', 'Proposta già pubblicata');
  const pages: Row[] = Array.isArray(p.pages) ? p.pages : [];
  if (pages.length !== p.page_count || pages.some((x, i) => x.n !== i + 1)) {
    throw new HttpError(409, 'conflict', `Pagine caricate ${pages.length} su ${p.page_count}`);
  }
  const pagesSha = await sha256Hex(pages.map((x) => `${x.n}:${x.sha256}`).join('\n') + `\npdf:${p.original_pdf_sha256}`);
  const now = new Date().toISOString();
  const { error } = await sb.from('proposals').update({ status: 'sent', sent_at: now, pages_sha256: pagesSha }).eq('id', p.id).eq('status', 'draft');
  if (error) throw new Error(error.message);

  const { data: recs } = await sb.from('proposal_recipients').select('full_name, phone_e164, can_sign').eq('proposal_id', p.id);
  await logEvent(sb, {
    proposal_id: p.id, client_id: p.client_id, event_type: 'published', actor_type: 'staff', actor_user_id: c.userId, ctx,
    details: {
      title: p.title, amount: p.amount, currency: p.currency, expires_at: p.expires_at,
      original_pdf_sha256: p.original_pdf_sha256, pages_sha256: pagesSha, page_count: p.page_count,
      recipients: (recs || []).map((r: Row) => ({ name: r.full_name, phone: r.phone_e164, can_sign: r.can_sign })),
    },
  });
  await moveClientToStage(p.client_id, 'proposals_stage_sent', c.userId);
  const token = await decryptString(LINK_KEY, p.link_token_enc);
  return { ok: true, link: linkFor(token), pages_sha256: pagesSha };
}

async function actDeleteDraft(c: Caller, b: Row) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (p.status !== 'draft') throw new HttpError(409, 'conflict', 'Solo le bozze si eliminano');
  const paths = [p.original_pdf_path, ...((p.pages || []) as Row[]).map((x) => x.path)];
  const { error } = await sb.from('proposals').delete().eq('id', p.id).eq('status', 'draft');
  if (error) throw new Error(error.message);
  await sb.storage.from(BUCKET).remove(paths);
  return { ok: true };
}

async function actLink(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (p.status === 'draft') throw new HttpError(409, 'conflict', 'Proposta non ancora pubblicata');
  const token = await decryptString(LINK_KEY, p.link_token_enc);
  await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'link_copied', actor_type: 'staff', actor_user_id: c.userId, ctx });
  return { link: linkFor(token) };
}

async function actRevoke(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (!['sent', 'opened'].includes(p.status)) throw new HttpError(409, 'conflict', 'Si revocano solo proposte inviate o aperte, non ancora firmate');
  const { error } = await sb.from('proposals').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', p.id);
  if (error) throw new HttpError(409, 'conflict', error.message);
  await sb.from('proposal_sessions').update({ ended_at: new Date().toISOString() }).eq('proposal_id', p.id).is('ended_at', null);
  await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'revoked', actor_type: 'staff', actor_user_id: c.userId, ctx, details: { reason: String(b.reason || '').slice(0, 300) || null } });
  return { ok: true };
}

async function actExtend(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (!['sent', 'opened'].includes(p.status)) throw new HttpError(409, 'conflict', 'Si proroga solo una proposta attiva e non firmata');
  const days = Math.round(Number(b.days));
  if (!(days >= 1 && days <= 365)) throw new HttpError(400, 'bad_request', 'Proroga tra 1 e 365 giorni');
  // La proroga parte da oggi se la proposta è gia' scaduta, altrimenti dalla scadenza attuale.
  const base = Math.max(Date.now(), new Date(p.expires_at).getTime());
  const expires_at = new Date(base + days * 86400_000).toISOString();
  const { error } = await sb.from('proposals').update({ expires_at }).eq('id', p.id);
  if (error) throw new HttpError(409, 'conflict', error.message);
  await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'extended', actor_type: 'staff', actor_user_id: c.userId, ctx, details: { from: p.expires_at, to: expires_at, days } });
  return { ok: true, expires_at };
}

async function actRegenerate(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (!['sent', 'opened'].includes(p.status)) throw new HttpError(409, 'conflict', 'Il link si rigenera solo su una proposta attiva e non firmata');
  const token = randomToken(32);
  const { error } = await sb.from('proposals').update({
    link_token_hash: await sha256Hex(token), link_token_enc: await encryptString(LINK_KEY, token),
  }).eq('id', p.id);
  if (error) throw new HttpError(409, 'conflict', error.message);
  await sb.from('proposal_sessions').update({ ended_at: new Date().toISOString() }).eq('proposal_id', p.id).is('ended_at', null);
  await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'link_regenerated', actor_type: 'staff', actor_user_id: c.userId, ctx });
  return { ok: true, link: linkFor(token) };
}

async function actFiles(_c: Caller, b: Row) {
  const p = await loadProposal(b.id);
  const sign = async (path: string | null, bucket = BUCKET) => {
    if (!path) return null;
    const { data } = await sb.storage.from(bucket).createSignedUrl(path, 300);
    return data?.signedUrl || null;
  };
  const { data: sigs } = await sb.from('proposal_signatures').select('kind, signature_path').eq('proposal_id', p.id);
  return {
    original_pdf: await sign(p.original_pdf_path),
    final_pdf: await sign(p.final_pdf_path),
    pages: await Promise.all(((p.pages || []) as Row[]).map(async (x) => ({ n: x.n, w: x.w, h: x.h, url: await sign(x.path) }))),
    signatures: await Promise.all((sigs || []).map(async (s: Row) => ({ kind: s.kind, url: await sign(s.signature_path) }))),
  };
}

async function actSaveCountersignature(c: Caller, b: Row) {
  requireAdmin(c);
  const png = b64Decode(String(b.png_base64 || ''));
  if (!isPng(png) || png.length > 1024 * 1024) throw new HttpError(400, 'bad_request', 'Firma non valida (PNG fino a 1 MB)');
  const display_name = String(b.display_name || c.name).trim().slice(0, 120);
  const role_title = String(b.role_title || '').trim().slice(0, 120) || null;
  const sha = await sha256Hex(png);
  const path = `_countersigners/${c.userId}/${sha.slice(0, 16)}.png`;
  await upload(path, png, 'image/png', true);
  const { error } = await sb.from('proposal_countersigners').upsert({
    user_id: c.userId, display_name, role_title, signature_path: path, signature_sha256: sha, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function actCountersign(c: Caller, b: Row, ctx: ReqCtx) {
  requireAdmin(c);
  const p = await loadProposal(b.id);
  if (p.status !== 'signed') throw new HttpError(409, 'conflict', p.status === 'countersigned' ? 'Già controfirmata' : 'La proposta non è ancora firmata dal cliente');

  const { data: cs } = await sb.from('proposal_countersigners').select('*').eq('user_id', c.userId).maybeSingle();
  if (!cs) throw new HttpError(409, 'needs_signature', 'Salva prima la tua firma di controfirma');

  const { data: client } = await sb.from('clients').select('id, company_name, contact_name').eq('id', p.client_id).single();
  const { data: sigsBefore } = await sb.from('proposal_signatures').select('*').eq('proposal_id', p.id);
  const clientSig = (sigsBefore || []).find((s: Row) => s.kind === 'client');
  if (!clientSig) throw new HttpError(409, 'conflict', 'Firma del cliente non trovata');

  // 1. Controfirma (idempotente: se un tentativo precedente si è fermato dopo
  //    questo passo, si riparte da qui senza duplicare la firma).
  let counterSig = (sigsBefore || []).find((s: Row) => s.kind === 'countersign');
  if (!counterSig) {
    const now = new Date();
    const { data, error } = await sb.from('proposal_signatures').insert({
      proposal_id: p.id, kind: 'countersign', signer_user_id: c.userId, signer_name: cs.display_name,
      method: 'drawn', signature_path: cs.signature_path, signature_sha256: cs.signature_sha256,
      document_sha256: p.original_pdf_sha256, pages_sha256: p.pages_sha256,
      signed_at: now.toISOString(), signed_at_dubai: dubaiTime(now),
      ip: ctx.ip, user_agent: ctx.userAgent, device_id: ctx.deviceId, country: ctx.country,
    }).select('*').single();
    if (error) throw new Error(error.message);
    counterSig = data;
    await logEvent(sb, {
      proposal_id: p.id, client_id: p.client_id, event_type: 'countersigned', actor_type: 'staff', actor_user_id: c.userId, ctx,
      details: { signer: cs.display_name, document_sha256: p.original_pdf_sha256 },
    });
  }

  // 2. PDF finale
  const { data: signerRec } = await sb.from('proposal_recipients').select('*').eq('id', clientSig.recipient_id).single();
  const original = await download(p.original_pdf_path);
  const clientImg = clientSig.method === 'drawn' && clientSig.signature_path ? await download(clientSig.signature_path) : null;
  const counterImg = await download(counterSig.signature_path);
  let logo: Uint8Array | null = null;
  if (BRAND.logoUrl) { try { const r = await fetch(BRAND.logoUrl); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch { /* */ } }
  const { data: events } = await sb.from('proposal_events').select('created_at, event_type, details, hash').eq('proposal_id', p.id).order('id');
  const it = p.locale !== 'en';

  const sigInfo = (s: Row, img: Uint8Array | null, roleLabel: string): SignatureInfo => ({
    kind: s.kind, signer_name: s.signer_name, role_label: roleLabel, method: s.method, typed_text: s.typed_text,
    image_png: img, signed_at: s.signed_at, signed_at_dubai: s.signed_at_dubai, ip: s.ip, user_agent: s.user_agent,
    country: s.country, verified_phone: s.verified_phone, verification_channel: s.verification_channel, signature_sha256: s.signature_sha256,
  });

  const finalPdf = await buildFinalPdf({
    originalPdf: original,
    proposal: p as FinalProposal,
    clientName: client?.company_name || signerRec?.full_name || '',
    consentText: clientSig.consent_text || (it ? CONSENT_TEXT.it : CONSENT_TEXT.en),
    consentVersion: clientSig.consent_version || CONSENT_VERSION,
    signatures: [
      sigInfo(clientSig, clientImg, it ? 'Cliente' : 'Client'),
      sigInfo(counterSig, counterImg, cs.role_title ? `${BRAND.short} — ${cs.role_title}` : BRAND.short),
    ],
    events: (events || []) as FinalEvent[],
    eventsChainHead: events?.length ? events[events.length - 1].hash : null,
    logoPng: logo,
  });
  const finalSha = await sha256Hex(finalPdf);
  const finalPath = `${p.id}/final.pdf`;
  await upload(finalPath, finalPdf, 'application/pdf', true);

  // 3. Copia nei documenti del cliente (client-documents + client_files)
  const safeTitle = p.title.replace(/[^\w.\- ()]/g, '_').slice(0, 80);
  const fileName = `${safeTitle} - firmata.pdf`;
  const docPath = `${p.client_id}/Proposte firmate/${Date.now()}_${fileName}`;
  await upload(docPath, finalPdf, 'application/pdf', false, 'client-documents');
  const { data: cf, error: cfErr } = await sb.from('client_files').insert({
    client_id: p.client_id, storage_path: docPath, display_name: fileName, original_name: fileName,
    file_size: finalPdf.length, mime_type: 'application/pdf', folder: '/Proposte firmate/', uploaded_by: c.userId,
    notes: `Proposta firmata e controfirmata. SHA-256: ${finalSha}`,
  }).select('id').single();
  if (cfErr) console.error('[countersign] client_files', cfErr.message);

  // 4. Chiusura: da qui il trigger blocca ogni modifica
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('proposals').update({
    status: 'countersigned', countersigned_at: counterSig.signed_at || nowIso, countersigned_by: c.userId,
    final_pdf_path: finalPath, final_pdf_sha256: finalSha, client_file_id: cf?.id || null,
  }).eq('id', p.id).eq('status', 'signed');
  if (upErr) throw new Error(upErr.message);

  await logEvent(sb, {
    proposal_id: p.id, client_id: p.client_id, event_type: 'completed', actor_type: 'system', ctx,
    details: { final_pdf_sha256: finalSha, client_file_id: cf?.id || null },
  });
  await moveClientToStage(p.client_id, 'proposals_stage_signed', c.userId);
  if (p.task_id) {
    await sb.from('tasks').update({ status: 'completed', completed_at: nowIso }).eq('id', p.task_id).then(() => {}, () => {});
  }

  // 5. Email con il PDF a entrambi (firmatario e controfirmante)
  const attach = [{ filename: fileName, content: finalPdf }];
  const amount = formatAmount(p.amount, p.currency, p.locale);
  if (signerRec?.email) {
    const r = await sendEmail(sb, {
      to: signerRec.email, locale: p.locale, attachments: attach, event_type: 'proposal_completed_client', entity_id: p.id,
      subject: it ? `Documento firmato: ${p.title}` : `Signed document: ${p.title}`,
      html: it
        ? `<p style="margin:0 0 12px">Gentile ${escapeHtml(signerRec.full_name)},</p><p style="margin:0 0 12px">in allegato trovi la proposta <b>${escapeHtml(p.title)}</b> (${escapeHtml(amount)}) firmata da te e controfirmata da ${BRAND.short}, con la pagina di certificazione.</p><p style="margin:0;color:#5c5a55;font-size:13px">Impronta SHA-256 del documento: ${finalSha}</p>`
        : `<p style="margin:0 0 12px">Dear ${escapeHtml(signerRec.full_name)},</p><p style="margin:0 0 12px">attached is the proposal <b>${escapeHtml(p.title)}</b> (${escapeHtml(amount)}) signed by you and countersigned by ${BRAND.short}, with the certification page.</p><p style="margin:0;color:#5c5a55;font-size:13px">Document SHA-256 fingerprint: ${finalSha}</p>`,
    });
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: r.ok ? 'final_sent_client' : 'final_send_failed', actor_type: 'system', recipient_id: signerRec.id, details: { error: r.error || null } });
  }
  if (c.email) {
    await sendEmail(sb, {
      to: c.email, attachments: attach, event_type: 'proposal_completed', entity_id: p.id,
      subject: `Proposta completata: ${p.title} — ${client?.company_name || ''}`,
      html: `<p style="margin:0 0 12px">La proposta <b>${escapeHtml(p.title)}</b> per <b>${escapeHtml(client?.company_name || '')}</b> è firmata e controfirmata.</p><p style="margin:0 0 12px">Il PDF finale è in allegato ed è salvato nei documenti del cliente (cartella "Proposte firmate").</p><p style="margin:0;color:#5c5a55;font-size:13px">SHA-256: ${finalSha}</p>`,
    });
  }
  await notifyStaff(sb, {
    event_type: 'proposal_completed', proposal_id: p.id, client_id: p.client_id, whatsapp: true,
    // l'email col PDF allegato all'admin parte qui sopra: niente doppione
    email: false,
    title: `Proposta completata — ${client?.company_name || ''}`,
    body: `${p.title}: firmata e controfirmata. PDF salvato in Documenti › Proposte firmate.`,
  });
  return { ok: true, final_pdf_sha256: finalSha, client_file_id: cf?.id || null };
}

type FinalProposal = Parameters<typeof buildFinalPdf>[0]['proposal'];
type FinalEvent = Parameters<typeof buildFinalPdf>[0]['events'][number];

async function actVerifyLog(_c: Caller, b: Row) {
  const p = await loadProposal(b.id);
  const { data, error } = await sb.rpc('proposal_events_verify', { p_proposal: p.id });
  if (error) throw new Error(error.message);
  return data?.[0] || { ok: false };
}

// ── Router ────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    if (!LINK_KEY) throw new HttpError(503, 'misconfigured', 'PROPOSAL_LINK_KEY non configurata');
    const caller = await authenticate(req);
    const ctx = reqCtx(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case 'config': return json(await actConfig(caller));
      case 'extract': {
        requireAdmin(caller);
        const pdf = b64Decode(String(body.pdf_base64 || ''));
        if (!isPdf(pdf)) throw new HttpError(400, 'bad_request', 'Il file non è un PDF');
        return json(await extractWithAI(pdf));
      }
      case 'create': return json(await actCreate(caller, body, ctx));
      case 'add_page': return json(await actAddPage(caller, body));
      case 'publish': return json(await actPublish(caller, body, ctx));
      case 'delete_draft': return json(await actDeleteDraft(caller, body));
      case 'link': return json(await actLink(caller, body, ctx));
      case 'revoke': return json(await actRevoke(caller, body, ctx));
      case 'extend': return json(await actExtend(caller, body, ctx));
      case 'regenerate_link': return json(await actRegenerate(caller, body, ctx));
      case 'files': return json(await actFiles(caller, body));
      case 'save_countersignature': return json(await actSaveCountersignature(caller, body));
      case 'countersign': return json(await actCountersign(caller, body, ctx));
      case 'verify_log': return json(await actVerifyLog(caller, body));
      default: throw new HttpError(400, 'bad_request', 'Azione sconosciuta');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof Anthropic.APIError) {
      console.error('[proposal-admin] Anthropic', e.status, e.message);
      return json({ error: 'Lettura AI non disponibile al momento: compila i dati a mano.', code: 'ai_error' }, 502);
    }
    console.error('[proposal-admin]', (e as Error).message);
    return json({ error: (e as Error).message || 'Errore interno', code: 'internal' }, 500);
  }
});
