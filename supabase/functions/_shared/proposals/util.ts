// Utilità comuni: richiesta, telefono, date di Dubai, risposte JSON.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-proposal-session, x-device-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message || code); }
}

export interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  country: string | null;
}

export function reqCtx(req: Request): ReqCtx {
  const h = req.headers;
  const xff = h.get('x-forwarded-for') || '';
  const ip = (xff.split(',')[0] || h.get('x-real-ip') || h.get('cf-connecting-ip') || '').trim() || null;
  const dev = (h.get('x-device-id') || '').trim();
  const country = (h.get('cf-ipcountry') || h.get('x-vercel-ip-country') || h.get('x-country-code') || '').trim().toUpperCase();
  return {
    ip: ip ? ip.slice(0, 64) : null,
    userAgent: (h.get('user-agent') || '').slice(0, 400) || null,
    deviceId: /^[A-Za-z0-9_-]{8,64}$/.test(dev) ? dev : null,
    country: /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null,
  };
}

/** Normalizza in E.164. Accetta +971..., 00971..., spazi, trattini, parentesi. */
export function normalizePhone(raw: unknown): string | null {
  let s = String(raw ?? '').trim().replace(/[\s().\-\/]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) return null; // il prefisso internazionale e' obbligatorio
  return /^\+[1-9][0-9]{6,14}$/.test(s) ? s : null;
}

/** +971585025012 -> +971 •••• 5012 */
export function maskPhone(e164: string): string {
  if (!e164) return '';
  const last = e164.slice(-4);
  const cc = e164.slice(0, Math.min(4, e164.length - 4));
  return `${cc} •••• ${last}`;
}

export function maskEmail(e: string | null | undefined): string {
  if (!e) return '';
  const [u, d] = e.split('@');
  return (u.length <= 2 ? u[0] + '•' : u.slice(0, 2) + '•••') + '@' + d;
}

const DUBAI_TZ = 'Asia/Dubai';

/** "17/10/2026 14:32:05 (Asia/Dubai, UTC+4)" */
export function dubaiTime(d: Date | string, withSeconds = true): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false,
  }).format(date).replace(',', '');
  return `${s} (Dubai, UTC+4)`;
}

export function utcIso(d: Date | string): string {
  return (typeof d === 'string' ? new Date(d) : d).toISOString();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function formatAmount(amount: number | null, currency: string, locale = 'it'): string {
  if (amount === null || amount === undefined) return '—';
  return `${currency} ${Number(amount).toLocaleString(locale === 'en' ? 'en-GB' : 'it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Riduce lo user agent a una descrizione leggibile per il certificato. */
export function describeUA(ua: string | null): string {
  if (!ua) return '—';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'OS sconosciuto';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} · ${os}`;
}
