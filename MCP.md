# MCP per Claude — InDubai Portal 🇦🇪

Server **MCP** (Model Context Protocol) privato del portale: collega Claude al portale
InDubai e gli permette di leggere i dati e di eseguire operazioni — dentro i permessi
dell'utente a cui il token è intestato.

> Riservato allo staff interno. Clienti e ambassador non possono usarlo: hanno le
> loro aree dedicate (`/client-portal`, `/ambassador`) e il server li rifiuta.

---

## In breve

| | |
|---|---|
| Endpoint | `https://portal.indubai.it/api/mcp` |
| Per area | `https://portal.indubai.it/mcp/<scope>` (es. `/mcp/finance`) |
| Transport | Streamable HTTP (JSON-RPC 2.0 su POST) |
| Auth | `Authorization: Bearer idb_mcp_…` |
| Gestione token | `/mcp.html` nel portale (sezione ADMIN) |
| Tool | 68, filtrati per ruolo e scope |
| Audit | tabella `mcp_audit_log` + pannello in `/mcp.html` |

---

## 1. Installazione (una volta sola)

### Database

Nel **SQL Editor** di Supabase esegui:

```
supabase/migrations/20261007_mcp_server.sql
```

Crea `mcp_tokens`, `mcp_audit_log`, la funzione `mcp_readonly_query()` usata dal tool
`sql_query` e — se non esiste già — `role_permissions`, la tabella da cui portale e
MCP leggono i permessi. Non inserisce righe: i ruoli senza riga continuano a usare i
default del codice, quindi nulla cambia per chi usa il portale oggi.

Concede anche `select` sulle view al `service_role`: il portale le legge con il token
dell'utente, l'MCP con il service_role, e senza quel grant i tool che le usano
rispondono «permission denied for view».

### Deploy

Nessuna variabile d'ambiente nuova: `api/mcp.js` riusa `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` come gli altri endpoint del portale. Basta il deploy
normale su Vercel.

Verifica che il server risponda:

```bash
curl -s https://portal.indubai.it/api/mcp?info=1 | jq
```

---

## 2. Creare un token

Portale → **ADMIN → MCP per Claude** (`/mcp.html`, solo admin).

1. Scegli **l'utente del portale**: il suo ruolo decide cosa Claude potrà vedere e fare.
2. Dai un nome al token (serve solo a riconoscerlo: "Claude desktop — Pellegrino").
3. Scegli scadenza, **sola lettura / lettura e scrittura** e l'**area di lavoro** (scope).
4. Copia il token: viene mostrato una volta sola. In database finisce solo il suo
   SHA-256, quindi non è recuperabile — se lo perdi, revochi e rigeneri.

La pagina stampa già i comandi pronti per Claude Code, Claude desktop e i connettori
di claude.ai.

---

## 3. Collegare Claude

### Claude Code (terminale)

```bash
claude mcp add --transport http indubai https://portal.indubai.it/api/mcp \
  --header "Authorization: Bearer idb_mcp_..."
```

### Claude desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "indubai": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://portal.indubai.it/api/mcp",
        "--header", "Authorization: Bearer idb_mcp_..."
      ]
    }
  }
}
```

### Claude.ai — connettore personalizzato

Impostazioni → Connettori → *Aggiungi connettore personalizzato*, URL
`https://portal.indubai.it/api/mcp` e header `Authorization: Bearer idb_mcp_…`.

Poi, in chat, basta chiedere:

> *"Quali estratti conto mancano questo mese?"*
> *"Fai la scheda completa di AARNIKO e dimmi cosa manca."*
> *"Crea un task urgente per Giuseppe: sollecitare gli estratti di marzo."*
> *"Quante scadenze VAT abbiamo nelle prossime 3 settimane?"*

---

## 4. Il modello di permessi

Non ce n'è uno nuovo: **l'MCP riusa quello del portale.**

```
token  →  utente (profiles.id)  →  ruolo  →  pagine abilitate  →  domini  →  tool
                                   (role_permissions, come in /users.html)
```

