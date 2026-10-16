// ============================================================
// Edge Function "proposal-public" — lato cliente del modulo Proposte
// ============================================================
// Pubblica (verify_jwt = false): nessun login del portale. L'accesso e':
//   link non indovinabile  +  numero gia' registrato  +  codice a sei cifre.
// Dopo il codice il browser riceve un token di sessione (header
// x-proposal-session), valido 30 minuti di inattivita'.
//
// Azioni:
//   POST { action:'info',         token }
//   POST { action:'request_code', token, phone, locale }
//   POST { action:'verify_code',  token, phone, code }
//   POST { action:'view' }                                  (sessione)
//   GET  ?action=page&n=1                                   (sessione) -> JPEG con filigrana
//   POST { action:'heartbeat', reached_end? }               (sessione)
//   POST { action:'sign', method, typed_name?, drawn_png?, consent } (sessione)
//   POST { action:'logout' }                                (sessione)
//
// Cambio di IP o dispositivo: non blocca, viene solo registrato (e notificato
// all'admin come informazione).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  BUCKET, CONSENT_TEXT, CONSENT_VERSION, env, OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_MIN, SERVICE_KEY, SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MIN, SUPABASE_URL,
} from '../_shared/proposals/env.ts';
import { b64Decode, hmacHex, randomSixDigits, randomToken, sha256Hex, timingSafeEqual } from '../_shared/proposals/crypto.ts';
import { CORS, dubaiTime, formatAmount, HttpError, json, maskPhone, normalizePhone, reqCtx, type ReqCtx } from '../_shared/proposals/util.ts';
import { logEvent } from '../_shared/proposals/events.ts';
import { notifyStaff } from '../_shared/proposals/notify.ts';
import { getOtpProvider } from '../_shared/proposals/otp.ts';
import { watermarkJpeg } from '../_shared/proposals/watermark.ts';

const PEPPER = env('OTP_PEPPER');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Risposta identica per numero registrato e non registrato: da fuori non si
// scopre quali numeri sono sul link.
const GENERIC_SENT = { ok: true, message: 'code_sent_if_registered' };

const isExpired = (p: Row) => new Date(p.expires_at).getTime() < Date.now();

/** Stato del link per il cliente. */
function linkState(p: Row | null): 'ok' | 'invalid' | 'expired' | 'revoked' | 'completed' {
  if (!p || p.status === 'draft') return 'invalid';
  if (p.status === 'revoked') return 'revoked';
  if (p.status === 'countersigned') return 'completed';
  if (p.status === 'signed') return 'ok';          // firmata: si può ancora rivedere
  if (isExpired(p)) return 'expired';
  return 'ok';
}

async function proposalByToken(token: unknown): Promise<Row | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const { data } = await sb.from('proposals').select('*').eq('link_token_hash', await sha256Hex(token)).maybeSingle();
  return data || null;
}

async function clientName(id: string): Promise<string> {
  const { data } = await sb.from('clients').select('company_name').eq('id', id).maybeSingle();
  return data?.company_name || '';
}

// ── Limiti di frequenza (contati sul database, valgono tra istanze) ──
async function rateLimitIp(p: Row, ctx: ReqCtx) {
  if (!ctx.ip) return;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from('proposal_events').select('id', { count: 'exact', head: true })
    .eq('proposal_id', p.id).eq('ip', ctx.ip).in('event_type', ['otp_requested', 'otp_unknown_number', 'otp_failed'])
    .gte('created_at', since);
  if ((count || 0) >= 30) throw new HttpError(429, 'rate_limited', 'Troppi tentativi. Riprova tra un\'ora.');
}

// ── Sessione ───────────────────────────────────────────────
interface Sess { s: Row; p: Row; r: Row }

