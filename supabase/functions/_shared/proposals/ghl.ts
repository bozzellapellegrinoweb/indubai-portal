// Client minimo per i messaggi GHL (LeadConnector). Token e location solo da
// variabili d'ambiente: GHL_API_TOKEN, GHL_LOCATION_ID.

import { env } from './env.ts';

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

export const ghlConfigured = () => !!(env('GHL_API_TOKEN') && env('GHL_LOCATION_ID'));

function headers() {
  return {
    Authorization: `Bearer ${env('GHL_API_TOKEN')}`,
    Version: VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/** Trova o crea il contatto per quel numero; ritorna il contactId. */
export async function ghlUpsertContact(phone: string, name?: string, email?: string | null): Promise<string> {
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/);
  const r = await fetch(`${BASE}/contacts/upsert`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      locationId: env('GHL_LOCATION_ID'), phone,
      ...(firstName ? { firstName, lastName: rest.join(' ') } : {}),
      ...(email ? { email } : {}),
      tags: ['portale-proposte'],
    }),
  });
  const d = await r.json().catch(() => ({}));
  const id = d?.contact?.id || d?.id;
  if (!r.ok || !id) throw new Error(`GHL upsert contatto: ${d?.message || r.status}`);
  return id;
}

/** Invia un messaggio WhatsApp o SMS a un contatto GHL. */
export async function ghlSend(contactId: string, type: 'WhatsApp' | 'SMS', message: string): Promise<string | null> {
  const r = await fetch(`${BASE}/conversations/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ type, contactId, message }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GHL ${type}: ${d?.message || r.status}`);
  return d?.messageId || d?.id || null;
}
