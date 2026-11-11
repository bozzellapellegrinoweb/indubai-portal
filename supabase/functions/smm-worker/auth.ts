/**
 * Chi puo' far partire il lavoro.
 *
 * La firma del token non la controlla questo codice: la controlla il gateway
 * di Supabase, che con verify_jwt acceso rifiuta un token non suo prima che
 * la funzione parta. Qui serve un'altra cosa, piu' banale e piu' facile da
 * sbagliare: distinguere una persona dalla chiave pubblica del browser.
 *
 * La chiave pubblica e' un token valido del progetto, sta nel codice della
 * pagina e ce l'ha chiunque apra il portale: non e' un'autorizzazione.
 *
 * Prima il confronto era con SUPABASE_ANON_KEY letta dall'ambiente della
 * funzione, dove non c'e': il confronto riusciva sempre e la chiave pubblica
 * bastava a far girare la coda degli agenti. Il ruolo invece sta scritto
 * dentro il token, e c'e' sempre.
 */
export function ruoloDelToken(token: string): string | null {
  const parti = token.split(".");
  if (parti.length !== 3) return null;
  try {
    const b64 = parti[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return typeof payload.role === "string" ? payload.role : null;
  } catch { return null; }
}

/**
 * Vero se il token e' di una persona autenticata, falso per la chiave
 * pubblica e per tutto quello che non e' un token del progetto.
 */
export function eUnaPersona(token: string): boolean {
  const ruolo = ruoloDelToken(token);
  return ruolo !== null && ruolo !== "anon";
}