async function loadSession(req: Request, ctx: ReqCtx, touch = true): Promise<Sess> {
  const tok = req.headers.get('x-proposal-session') || '';
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(tok)) throw new HttpError(401, 'session_required', 'Sessione mancante');
  const { data: s } = await sb.from('proposal_sessions').select('*').eq('token_hash', await sha256Hex(tok)).maybeSingle();
  if (!s || s.ended_at) throw new HttpError(401, 'session_expired', 'Sessione terminata');
  const now = Date.now();
  if (new Date(s.last_seen_at).getTime() + SESSION_IDLE_MIN * 60_000 < now || new Date(s.absolute_expires_at).getTime() < now) {
    await sb.from('proposal_sessions').update({ ended_at: new Date().toISOString() }).eq('id', s.id);
    await logEvent(sb, { proposal_id: s.proposal_id, event_type: 'session_expired', actor_type: 'system', recipient_id: s.recipient_id, session_id: s.id });
    throw new HttpError(401, 'session_expired', 'Sessione scaduta per inattività');
  }
  const { data: p } = await sb.from('proposals').select('*').eq('id', s.proposal_id).single();
  const st = linkState(p);
  if (st !== 'ok' && st !== 'completed') throw new HttpError(410, st, 'Link non più attivo');
  const { data: r } = await sb.from('proposal_recipients').select('*').eq('id', s.recipient_id).single();

  if (touch) {
    const patch: Row = { last_seen_at: new Date().toISOString() };
    // Cambio di IP o di browser durante la sessione: si registra, non si blocca.
    if (ctx.ip && ctx.ip !== (s.last_ip || s.ip)) {
      patch.last_ip = ctx.ip;
      await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'session_ip_changed', actor_type: 'recipient', recipient_id: r.id, session_id: s.id, ctx, details: { from: s.last_ip || s.ip } });
    }
    if (ctx.userAgent && ctx.userAgent !== (s.last_user_agent || s.user_agent)) {
      patch.last_user_agent = ctx.userAgent;
      await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'session_device_changed', actor_type: 'recipient', recipient_id: r.id, session_id: s.id, ctx });
    }
    await sb.from('proposal_sessions').update(patch).eq('id', s.id);
  }
  return { s, p, r };
}

async function viewPayload({ s, p, r }: Sess) {
  const { data: sig } = await sb.from('proposal_signatures')
    .select('signer_name, signed_at, signed_at_dubai, recipient_id').eq('proposal_id', p.id).eq('kind', 'client').maybeSingle();
  return {
    proposal: {
      title: p.title, amount: p.amount, currency: p.currency,
      amount_label: formatAmount(p.amount, p.currency, p.locale),
      locale: p.locale, status: p.status, expires_at: p.expires_at,
      client_name: await clientName(p.client_id),
      pages: ((p.pages || []) as Row[]).map((x) => ({ n: x.n, w: x.w, h: x.h })),
    },
    viewer: { name: r.full_name, phone_masked: maskPhone(r.phone_e164), can_sign: r.can_sign },
    signature: sig ? { signer_name: sig.signer_name, signed_at: sig.signed_at, signed_at_dubai: sig.signed_at_dubai } : null,
    can_sign_now: r.can_sign && !sig && ['sent', 'opened'].includes(p.status) && !isExpired(p),
    consent: { text: p.locale === 'en' ? CONSENT_TEXT.en : CONSENT_TEXT.it, version: CONSENT_VERSION },
    session: { idle_minutes: SESSION_IDLE_MIN, opened_at: s.created_at },
  };
}

// ── Azioni ─────────────────────────────────────────────────

async function actInfo(b: Row) {
  const p = await proposalByToken(b.token);
  const state = linkState(p);
  return { state, locale: p?.locale || 'it' };
}

