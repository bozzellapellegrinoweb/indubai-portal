/**
 * Dove sta il motore.
 *
 * Il motore e' il progetto che rende le immagini, tiene le foto avatar e
 * sa raggiungere le notizie: cose che qui non si possono fare, perche'
 * questa e' una funzione di Supabase e non ha ne' un browser ne' una rete
 * di fonti.
 *
 * L'indirizzo lo si ricava da quello del rendering, che e' gia' configurato.
 * Chiedere al manager un secondo segreto con dentro quasi la stessa cosa e'
 * un modo per fargliene sbagliare uno, e non si guadagna niente.
 */
export function indirizzoMotore(rotta: string): string | null {
  const render = Deno.env.get("REGIA_RENDER_URL");
  if (!render) return null;
  const pulito = render.replace(/\/+$/, "");
  // Se non finisce per /render non si indovina: si dice che non si sa dove
  // andare, invece di costruire un indirizzo plausibile e sbagliato.
  if (!pulito.endsWith("/render")) return null;
  return pulito.slice(0, -"/render".length) + "/" + rotta.replace(/^\/+/, "");
}