Ogni tool appartiene a un **dominio**, e ogni dominio è agganciato alle pagine del
portale che lo governano. Se un ruolo non vede `/finance.html`, i tool del dominio
`finance` **non esistono** per quella sessione: non compaiono in `tools/list`, non
sono invocabili, non c'è nulla da aggirare lato modello.

Sopra a questo agiscono tre restringimenti, che possono solo togliere:

| Leva | Dove si imposta | Effetto |
|---|---|---|
| `can_write` | per token, in `/mcp.html` | a `false` i tool che scrivono sparicono |
| `scope` | per token, o nell'URL `/mcp/<scope>` | limita i domini visibili |
| `allowed_tools` | per token, colonna di `mcp_tokens` | whitelist esplicita di nomi di tool |

Lo scope nell'URL **non allarga** mai: un token nato `finance` resta `finance` anche
chiamando `/mcp/all`.

### Tool visibili per ruolo

Con i permessi di default (`ROLE_PAGES_DEFAULT`, allineato a `js/app.js`):

| Ruolo | Con scrittura | Sola lettura |
|---|---|---|
| `admin` | 68 | 40 |
| `senior` | 50 | 30 |
| `junior` | 42 | 27 |
| `mini_admin` | 37 | 22 |
| `collaborator` | 37 | 22 |
| ruolo sconosciuto | accesso minimo (dashboard, task, notifiche) | |

Cambiare la matrice in `/users.html` cambia anche quello che quel ruolo vede da
Claude: una sola fonte di verità.

### Scope disponibili

| Scope | URL | Aree |
|---|---|---|
| `all` | `/api/mcp` | tutto quello che il ruolo consente |
| `readonly` | `/mcp/readonly` | tutto, nessuna scrittura |
| `clients` | `/mcp/clients` | clienti, onboarding, documenti, pipeline, lead, task |
| `compliance` | `/mcp/compliance` | VAT, Corporate Tax, estratti, abbonamenti, bilanci |
| `finance` | `/mcp/finance` | cashflow, spese, incassi, bilanci, riconciliazione |
| `hr` | `/mcp/hr` | ferie, permessi, dipendenti, bacheca |
| `growth` | `/mcp/growth` | ambassador, lead, pipeline, Affinitas |
| `ops` | `/mcp/ops` | task, bacheca, notifiche, documenti |

Gli scope sostituiscono un server MCP per ruolo: stesso endpoint, stesso codice, ma
un token "contabilità" porta in chat 32 tool pertinenti invece di 68.

---

## 5. Cosa può fare Claude

Tre livelli, dal più guidato al più libero:

1. **Tool di dominio** — `clients_search`, `client_get`, `vat_deadlines`,
   `statements_month`, `task_create`… filtrano e aggregano come fa il portale.
   Sono la via preferita.
2. **Tool generici** — `db_tables`, `db_schema`, `db_select`, `db_insert`,
   `db_update`, `db_delete` su ~45 tabelle e view, sempre filtrate per ruolo.
   Coprono tutto quello che i tool specifici non prevedono.
3. **`sql_query`** (solo admin) — SELECT/WITH libere per join e aggregazioni.

In più: 4 **risorse** (`indubai://sessione`, `indubai://schema`, `indubai://permessi`,
`indubai://dashboard`) e 4 **prompt** pronti (`briefing`, `chiusura_mese`,
`check_cliente`, `scadenze`).

---

## 6. Sicurezza

- **Token** — 32 byte casuali generati nel browser; in DB solo lo SHA-256. Confronto
  a tempo costante, scadenza e revoca immediata.
- **Service role confinato** — la chiave service_role resta lato server; i permessi
  li applica `api/_mcp-catalog.js` prima di ogni query, non la RLS.
- **Niente escalation** — `profiles`, `role_permissions`, `mcp_tokens`, `activity_log`
  e `mcp_audit_log` sono **in sola lettura** dai tool generici: si modificano solo
  dai tool dedicati, che validano ruoli e valori. `mcp_tokens.token_hash` non è mai
  leggibile.