async function actRequestCode(b: Row, ctx: ReqCtx) {
  const p = await proposalByToken(b.token);
  const state = linkState(p);
  if (!p || state !== 'ok') throw new HttpError(410, state, 'Link non attivo');
  await rateLimitIp(p, ctx);

  const phone = normalizePhone(b.phone);
  if (!phone) throw new HttpError(400, 'bad_phone', 'Inserisci il numero con il prefisso internazionale (es. +971...)');

  const { data: r } = await sb.from('proposal_recipients').select('*').eq('proposal_id', p.id).eq('phone_e164', phone).maybeSingle();
  if (!r) {
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'otp_unknown_number', actor_type: 'recipient', ctx, details: { phone_masked: maskPhone(phone) } });
    return GENERIC_SENT;
  }

  // Limiti per destinatario: un codice al minuto, cinque all'ora.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent } = await sb.from('proposal_otp_codes').select('id, created_at')
    .eq('recipient_id', r.id).gte('created_at', hourAgo).order('created_at', { ascending: false });
  if (recent?.length && Date.now() - new Date(recent[0].created_at).getTime() < OTP_RESEND_COOLDOWN_SEC * 1000) {
    return { ...GENERIC_SENT, retry_after: OTP_RESEND_COOLDOWN_SEC };
  }
  if ((recent?.length || 0) >= OTP_MAX_PER_HOUR) throw new HttpError(429, 'rate_limited', 'Hai richiesto troppi codici. Riprova più tardi.');

  // Un solo codice valido alla volta.
  await sb.from('proposal_otp_codes').update({ invalidated_at: new Date().toISOString() })
    .eq('recipient_id', r.id).is('consumed_at', null).is('invalidated_at', null);

  const provider = getOtpProvider(sb);
  const locale = b.locale === 'en' || (b.locale !== 'it' && p.locale === 'en') ? 'en' : 'it';
  const target = { phone: r.phone_e164, email: r.email, name: r.full_name, locale } as const;
  const otpId = crypto.randomUUID();
  let channel = '', ref: string | null = null, codeHash: string | null = null;
  try {
    if (provider.verifiesItself) {
      ({ channel, ref } = await provider.start!(target));
    } else {
      const code = randomSixDigits();
      codeHash = await hmacHex(PEPPER, `${otpId}:${code}`);
      ({ channel, ref } = await provider.deliver!(target, code));
    }
  } catch (e) {
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'otp_delivery_failed', actor_type: 'system', recipient_id: r.id, ctx, details: { provider: provider.name, error: (e as Error).message.slice(0, 300) } });
    throw new HttpError(502, 'delivery_failed', 'Non riusciamo a inviare il codice in questo momento. Riprova tra poco o contatta PB TAX.');
  }

  await sb.from('proposal_otp_codes').insert({
    id: otpId, proposal_id: p.id, recipient_id: r.id, provider: provider.name, channel, code_hash: codeHash,
    provider_ref: ref, expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
    max_attempts: OTP_MAX_ATTEMPTS, ip: ctx.ip, user_agent: ctx.userAgent,
  });
  await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'otp_requested', actor_type: 'recipient', recipient_id: r.id, ctx, details: { provider: provider.name, channel } });
  return GENERIC_SENT;
}

