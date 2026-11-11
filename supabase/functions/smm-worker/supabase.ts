/**
 * Accesso al database con la chiave di servizio.
 *
 * Il worker gira lato server e ha bisogno di scrivere su tabelle protette da
 * RLS, quindi usa la service_role key. La chiave arriva dall'ambiente della
 * edge function (SUPABASE_SERVICE_ROLE_KEY, che Supabase imposta da sola):
 * non e' scritta nel codice, e non deve esserlo.
 *
 * Non uso il client supabase-js perche' qui servono quattro operazioni e una
 * rpc, e il portale parla con l'API REST a mano anche nel browser
 * (js/supabase.js): la stessa convenzione, cosi' chi legge un pezzo
 * riconosce l'altro.
 */

export class SupabaseClient {
  constructor(
    private url: string,
    private key: string,
  ) {}

  private get intestazioni(): Record<string, string> {
    return {
      "apikey": this.key,
      "Authorization": `Bearer ${this.key}`,
      "Content-Type": "application/json",
    };
  }

  private async chiama(percorso: string, opzioni: RequestInit & { prefer?: string } = {}) {
    const { prefer, ...resto } = opzioni;
    const r = await fetch(`${this.url}${percorso}`, {
      ...resto,
      headers: {
        ...this.intestazioni,
        ...(prefer ? { "Prefer": prefer } : {}),
        ...(resto.headers as Record<string, string> ?? {}),
      },
    });
    const testo = await r.text();
    let dati: unknown = null;
    try { dati = testo ? JSON.parse(testo) : null; } catch { dati = testo; }
    if (!r.ok) {
      const msg = (dati as { message?: string })?.message
               ?? (dati as { error?: string })?.error
               ?? `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return dati;
  }

  select(tabella: string, query: string): Promise<any[]> {
    return this.chiama(`/rest/v1/${tabella}?${query}`) as Promise<any[]>;
  }

  insert(tabella: string, righe: unknown): Promise<any[]> {
    return this.chiama(`/rest/v1/${tabella}`, {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify(Array.isArray(righe) ? righe : [righe]),
    }) as Promise<any[]>;
  }

  update(tabella: string, filtro: string, patch: unknown): Promise<any[]> {
    return this.chiama(`/rest/v1/${tabella}?${filtro}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(patch),
    }) as Promise<any[]>;
  }

  delete(tabella: string, filtro: string): Promise<any[]> {
    return this.chiama(`/rest/v1/${tabella}?${filtro}`, {
      method: "DELETE",
      prefer: "return=representation",
    }) as Promise<any[]>;
  }

  rpc(funzione: string, argomenti: Record<string, unknown>): Promise<any> {
    return this.chiama(`/rest/v1/rpc/${funzione}`, {
      method: "POST",
      body: JSON.stringify(argomenti),
    });
  }

  /** Scrive in activity_log senza mai far fallire il chiamante. */
  async log(azione: string, dettagli: unknown, userId?: string | null) {
    try {
      await this.insert("activity_log", {
        user_id: userId ?? null, action: azione, details: dettagli,
      });
    } catch { /* il log non blocca niente */ }
  }
}

export function clientDaAmbiente(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY nell'ambiente della funzione.",
    );
  }
  return new SupabaseClient(url, key);
}
