/**
 * Prezzi dei modelli, in dollari per milione di token.
 *
 * Servono a scrivere il costo su ogni lavoro e a far rispettare i limiti di
 * spesa. Se un modello non e' in tabella si usa il piu' caro, perche' una
 * stima troppo alta ferma la coda, mentre una troppo bassa la fa correre
 * oltre il budget.
 *
 * Da rivedere quando cambiano i prezzi di listino.
 */
export interface Prezzo { in: number; out: number; cacheRead: number }

export const PREZZI: Record<string, Prezzo> = {
  "claude-opus-5-5":   { in: 4.00,  out: 20.00, cacheRead: 0.20 },
  "claude-opus-5":     { in: 5.00,  out: 25.00, cacheRead: 0.50 },
  "claude-sonnet-5-5": { in: 2.00,  out: 10.00, cacheRead: 0.10 },
  "claude-sonnet-5":   { in: 2.00,  out: 10.00, cacheRead: 0.20 },
  "claude-haiku-5-5":  { in: 0.10,  out: 0.50,  cacheRead: 0.01 },
  "claude-fable-5-2":  { in: 8.00,  out: 40.00, cacheRead: 0.20 },
};

const PIU_CARO: Prezzo = { in: 10.00, out: 50.00, cacheRead: 1.00 };

export function prezzo(model: string): Prezzo {
  return PREZZI[model] ?? PIU_CARO;
}

/** Costo in dollari di una risposta. */
export function costo(model: string, usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number {
  const p = prezzo(model);
  const inTok    = usage.input_tokens ?? 0;
  const outTok   = usage.output_tokens ?? 0;
  const cacheRd  = usage.cache_read_input_tokens ?? 0;
  // la scrittura in cache costa circa 1.25 volte l'input
  const cacheWr  = usage.cache_creation_input_tokens ?? 0;
  return (inTok   * p.in        / 1e6)
       + (outTok  * p.out       / 1e6)
       + (cacheRd * p.cacheRead / 1e6)
       + (cacheWr * p.in * 1.25 / 1e6);
}