async function actVerifyCode(b: Row, ctx: ReqCtx) {
  const p = await proposalByToken(b.token);
  const state = linkState(p);
  if (!p || state !== 'ok') throw new HttpError(410, state, 'Link non attivo');
  await rateLimitIp(p, ctx);
  const phone = normalizePhone(b.phone);
  const code = String(b.code || '').replace(/\D/g, '');
  const bad = () => new HttpError(400, 'invalid_code', 'Codice non valido o scaduto');
  if (!phone || code.length !== 6) throw bad();

  const { data: r } = await sb.from('proposal_recipients').select('*').eq('proposal_id', p.id).eq('phone_e164', phone).maybeSingle();
  if (!r) throw bad();
  const { data: otp } = await sb.from('proposal_otp_codes').select('*')
    .eq('recipient_id', r.id).is('consumed_at', null).is('invalidated_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!otp || new Date(otp.expires_at).getTime() < Date.now() || otp.attempts >= otp.max_attempts) throw bad();

  // Il tentativo si conta prima di verificare: due richieste in parallelo non
  // ottengono tentativi in piu'.
  const attempts = otp.attempts + 1;
  const { data: claimed } = await sb.from('proposal_otp_codes').update({ attempts })
    .eq('id', otp.id).eq('attempts', otp.attempts).is('consumed_at', null).select('id');
  if (!claimed?.length) throw bad();

  let ok = false;
  if (otp.code_hash) {
    ok = timingSafeEqual(await hmacHex(PEPPER, `${otp.id}:${code}`), otp.code_hash);
  } else {
    const provider = getOtpProvider(sb);
    ok = provider.verifiesItself ? await provider.check!({ phone: r.phone_e164, email: r.email, name: r.full_name, locale: 'it' }, code, otp.provider_ref) : false;
  }

  if (!ok) {
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'otp_failed', actor_type: 'recipient', recipient_id: r.id, ctx, details: { attempt: attempts } });
    if (attempts >= otp.max_attempts) {
      await sb.from('proposal_otp_codes').update({ invalidated_at: new Date().toISOString() }).eq('id', otp.id);
      await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'otp_locked', actor_type: 'system', recipient_id: r.id, ctx, details: { attempts } });
      await notifyStaff(sb, {
        event_type: 'proposal_otp_failed', proposal_id: p.id, client_id: p.client_id,
        title: `Codici sbagliati — ${await clientName(p.client_id)}`,
        body: `${r.full_name} (${maskPhone(r.phone_e164)}) ha sbagliato il codice ${attempts} volte sulla proposta "${p.title}". Codice bloccato; può richiederne uno nuovo.`,
      });
      throw new HttpError(429, 'code_locked', 'Troppi tentativi: richiedi un nuovo codice.');
    }
    throw new HttpError(400, 'invalid_code', `Codice non valido. Tentativi rimasti: ${otp.max_attempts - attempts}`);
  }

  await sb.from('proposal_otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id);

  // Dispositivo o paese mai visti per questo destinatario: solo informativo.
  const { data: prev } = await sb.from('proposal_sessions').select('device_id, country, user_agent')
    .eq('recipient_id', r.id).order('created_at', { ascending: false }).limit(20);
  const isNewDevice = !!prev?.length && !!ctx.deviceId && !prev.some((x: Row) => x.device_id === ctx.deviceId);
  const isNewCountry = !!prev?.length && !!ctx.country && !prev.some((x: Row) => x.country === ctx.country);

  const token = randomToken(32);
  const now = new Date();
  const { data: s, error } = await sb.from('proposal_sessions').insert({
    proposal_id: p.id, recipient_id: r.id, otp_id: otp.id, token_hash: await sha256Hex(token),
    absolute_expires_at: new Date(now.getTime() + SESSION_ABSOLUTE_HOURS * 3600_000).toISOString(),
    ip: ctx.ip, user_agent: ctx.userAgent, device_id: ctx.deviceId, country: ctx.country,
    last_ip: ctx.ip, last_user_agent: ctx.userAgent,
  }).select('*').single();
  if (error) throw new Error(error.message);

  await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'otp_verified', actor_type: 'recipient', recipient_id: r.id, session_id: s.id, ctx, details: { channel: otp.channel } });

  const cname = await clientName(p.client_id);
  if (!p.first_opened_at) {
    const patch: Row = { first_opened_at: now.toISOString() };
    if (p.status === 'sent') patch.status = 'opened';
    await sb.from('proposals').update(patch).eq('id', p.id).is('first_opened_at', null);
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'opened', actor_type: 'recipient', recipient_id: r.id, session_id: s.id, ctx, details: { first: true } });
    await notifyStaff(sb, {
      event_type: 'proposal_opened', proposal_id: p.id, client_id: p.client_id,
      title: `Proposta aperta — ${cname}`,
      body: `${r.full_name} ha aperto "${p.title}" il ${dubaiTime(now, false)}.`,
    });
  } else {
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: 'reopened', actor_type: 'recipient', recipient_id: r.id, session_id: s.id, ctx });
  }

  if (isNewDevice || isNewCountry) {
    await logEvent(sb, { proposal_id: p.id, client_id: p.client_id, event_type: isNewCountry ? 'new_country' : 'new_device', actor_type: 'system', recipient_id: r.id, session_id: s.id, ctx, details: { country: ctx.country } });
    await notifyStaff(sb, {
      event_type: 'proposal_new_device', proposal_id: p.id, client_id: p.client_id,
      title: `Accesso da ${isNewCountry ? 'un paese' : 'un dispositivo'} diverso — ${cname}`,
      body: `${r.full_name} ha aperto "${p.title}" da ${isNewCountry ? `un paese nuovo (${ctx.country})` : 'un dispositivo nuovo'}. Solo informativo: l'accesso non è stato bloccato.`,
    });
  }

  const payload = await viewPayload({ s, p: { ...p, status: p.status === 'sent' ? 'opened' : p.status }, r });
  return { session_token: token, ...payload };
}

