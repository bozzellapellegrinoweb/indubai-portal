// Primitive crittografiche del modulo Proposte (Web Crypto, niente dipendenze).

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64Decode(s: string): Uint8Array {
  const clean = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s;
  const bin = atob(clean.replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64Encode(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

/** Token casuale non indovinabile (256 bit di default), in base64url. */
export function randomToken(bytes = 32): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Codice a sei cifre uniforme (rejection sampling, nessun bias di modulo). */
export function randomSixDigits(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  if (!secret) throw new Error('Segreto HMAC non configurato');
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)));
}

// ── Cifratura del link (AES-GCM) ─────────────────────────────
// La chiave deriva da PROPOSAL_LINK_KEY (qualunque stringa lunga e casuale).
async function aesKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error('PROPOSAL_LINK_KEY mancante o troppo corta (min 32 caratteri)');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain)));
  return 'v1.' + b64urlEncode(iv) + '.' + b64urlEncode(ct);
}

export async function decryptString(secret: string, packed: string): Promise<string> {
  const [v, ivs, cts] = packed.split('.');
  if (v !== 'v1' || !ivs || !cts) throw new Error('Formato cifrato non valido');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(ivs) as BufferSource }, await aesKey(secret), b64urlDecode(cts) as BufferSource);
  return new TextDecoder().decode(pt);
}
