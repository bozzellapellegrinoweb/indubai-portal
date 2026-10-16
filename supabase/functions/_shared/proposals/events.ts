// Registro eventi delle proposte (proposal_events, a catena di hash) +
// riga riassuntiva in activity_log per gli eventi che contano nella cronologia
// della scheda cliente.

import type { ReqCtx } from './util.ts';

// Eventi che finiscono anche in activity_log (la cronologia generale del cliente).
const MIRROR = new Set([
  'published', 'opened', 'signed', 'countersigned', 'completed', 'revoked', 'extended',
  'link_regenerated', 'otp_locked',
]);

export interface EventInput {
  proposal_id: string;
  client_id?: string | null;
  event_type: string;
  actor_type: 'staff' | 'recipient' | 'system';
  actor_user_id?: string | null;
  recipient_id?: string | null;
  session_id?: string | null;
  ctx?: Partial<ReqCtx> | null;
  details?: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
export async function logEvent(sb: any, e: EventInput): Promise<void> {
  const row = {
    proposal_id: e.proposal_id,
    client_id: e.client_id ?? null,
    event_type: e.event_type,
    actor_type: e.actor_type,
    actor_user_id: e.actor_user_id ?? null,
    recipient_id: e.recipient_id ?? null,
    session_id: e.session_id ?? null,
    ip: e.ctx?.ip ?? null,
    user_agent: e.ctx?.userAgent ?? null,
    device_id: e.ctx?.deviceId ?? null,
    country: e.ctx?.country ?? null,
    details: e.details ?? {},
  };
  const { error } = await sb.from('proposal_events').insert(row);
  if (error) console.error('[proposal_events]', error.message, e.event_type);

  if (MIRROR.has(e.event_type) && e.client_id) {
    await sb.from('activity_log').insert({
      user_id: e.actor_type === 'staff' ? e.actor_user_id ?? null : null,
      client_id: e.client_id,
      action: 'proposal_' + e.event_type,
      details: { proposal_id: e.proposal_id, ...(e.details ?? {}) },
    }).then(() => {}, () => {});
  }
}