- **`sql_query` in sola lettura** — doppia barriera: validazione sintattica (solo
  `SELECT`/`WITH`, una sola istruzione, nessuna parola chiave di scrittura) **e**
  `transaction_read_only` dentro la funzione, così anche un bypass della validazione
  non scrive. Sono irraggiungibili gli schemi `auth` e `vault` (hash delle password,
  segreti) e le tabelle `app_config` (segreto dell'import da Drive) e `mcp_tokens`
  (hash dei token) — per i token c'è `mcp_tokens_list`. La funzione è eseguibile solo
  dal `service_role`.
- **Guardie sulle scritture di massa** — `db_update` rifiuta più di 50 righe per
  chiamata (configurabile fino a 500), `db_delete` più di 10 e pretende
  `confirm: true`; entrambi richiedono filtri espliciti.
- **Audit** — ogni chiamata in `mcp_audit_log` con utente, ruolo, scope, tool,
  argomenti (password e token oscurati), esito, righe toccate, durata e IP. Le azioni
  sui clienti vanno anche in `activity_log`, quindi si vedono dal portale.
- **Rate limit** — 240 chiamate/minuto per token (best effort, per istanza).
- **Payload** — risultati oltre 400.000 caratteri vengono troncati con un avviso.

### Nota: chiave service_role nel repository

`SUPABASE_SERVICE_ROLE_KEY` è hardcodata come fallback in `api/_ambassador-lib.js`
e `api/create-user.js` da prima di questo lavoro. L'MCP riusa quella costante invece
di aggiungerne un'altra copia, ma la chiave va **ruotata** e spostata nelle env var
di Vercel: chi legge il repo ha pieno accesso al database.

---

## 7. Diagnostica

| Sintomo | Causa |
|---|---|
| `401 Token MCP non valido` | token sbagliato, o manca `Bearer ` davanti |
| `401 Token MCP revocato/scaduto` | rigenera da `/mcp.html` |
| `403 Il ruolo "client" non può usare l'MCP interno` | il token è su un profilo cliente/ambassador |
| Claude vede pochi tool | scope del token troppo stretto, o ruolo con poche pagine |
| `"…" scrive dati, ma questo token è di sola lettura` | rigenera il token con lettura e scrittura |
| `relation "mcp_tokens" does not exist` | migrazione non eseguita |
| `429 Troppe chiamate` | rate limit: attendi un minuto |

Debug rapido:

```bash
TOKEN=idb_mcp_...
curl -s https://portal.indubai.it/api/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

curl -s https://portal.indubai.it/api/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami"}}' | jq
```

---

## 8. Struttura del codice

```
api/
├── mcp.js                 ← endpoint HTTP: JSON-RPC, CORS, auth, dispatch
├── _mcp-lib.js            ← REST Supabase, token, permessi, audit, rate limit
├── _mcp-catalog.js        ← domini, scope, tabelle: QUI stanno i permessi
├── _mcp-tools.js          ← registro, risorse, prompt
├── _mcp-tools-data.js     ← sessione + tool dati generici (db_*, sql_query)
├── _mcp-tools-biz.js      ← clienti, onboarding, estratti, abbonamenti, VAT, CT
└── _mcp-tools-biz2.js     ← task, pipeline, spese, finance, HR, ambassador, …
mcp.html                   ← pannello admin: token, istruzioni, audit
supabase/migrations/20261007_mcp_server.sql
tests/mcp.test.mjs         ← node tests/mcp.test.mjs
```

### Aggiungere un tool

1. Scrivi la definizione nel file di dominio giusto:

```js
{
  name: 'esempio_tool',
  domain: 'clients',        // deve esistere in DOMAINS
  write: true,              // se modifica dati
  adminOnly: false,
  pages: ['broadcast'],     // opzionale: pagina più specifica del dominio
  title: 'Titolo breve',
  description: 'Cosa fa, in modo che Claude capisca quando usarlo.',
  inputSchema: { type: 'object', properties: { … }, required: […] },
  handler: async (args, ctx) => ({ … }),   // ctx: profile, role, pages, scope, canWrite
}
```

2. Se tocca una tabella nuova, aggiungila a `TABLES` in `_mcp-catalog.js` con
   dominio e `write`.
3. `node tests/mcp.test.mjs` — i test verificano nomi unici, domini validi, schemi
   e che il filtro per ruolo/scope/scrittura si comporti come deve.

Restituisci `_rows: n` dal handler per registrare le righe toccate nell'audit
(il campo viene rimosso dalla risposta).

---

## 9. Riferimento dei tool

### Sessione e metadati (`core`)

*Pagine: sempre disponibile*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `whoami` | Identita' della sessione MCP: utente del portale, ruolo, scope, se puo' scrivere, quali aree del portale sono accessibili. Chiamalo per primo se non sai cosa puoi fare. | — |
| `portal_map` | Struttura del portale InDubai: aree funzionali, scope MCP disponibili e tabelle raggiungibili dalla sessione corrente. Utile per orientarsi prima di una ricerca. | — |
| `search_everything` | Cerca un testo in tutto il portale: clienti, task, lead, documenti, ambassador, bacheca. Interroga solo le aree che il ruolo della sessione puo' vedere. | — |

### Accesso dati generico (`data`)

*Pagine: sempre disponibile*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `db_tables` | Elenco delle tabelle e view interrogabili dalla sessione, con dominio e se sono scrivibili. | — |
| `db_schema` | Colonne, tipi e default delle tabelle accessibili. Senza argomenti restituisce solo i nomi di colonna per tabella; passando "table" restituisce il dettaglio completo. | — |
| `db_select` | Legge righe da una qualsiasi tabella o view accessibile, con filtri, ordinamento e paginazione. Supporta le relazioni PostgREST nel parametro select (es. "id,company_name,tasks(title,status)"). | — |
| `db_count` | Quante righe soddisfano i filtri, senza scaricarle. | — |
| `db_insert` | Inserisce una o piu' righe. Con "upsert_on" aggiorna le righe in conflitto (es. upsert_on: "client_id,year,month" su bank_statements). | sì |
| `db_update` | Applica una patch alle righe che soddisfano i filtri. I filtri sono obbligatori e, per sicurezza, la chiamata si rifiuta se toccherebbe piu' di max_rows righe (default 50). | sì |
| `db_delete` | Elimina le righe che soddisfano i filtri. Richiede confirm: true e tocca al massimo max_rows righe (default 10). Operazione irreversibile. | sì |

### Clienti (`clients`)

*Pagine: `clients`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `clients_search` | Cerca clienti per ragione sociale, referente, email o telefono, con filtri su stato, partner contabile, VAT, referente interno. | — |
| `client_get` | Vista 360° di un cliente: anagrafica, onboarding, VAT, Corporate Tax, estratti conto e pagamenti recenti, task aperti, spese, documenti, snapshot Zoho, ambassador di provenienza. Le sezioni che il ruolo non puo' vedere vengono omesse. | — |
| `client_create` | Crea un nuovo cliente. La checklist di onboarding viene generata automaticamente dal trigger del database. Per creare anche l'accesso al portale cliente usa l'area Clienti. | sì |
| `client_update` | Modifica i campi di un cliente esistente. | sì |
| `client_timeline` | Ultime attivita' registrate su un cliente: audit log, task, email inviate. | — |

### Onboarding (`onboarding`)

*Pagine: `onboarding`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `onboarding_status` | Checklist di onboarding dei clienti, con percentuale di completamento e passi mancanti. Di default mostra solo gli onboarding non completati. | — |
| `onboarding_set` | Spunta o rimuove passi della checklist di onboarding. Passi validi: whatsapp_group, call_scheduled, docs_in_drive, eid_verified, uae_phone_verified, corporate_tax_check, fta_profile_created, ct_registration_done, payment_link_sent, bank_accounts_noted. Con completed: true segna l'onboarding come chiuso. | sì |

### Documenti (`documents`)

*Pagine: `documents`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `documents_list` | Documenti caricati nel portale, per cliente o cartella. | — |
| `document_link` | Genera un URL firmato per scaricare un documento del portale. Il link scade (default 1 ora). | — |

### Estratti conto (`statements`)

*Pagine: `statements`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `statements_month` | Stato degli estratti conto per un mese: ricevuti, registrati, mancanti. Considera solo i clienti attivi in bilancio. | — |
| `statement_set` | Imposta ricevuto/registrato (e note) per l'estratto conto di un cliente in un mese. | sì |

### Abbonamenti (`payments`)

*Pagine: `payments`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `payments_month` | Stato dei pagamenti di abbonamento per un mese, con totale incassato e clienti in sospeso. | — |
| `payment_set` | Imposta stato, importo e note del pagamento di abbonamento di un cliente per un mese. | sì |

### Bilanci (`bilanci`)

*Pagine: `bilanci`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `balance_month` | Righe di bilancio mensile per cliente: estratti ricevuti, pagato a noi, pagato al VAT. | — |
| `balance_set` | Imposta gli importi di bilancio mensile di un cliente. | sì |

### VAT register (`vat`)

*Pagine: `vat`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `vat_deadlines` | Scadenze dei VAT return nei prossimi N giorni (default 30), ordinate per data. Include il partner contabile e i pagamenti registrati. | — |
| `vat_set` | Crea o aggiorna la riga VAT di un cliente: date di domanda/approvazione, scadenze, pagamenti. | sì |

### Corporate Tax (`corptax`)

*Pagine: `corp-tax`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `corptax_list` | Registrazioni Corporate Tax dei clienti, con scadenze e stato della domanda. | — |
| `corptax_set` | Crea una registrazione Corporate Tax per un cliente, oppure aggiorna quella indicata con record_id. | sì |

### Task (`tasks`)

*Pagine: `tasks`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `tasks_list` | Task del portale con filtri su stato, assegnatario, cliente, priorita', categoria e scadenza. Usa assigned_to: "me" per i propri. | — |
| `task_create` | Crea un task, eventualmente collegato a un cliente e assegnato a un membro dello staff. L'assegnatario riceve la notifica in-app dal portale. | sì |
| `task_update` | Cambia stato, assegnatario, priorita', scadenza o testo di un task. Con status "completed" imposta anche completed_at. | sì |
| `task_comment` | Aggiunge un commento a un task e notifica l'assegnatario. | sì |

### Pipeline commerciale (`pipeline`)

*Pagine: `pipeline`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `pipeline_board` | Fasi della pipeline con i clienti presenti in ciascuna. | — |
| `client_set_stage` | Assegna un cliente a una fase della pipeline (per nome della fase o stage_id). | sì |

### Lead (`leads`)

*Pagine: `lead-analytics`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `leads_list` | Lead registrate dal sito/chat, con ultima attivita' e sezioni visitate. | — |

### Spese (`expenses`)

*Pagine: `expenses`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `expenses_list` | Spese caricate dai clienti, con stato di approvazione, categoria Zoho e IVA. | — |
| `expense_review` | Imposta lo stato di una spesa cliente (approved / rejected / pending), registrando chi ha deciso. | sì |

### Affinitas (`affinitas`)

*Pagine: `affinitas`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `affinitas_list` | Abbonamenti Affinitas con pacchetto, importo, stato e prossimo pagamento. | — |

### Bacheca (`board`)

*Pagine: `bacheca`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `board_feed` | Post della bacheca con autore, allegati e commenti. | — |
| `board_post` | Crea un post in bacheca a nome dell'utente del token. | sì |
| `board_comment` | Aggiunge un commento a un post della bacheca. | sì |

### Notifiche e broadcast (`notify`)

*Pagine: `notifiche`, `broadcast`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `notifications_list` | Notifiche in-app del portale. Per default solo le proprie non lette. | — |
| `notification_send` | Crea una notifica in-app per uno o piu' membri dello staff (visibile nel portale, campanella in alto). Non invia push: per quello usa push_broadcast. | sì |
| `push_broadcast` | Invia una notifica push via OneSignal a tutti, a un cliente specifico o a una company. Richiede l'accesso alla pagina Broadcast. | sì |

### Ferie e dipendenti (`hr`)

*Pagine: `ferie`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `leave_requests_list` | Richieste di ferie, permessi e malattia, con stato e dipendente. Di default mostra quelle da approvare. | — |
| `leave_decide` | Approva o rifiuta una richiesta di ferie/permesso e notifica il dipendente. Solo admin, come nel portale. | sì |
| `employees_overview` | Elenco dei dipendenti con giorni di ferie annuali, giorni approvati nell'anno e residuo. | — |

### Report e dashboard (`reports`)

*Pagine: `index`, `reports`*

| Tool | Cosa fa | Scrive |
|---|---|---|
| `dashboard_kpis` | Gli stessi indicatori della home del portale: clienti attivi, estratti mancanti, abbonamenti con problemi, scadenze VAT nei prossimi 30 giorni. | — |
| `monthly_report` | Riepilogo di un mese: incassi abbonamenti per stato, estratti conto ricevuti/registrati, task chiusi e aperti, spese approvate. | — |
| `activity_log_list` | Attivita' registrate nel portale, filtrabili per utente, cliente, azione e periodo. | — |

### Cashflow di gruppo (`finance`)

*Pagine: `finance` — **solo admin***

| Tool | Cosa fa | Scrive |
|---|---|---|
| `finance_summary` | Sintesi mensile del cashflow di gruppo per categoria e conto, dalla view finance_monthly_summary. | — |
| `finance_transactions` | Movimenti del cashflow di gruppo, con filtri su conto, periodo, categoria, importo e testo. | — |
| `finance_categorize` | Imposta categoria, flag interno e note di un movimento bancario. | sì |

### Programma ambassador (`ambassador`)

*Pagine: `ambassadors` — **solo admin***

| Tool | Cosa fa | Scrive |
|---|---|---|
| `ambassadors_list` | Ambassador con codice referral, stato, moltiplicatore e totali di segnalazioni e commissioni. | — |
| `ambassador_referrals` | Segnalazioni arrivate dai link ambassador, con stato e cliente collegato. | — |
| `ambassador_commissions` | Commissioni maturate, pagate o annullate, con totali per stato. | — |
| `commission_set_status` | Segna una commissione come pagata, maturata o annullata. | sì |

### Utenti e permessi (`users`)

*Pagine: `users` — **solo admin***

| Tool | Cosa fa | Scrive |
|---|---|---|
| `users_list` | Profili interni con ruolo e data di creazione. | — |
| `user_create` | Crea un account staff (auth + profilo) con un ruolo del portale. Per clienti e ambassador usa le rispettive aree del portale. | sì |
| `user_set_role` | Imposta il ruolo di un profilo interno. Non puoi cambiare il tuo stesso ruolo. | sì |
| `user_reset_password` | Sostituisce la password di un utente interno. Comunicala tu all'interessato. | sì |
| `role_permissions_get` | Pagine del portale abilitate per ogni ruolo (tabella role_permissions). Un array vuoto significa "tutte le pagine". | — |
| `role_permissions_set` | Imposta le pagine abilitate per un ruolo. Array vuoto = tutte le pagine. Vale anche per i tool MCP: cambiare qui cambia cosa quel ruolo vede da Claude. | sì |

### Amministrazione MCP (`admin`)

*Pagine: `mcp` — **solo admin***

| Tool | Cosa fa | Scrive |
|---|---|---|
| `sql_query` | Esegue una SELECT (o WITH) arbitraria sul database del portale. Solo lettura: la transazione e' read-only e le parole chiave di scrittura sono rifiutate. Gli schemi auth e vault non sono accessibili. Usalo per join, aggregazioni e analisi che i tool specifici non coprono. | — |
| `mcp_tokens_list` | Token MCP emessi, con utente, scope, permessi di scrittura, uso e scadenza. | — |
| `mcp_token_revoke` | Disattiva immediatamente un token MCP. Operazione non reversibile. | sì |
| `mcp_audit` | Ultime chiamate ai tool MCP: chi, cosa, con quali argomenti e con che esito. | — |

---

_Documento generato insieme al server: se aggiungi tool, aggiorna la tabella qui sopra._
