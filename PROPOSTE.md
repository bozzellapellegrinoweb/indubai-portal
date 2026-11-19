# Modulo Proposte

Proposte commerciali in PDF con link privato, accesso con codice e firma elettronica semplice, su carta intestata PB TAX.

## Come funziona

**Admin** (scheda cliente › Proposte)
1. Carica il PDF. Claude legge il testo e propone nome, telefono, email, titolo e importo; li confermi o li correggi.
2. Aggiungi altri destinatari (es. un socio), ciascuno col suo numero, e segni chi può firmare. Basta la firma di uno.
3. Scegli la scadenza in giorni. Il browser converte le pagine in immagini; il PDF originale va nel bucket privato `proposals`.
4. Il link `https://portal.indubai.it/p/<token>` (256 bit casuali) lo mandi tu, per WhatsApp o email, dai pulsanti della finestra del link.
5. Puoi copiare di nuovo il link, prorogare, revocare o generarne uno nuovo. Il cliente passa in pipeline a **Proposta inviata**.
6. Quando il cliente firma ricevi notifica nel portale, email e WhatsApp, più un task. **Controfirma** con un clic (la tua firma si imposta una volta).
7. Alla controfirma: PDF unico (proposta + firme + certificato), inviato per email a te e al firmatario, salvato in Documenti › *Proposte firmate*. Il cliente passa a **Proposta firmata** e la proposta non si modifica più.

**Cliente** (`/p/<token>`, nessun login)
- Inserisce il suo numero registrato, riceve un codice a 6 cifre (10 minuti, 5 tentativi) e vede la proposta.
- Le pagine sono immagini con filigrana impressa dal server (nome, numero parziale, data e ora di apertura). Non c'è niente da scaricare; copia, stampa e salvataggio sono disabilitati.
- Sessione di 30 minuti di inattività. Un cambio di IP o di dispositivo non blocca: viene registrato e notificato come informazione.
- Firma: "Accetto e firmo", poi firma scritta o disegnata, consenso e conferma.

## Dove sta il codice

| Parte | File |
|---|---|
| Database | `supabase/migrations/20261017_proposte.sql` |
| Funzione admin (login richiesto) | `supabase/functions/proposal-admin/` |
| Funzione pubblica | `supabase/functions/proposal-public/` (`verify_jwt = false`) |
| Moduli condivisi | `supabase/functions/_shared/proposals/` (adattatore codici, GHL, email, PDF finale, filigrana, registro) |
| Scheda cliente | `js/proposals-admin.js` (+ scheda in `client-detail.html`) |
| Pagina cliente | `proposta.html`, `js/proposta.js` (rotta `/p/:token` in `vercel.json`) |

## Tabelle (tutte con RLS)

| Tabella | Contenuto | Accesso |
|---|---|---|
| `proposals` | proposta, stato, scadenza, hash PDF e pagine, link (hash + copia cifrata) | lettura staff, scrittura solo dalle function |
| `proposal_recipients` | destinatari, numero E.164, chi firma | lettura staff |
| `proposal_otp_codes` | codici (solo HMAC), scadenza, tentativi | solo service role |
| `proposal_sessions` | sessioni del cliente, IP, dispositivo, paese | solo service role |
| `proposal_signatures` | firma e controfirma con hash, UTC/Dubai, IP, dispositivo, numero verificato | lettura staff, solo inserimento |
| `proposal_events` | registro a catena di hash (`proposal_events_verify()`) | lettura staff, solo inserimento |
| `proposal_countersigners` | firma salvata di chi controfirma | ognuno la propria |

Dei trigger (attivi anche per la service role) impediscono di modificare il contenuto dopo l'invio, toccare una proposta controfirmata e modificare o cancellare firme ed eventi.

## Attivazione

1. **SQL Editor di Supabase**, nell'ordine:
   - `supabase/migrations/20261017_proposte.sql`
   - `supabase/migrations/20261017_sicurezza_documenti_clienti.sql`
2. **Secret delle Edge Function** (Supabase › Edge Functions › Secrets):

   | Nome | Valore |
   |---|---|
   | `PROPOSAL_LINK_KEY` | stringa casuale di almeno 32 caratteri (`openssl rand -base64 48`) |
   | `OTP_PEPPER` | altra stringa casuale di almeno 32 caratteri |
   | `OTP_PROVIDER` | `email` per i test, poi `ghl` o `twilio_verify` |
   | `ADMIN_WHATSAPP_PHONE` | `+971585025012` |
   | `GHL_API_TOKEN`, `GHL_LOCATION_ID` | token privato GHL (nuovo, vedi Sicurezza) e location |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | solo se `OTP_PROVIDER=twilio_verify` |
   | `PB_TAX_LOGO_URL` | facoltativo: PNG del logo per la carta intestata del PDF finale |
   | `PROPOSALS_EMAIL_FROM` | facoltativo, default `PB TAX <noreply@indubai.it>` |

   `RESEND_API_KEY` e `ANTHROPIC_API_KEY` ci sono già.
3. **Vercel › Environment Variables**: `SUPABASE_SERVICE_ROLE_KEY` (obbligatoria, vedi Sicurezza) e `CRON_SECRET`.
4. Merge su `main`: la GitHub Action pubblica le Edge Function e Vercel pubblica le pagine.

## Codici di accesso: fornitori e costi

L'adattatore è in `_shared/proposals/otp.ts`: si cambia fornitore con `OTP_PROVIDER`, senza toccare il resto.

| Fornitore | Canale | Costo indicativo per codice verso UAE | Note |
|---|---|---|---|
| `email` | email (Resend) | incluso nel piano Resend | per i test; serve l'email di ogni destinatario |
| `ghl` | WhatsApp, ripiego SMS | tariffa Meta + eventuale ricarico GHL | serve un **template WhatsApp approvato** per i messaggi fuori dalla finestra di 24 ore |
| `twilio_verify` | WhatsApp, ripiego SMS | WhatsApp ≈ 0,05 $ + ≈ 0,018 $ Meta ≈ **0,07 $**; SMS ≈ 0,05 $ + 0,118 $ ≈ **0,17 $** | il mittente WhatsApp e il template li fornisce Twilio: si parte subito |

Su Twilio Verify i 0,05 $ si pagano solo sulle verifiche riuscite; i messaggi si pagano sempre. Tariffe da verificare prima dell'attivazione su [twilio.com/verify/pricing](https://www.twilio.com/en-us/verify/pricing) e [twilio.com/sms/pricing/ae](https://www.twilio.com/en-us/sms/pricing/ae).

## Limiti da sapere

- Gli screenshot non si possono impedire: il deterrente è la filigrana impressa nell'immagine.
- Le notifiche WhatsApp all'admin passano da GHL e sono best-effort: senza template approvato, fuori dalla finestra di 24 ore WhatsApp può rifiutarle. Portale ed email arrivano comunque.
- Il paese dell'accesso viene letto dagli header della richiesta quando ci sono. Se mancano non si registra, e quindi non scatta l'avviso "paese diverso".
- La firma è una firma elettronica semplice. Per atti che per legge richiedono una firma qualificata serve un altro strumento.
