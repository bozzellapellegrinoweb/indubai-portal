# Sistema Ambassador — InDubai Portal

Programma di segnalazione integrato nel portale: ogni ambassador ha un link
personale, un'area riservata e un estratto delle commissioni maturate.

---

## Il flusso, passo per passo

| # | Chi | Cosa succede | Dove |
|---|-----|--------------|------|
| 1 | InDubai | Dopo la call di selezione crea l'ambassador dal portale e genera l'accesso | `/ambassadors.html` |
| 2 | Ambassador | Riceve email con credenziali + link personale | Resend |
| 3 | Ambassador | Condivide `portal.indubai.it/r/<codice>` con il contatto interessato | — |
| 4 | Lead | Compila il modulo (nome, email, telefono, servizio, messaggio) | `/r/<codice>` |
| 5 | Sistema | Crea la segnalazione **e** il cliente in pipeline, colonna **Non assegnati**, con etichetta `REFERRAL · <ambassador>` | `/pipeline.html` |
| 6 | Sistema | Manda email a segreteria + staff, conferma all'ambassador, conferma alla lead | Resend |
| 7 | InDubai | Fa la call. Se la lead paga, sposta il cliente nella fase **Cliente ha pagato** | `/pipeline.html` |
| 8 | Sistema | Matura la commissione e manda l'email all'ambassador con importo e servizio | Resend |
| 9 | Ambassador | Vede segnalazioni, conversioni e commissioni nella sua area | `/ambassador/dashboard.html` |
| 10 | InDubai | Liquida la commissione con "Segna pagata" → email di conferma | `/ambassadors.html` |

---

## Installazione

1. **Migrazione database** — SQL Editor di Supabase:
   ```
   supabase/migrations/20260825_ambassador.sql
   ```
   È additiva e ri-eseguibile. Crea tabelle, RLS, ruolo `ambassador`, eventi di
   notifica e il catalogo servizi di partenza.

2. **Variabile d'ambiente opzionale** su Vercel:
   ```
   SEGRETERIA_EMAIL=segreteria@indubai.it
   ```
   È la casella che riceve le richieste di consulenza. Senza la variabile si usa
   `segreteria@indubai.it`.

3. **Deploy**. Nessun altro passaggio: la rewrite `/r/:code` è già in `vercel.json`.

---

## Servizi e commissioni

Il catalogo è editabile da **Ambassador → ⚙ Servizi & commissioni**.
Valori di partenza (inventati, da ritarare):

| Servizio | Prezzo | Commissione | Guadagno ambassador |
|----------|--------|-------------|---------------------|
| Apertura società Free Zone | AED 18.500 | fissa | **AED 2.500** |
| Visto investitore + Emirates ID | AED 12.000 | fissa | **AED 1.500** |
| Contabilità e VAT (annuale) | AED 14.400 | 10% | **AED 1.440** |
| Apertura conto bancario aziendale | AED 7.500 | fissa | **AED 900** |

- `fixed` → importo fisso in AED per contratto chiuso.
- `percent` → percentuale sul valore del contratto (si usa `clients.service_cost`
  se valorizzato, altrimenti il prezzo di listino).
- `ambassadors.commission_multiplier` permette accordi personalizzati
  (es. `1.20` = +20% su tutto il listino). Default `1`.

---

## Struttura dati

```
ambassador_services      catalogo servizi + regola di commissione
ambassadors              anagrafica (ref_code univoco, user_id, status, moltiplicatore)
ambassador_referrals     segnalazioni dal form  → collegate a clients
ambassador_commissions   commissioni maturate/pagate (UNIQUE su referral_id)
ambassador_summary       view di riepilogo per la pagina admin

clients.ambassador_id           chi ha segnalato il cliente
clients.ambassador_referral_id  la segnalazione di origine
pipeline_stages.is_won          la fase che fa maturare la commissione
```

**Idempotenza**: `ambassador_commissions.referral_id` è UNIQUE. Spostare un
cliente avanti e indietro nella pipeline non genera commissioni doppie.

---

## File

```
supabase/migrations/20260825_ambassador.sql   schema, RLS, seed
api/_ambassador-lib.js                        helper condivisi (non esposto come endpoint)
api/ambassador-lead.js                        form pubblico: GET info + POST segnalazione
api/ambassador-commission.js                  matura / paga / annulla una commissione
api/create-ambassador-user.js                 crea l'accesso e manda le credenziali
ambassador-lead.html                          landing pubblica del form  (/r/<codice>)
ambassadors.html                              pagina admin nel portale staff
ambassador/login.html                         login area ambassador
ambassador/dashboard.html                     area riservata ambassador
ambassador/amb.js                             client Supabase minimale dell'area
ambassador/manifest.json                      PWA (installabile su telefono)
```

---

## Sicurezza

- Le scritture pubbliche (form) passano **solo** dalle serverless function con
  service role: l'anon key non può scrivere su `ambassador_referrals` né su `clients`.
- Gli endpoint `ambassador-commission` e `create-ambassador-user` accettano solo
  chiamate di uno staff loggato (JWT verificato + ruolo controllato lato server).
- RLS: un ambassador legge **solo** le proprie segnalazioni e commissioni.
- La migrazione chiude anche una falla preesistente: essendo `authenticated`,
  un ambassador avrebbe potuto leggere l'intera tabella `clients` e la rubrica
  `profiles`. Ora entrambe le policy lo escludono.
- Il form ha un honeypot anti-bot e validazione lato server.

> **Nota**: la `service_role` key è hardcoded nei file `api/*.js` già presenti nel
> repo. I nuovi endpoint la leggono da `process.env.SUPABASE_SERVICE_ROLE_KEY` con
> fallback allo stesso valore. Quando ruoterai la chiave, imposta la variabile su
> Vercel e togli i fallback.

---

## Email inviate

| Evento | Destinatario | `event_type` |
|--------|--------------|--------------|
| Nuova segnalazione | Segreteria + staff | `ambassador_new_referral` |
| Conferma segnalazione | Ambassador | `ambassador_referral_ack` |
| Conferma ricezione | Lead | `ambassador_lead_ack` |
| Commissione maturata | Ambassador | `ambassador_commission` |
| Commissione pagata | Ambassador | `ambassador_commission_paid` |
| Credenziali di accesso | Ambassador | `ambassador_welcome` |

Tutti gli eventi si accendono/spengono da **Impostazioni Notifiche**.