async function actPage(req: Request, ctx: ReqCtx, n: number) {
  const sess = await loadSession(req, ctx);
  const page = ((sess.p.pages || []) as Row[]).find((x) => x.n === n);
  if (!page) throw new HttpError(404, 'not_found', 'Pagina inesistente');
  const { data, error } = await sb.storage.from(BUCKET).download(page.path);
  if (error || !data) throw new Error('Pagina non disponibile');
  const out = await watermarkJpeg(new Uint8Array(await data.arrayBuffer()), [
    `${sess.r.full_name} · ${maskPhone(sess.r.phone_e164)}`,
    `${dubaiTime(sess.s.created_at, false)} · PB TAX`,
  ]);
  return new Response(out as BodyInit, {
    headers: {
      ...CORS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store, private, max-age=0',
      'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function actHeartbeat(req: Request, ctx: ReqCtx, b: Row) {
  const sess = await loadSession(req, ctx);
  if (b.reached_end === true && !sess.s.read_to_end_at) {
    await sb.from('proposal_sessions').update({ read_to_end_at: new Date().toISOString() }).eq('id', sess.s.id);
    await logEvent(sb, { proposal_id: sess.p.id, client_id: sess.p.client_id, event_type: 'read_to_end', actor_type: 'recipient', recipient_id: sess.r.id, session_id: sess.s.id, ctx });
  }
  return { ok: true, idle_minutes: SESSION_IDLE_MIN };
}

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function actSign(req: Request, ctx: ReqCtx, b: Row) {
  const { s, p, r } = await loadSession(req, ctx);
  if (!r.can_sign) throw new HttpError(403, 'not_signer', 'Questo numero non è abilitato a firmare');
  if (!['sent', 'opened'].includes(p.status)) throw new HttpError(409, 'already_signed', 'La proposta è già firmata');
  if (isExpired(p)) throw new HttpError(410, 'expired', 'La proposta è scaduta');
  if (b.consent !== true) throw new HttpError(400, 'consent_required', 'Serve il consenso');

  const method = b.method === 'drawn' ? 'drawn' : 'typed';
  let typed: string | null = null, png: Uint8Array | null = null;
  if (method === 'typed') {
    typed = String(b.typed_name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (typed.length < 3) throw new HttpError(400, 'bad_signature', 'Scrivi nome e cognome per firmare');
  } else {
    png = b64Decode(String(b.drawn_png || ''));
    if (!isPng(png) || png.length < 400 || png.length > 1024 * 1024) throw new HttpError(400, 'bad_signature', 'Firma disegnata non valida');
  }

  const now = new Date();
  const sigId = crypto.randomUUID();
  let sigPath: string | null = null, sigSha: string | null = null;
  if (png) {
    sigSha = await sha256Hex(png);
    sigPath = `${p.id}/signatures/client-${sigId}.png`;
    const { error } = await sb.storage.from(BUCKET).upload(sigPath, png, { contentType: 'image/png' });
    if (error) throw new Error(error.message);
  } else {
    sigSha = await sha256Hex(`typed:${typed}`);
  }
  const consentText = p.locale === 'en' ? CONSENT_TEXT.en : CONSENT_TEXT.it;
  const { otp_id } = s;
  const { data: otp } = otp_id ? await sb.from('proposal_otp_codes').select('channel').eq('id', otp_id).maybeSingle() : { data: null };

  // unique(proposal_id, kind): se due firmatari confermano insieme, passa il primo.
  const { error: sErr } = await sb.from('proposal_signatures').insert({
    id: sigId, proposal_id: p.id, kind: 'client', recipient_id: r.id, signer_name: r.full_name,
    method, typed_text: typed, signature_path: sigPath, signature_sha256: sigSha,
    document_sha256: p.original_pdf_sha256, pages_sha256: p.pages_sha256,
    consent_text: consentText, consent_version: CONSENT_VERSION,
    signed_at: now.toISOString(), signed_at_dubai: dubaiTime(now),
    ip: ctx.ip, user_agent: ctx.userAgent, device_id: ctx.deviceId, country: ctx.country,
    verified_phone: r.phone_e164, verification_channel: otp?.channel || null, session_id: s.id,
  });
  if (sErr) {
    if (sigPath) await sb.storage.from(BUCKET).remove([sigPath]);
    if ((sErr as Row).code === '23505') throw new HttpError(409, 'already_signed', 'La proposta è già stata firmata');
    throw new Error(sErr.message);
  }

  // Task per la controfirma, assegnata a chi ha creato la proposta.
  const cname = await clientName(p.client_id);
  const { data: task } = await sb.from('tasks').insert({
    title: `Controfirma proposta: ${p.title}`.slice(0, 200),
    description: `${r.full_name} ha firmato la proposta "${p.title}" il ${dubaiTime(now)}. Apri la scheda cliente › Proposte e controfirma.`,
    client_id: p.client_id, created_by: p.created_by, assigned_to: p.created_by,
    status: 'open', priority: 'high', category: 'generale',
    due_date: new Date(now.getTime() + 2 * 86400_000).toISOString().slice(0, 10),
  }).select('id').single();

  const { error: pErr } = await sb.from('proposals').update({
    status: 'signed', signed_at: now.toISOString(), signed_by_recipient: r.id, task_id: task?.id || null,
  }).eq('id', p.id).in('status', ['sent', 'opened']);
  if (pErr) console.error('[sign] update proposta', pErr.message);

  await logEvent(sb, {
    proposal_id: p.id, client_id: p.client_id, event_type: 'signed', actor_type: 'recipient', recipient_id: r.id, session_id: s.id, ctx,
    details: { method, document_sha256: p.original_pdf_sha256, pages_sha256: p.pages_sha256, signature_sha256: sigSha, verified_phone: r.phone_e164, consent_version: CONSENT_VERSION },
  });
  await notifyStaff(sb, {
    event_type: 'proposal_signed', proposal_id: p.id, client_id: p.client_id,
    title: `Proposta firmata, da controfirmare — ${cname}`,
    body: `${r.full_name} ha firmato "${p.title}" (${formatAmount(p.amount, p.currency, p.locale)}). Apri la proposta e controfirma con un clic.`,
  });

  return { ok: true, signed_at: now.toISOString(), signed_at_dubai: dubaiTime(now), document_sha256: p.original_pdf_sha256 };
}

// ── Router ────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = reqCtx(req);
  try {
    if (!PEPPER || PEPPER.length < 32) throw new HttpError(503, 'misconfigured', 'Servizio non configurato');
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.get('action') === 'page') {
      const n = Number(url.searchParams.get('n'));
      if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'bad_request', 'Pagina non valida');
      return await actPage(req, ctx, n);
    }
    if (req.method !== 'POST') return json({ error: 'Metodo non ammesso' }, 405);
    const b = await req.json().catch(() => ({}));
    switch (b.action) {
      case 'info': return json(await actInfo(b));
      case 'request_code': return json(await actRequestCode(b, ctx));
      case 'verify_code': return json(await actVerifyCode(b, ctx));
      case 'view': return json(await viewPayload(await loadSession(req, ctx)));
      case 'heartbeat': return json(await actHeartbeat(req, ctx, b));
      case 'sign': return json(await actSign(req, ctx, b));
      case 'logout': {
        const sess = await loadSession(req, ctx, false);
        await sb.from('proposal_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sess.s.id);
        await logEvent(sb, { proposal_id: sess.p.id, client_id: sess.p.client_id, event_type: 'session_closed', actor_type: 'recipient', recipient_id: sess.r.id, session_id: sess.s.id, ctx });
        return json({ ok: true });
      }
      default: throw new HttpError(400, 'bad_request', 'Azione sconosciuta');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error('[proposal-public]', (e as Error).message);
    return json({ error: 'Errore temporaneo, riprova.', code: 'internal' }, 500);
  }
});
