# Il portale esistente — come è fatto e dove si innesta la Regia

Lettura del repository `bozzellapellegrinoweb/indubai-portal` fatta prima di
scrivere una riga di codice SMM. Serve a innestare la nuova sezione senza
rompere niente.

---

## 1. Stack

| Strato | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript **vanilla**. Nessun framework, nessun build step |
| Hosting | Vercel (`buildCommand: "echo skip"`, `outputDirectory: "."`) |
| Serverless | Funzioni Vercel in `/api/*.js` (Node, ESM) |
| Database | Supabase PostgreSQL, progetto `gvdoqcgkzbziqufahhxh` |
| Auth | Supabase Auth email/password, sessione in `localStorage` |
| Edge | Supabase Edge Functions (Deno) in `supabase/functions/*` |
| Push | OneSignal (app id `06f381cd-…`) via edge function `send-notification` |
| Email | Resend via edge function `send-email` |
| App mobile | Capacitor → iOS, ma **solo per `client-portal`** |
| App "desktop" | PWA (`manifest-admin.json`, `display: standalone`). Nessun Electron, nessun Tauri |

**Conseguenza n.1 per la Regia:** non c'è React. Niente React Three Fiber,
niente drei. Il 3D va in **Three.js puro**, caricato come ES module da CDN.

**Conseguenza n.2:** la CSP in `vercel.json` già consente
`script-src … https://cdn.jsdelivr.net https://cdnjs.cloudflare.com` e
`connect-src … https://cdn.jsdelivr.net`. Three.js da jsDelivr passa senza
toccare la CSP. `img-src 'self' data: https:` consente le texture generate e le
miniature. Va aggiunto solo `blob:` a `img-src`/`media-src` se si useranno
object URL per le anteprime video locali.

---

## 2. Routing

Nessun router: **una pagina = un file HTML nella root**. `vercel.json` ha
`cleanUrls: true`, quindi `/regia` serve `regia.html`.

L'id di permesso di una pagina si ricava dal nome del file:
```js
const currentPage = window.location.pathname.split('/').pop().replace('.html','') || 'index';
```
`js/app.js:10`. Quindi **l'id del permesso deve coincidere col nome del file**.

Ordine degli script in ogni pagina:
```html
<script src="/js/config.js"></script>   <!-- nel <head> -->
...
<script src="/js/supabase.js"></script> <!-- fine body -->
<script src="/js/app.js"></script>
<script src="/js/i18n.js"></script>     <!-- opzionale -->
```

---

## 3. Autenticazione

`js/supabase.js`:
- `signIn()` chiama `/auth/v1/token?grant_type=password`, salva in
  `localStorage` sotto la chiave `indubai_session`, poi carica il profilo da
  `profiles` e lo mette in `session.profile`.
- `sbFetch()` è il wrapper di tutte le chiamate REST: mette `apikey` + `Bearer`,
  e su 401 tenta **una volta** il refresh del token e riprova.
- `requireAuth()` rimanda a `/login.html` se non c'è token.
- `isAdmin()` legge `session.profile.role === 'admin'`.

`js/app.js` all'avvio dirotta chi non è staff:
- `role === 'client'` → `/client-portal/dashboard.html`
- `role === 'ambassador'` → `/ambassador/dashboard.html`

---

## 4. Ruoli e permessi

### I ruoli che esistono davvero

L'enum `user_role` nel database **live** (verificato, non dedotto dallo schema,
che è rimasto indietro) ha 9 valori:

```
admin, staff, mini_admin, senior, junior, client, ambassador, commerciale, collaborator
```

`supabase/schema.sql:12` dichiara solo `('admin','staff')`: gli altri sono stati
aggiunti nel tempo, alcuni senza migrazione versionata. `js/notify.js:42` lo
dice esplicitamente a proposito di `collaborator`.

### Come funziona la concessione

Tre pezzi, documentati in `CLAUDE.md`, e servono **tutti e tre**:

1. `allNavItems` in `js/app.js:96` — la voce di menu, in una sezione normale,
   **non** dentro un blocco `...(role === 'admin' ? [...] : [])`.
2. `ROLE_PAGES_DEFAULT` in `js/app.js:32` — i valori predefiniti per ruolo.
   `users.html` li rilegge da `window.ROLE_PAGES_DEFAULT`, non tiene copie.
3. `ALL_PAGES` in `users.html:383` — la voce nella matrice permessi.

Più, in `users.html`: `MANAGEABLE_ROLES` (riga 382), `ROLE_LABELS` (174),
`ROLE_COLORS` (175) e la classe CSS `.rb-<ruolo>` (righe 16-21).

`_getAllowed()` (`js/app.js:46`): solo `admin` vede tutto (`null`). Gli altri
leggono `role_permissions` (cache in `sessionStorage` sotto
`indubai_role_perms`), poi i predefiniti, poi — ruolo sconosciuto — il minimo
`['index','tasks','notifiche']`.

`window.canSeePage(id)` (`js/app.js:60`) è il controllo per gli strumenti che
vivono dentro un'altra pagina.

### Stato attuale della tabella

`role_permissions` è **vuota**. Quindi oggi tutti i ruoli stanno sui
predefiniti di `js/app.js`. Un ruolo nuovo che non compare in
`ROLE_PAGES_DEFAULT` cade sul minimo e non vede la Regia: il ruolo `smm` va
aggiunto lì.

Tabella: `role_permissions(role text primary key, allowed_pages text[])`,
array vuoto = tutte le pagine. RLS: lettura a tutti gli autenticati, scrittura
solo admin. `supabase/migrations/20261007_mcp_server.sql:183`.

`savePermissions()` (`users.html:535`) scrive solo i ruoli di
`MANAGEABLE_ROLES` e conserva le pagine fuori catalogo (riga 549) — rete di
sicurezza, non sostituto del passaggio 3.

### Interruttori per persona

`profiles.tasks_scope` (`all`/`own`), `profiles.can_see_financials`,
`profiles.clients_scope`. Protetti dal trigger
`profiles_protect_privileges()`: chi non è admin può cambiare solo nome e
avatar, gli altri campi tornano com'erano **in silenzio**.
`supabase/migrations/20261016_permessi_utenti.sql`.

### Funzioni SQL già disponibili

`is_portal_admin()`, `is_portal_staff()`, `sees_financials()`,
`is_commerciale()`, `sees_only_assigned_clients()`, `sees_all_tasks()`,
`can_see_wills()`, `wills_default_roles()`.

Tutte `stable security definer set search_path to 'public'` — una policy su
`profiles` che interroga `profiles` andrebbe in ricorsione.

**`can_see_wills()` è il modello da copiare** per la Regia: legge la matrice
permessi dentro una policy RLS, con fallback ai predefiniti del ruolo.
`supabase/migrations/20261106_permesso_testamento.sql`.

---

## 5. Supabase: cosa è già in uso

### Tabelle (45 in `public`, al 2026-11-10)

```
activity_log  ambassador_applications  ambassador_commissions  ambassador_referrals
ambassador_services  ambassador_summary  ambassadors  app_config  bilanci
board_comments  board_mentions  board_posts  client_expenses  client_files
client_financials  client_practices  client_users  client_visas  clients
clients_missing_bank_statements  clients_subscription_status  dashboard_current_month
email_log  employees  finance_monthly_summary  leave_requests  mcp_audit_log
mcp_oauth_clients  mcp_oauth_codes  mcp_tokens  notification_settings
notifications  onboarding_checklist  parsed_transactions  pipeline_stages
profiles  statement_uploads  subscription_payments  task_comments  tasks
vat_register  will_intakes  will_onboardings  zoho_snapshots  zoho_token_cache
```

**Nessuna tabella SMM.** Il prefisso `smm_` è libero.

### RLS

Attiva su tutte le tabelle applicative. Il pattern ricorrente è
`for all to authenticated using (<funzione di perimetro>)`.

### Storage: 3 bucket

| Bucket | Pubblico | Limite | MIME |
|---|---|---|---|
| `client-documents` | no | 50 MB | lista chiusa (pdf, immagini, office, zip) |
| `expense-receipts` | no | 15 MB | immagini + pdf |
| `task-attachments` | **sì** | 10 MB | qualunque |

Nessun bucket adatto ai media SMM: il più capiente sta a 50 MB e l'unico
pubblico è quello sbagliato. **Serve un bucket nuovo, privato.**

L'upload oggi passa da `/api/upload.js`: il browser manda il file come
**base64 in un body JSON**, limite `10mb`, e la funzione lo carica con la chiave
`service_role`. Per file da 1-2 GB è inutilizzabile — base64 gonfia del 33% e
Vercel ha un tetto molto più basso. Serve un'altra strada (vedi
`docs/SMM_PIANO.md` § Media).

### Realtime: **non è in uso**

La publication `supabase_realtime` esiste ma `puballtables = false` e **non ha
nessuna tabella associata** (verificato). Nessuna pagina del portale usa
`postgres_changes`: `attivita.html:322` fa polling ogni 60 secondi.

Per animare gli avatar senza refresh bisogna quindi fare due cose: aggiungere le
tabelle SMM alla publication (`alter publication supabase_realtime add table …`)
e includere il client Realtime, che oggi il portale non carica. Siccome il
portale non usa l'SDK Supabase ma `fetch` a mano, la via più leggera è il
**websocket Realtime nativo**, oppure polling adattivo come fallback.

### Edge Functions esistenti

`notify-deadlines`, `ghl-lead-analytics`, `ghl-booking`, `send-notification`,
`drive-import-client`, `employee-report`, `lara-chat`, `news-aggregator`,
`expense-zoho`, `zoho-proxy`, `register-device`, `send-email`, `client-expense`.

`lara-chat` **già usa `ANTHROPIC_API_KEY`** da `Deno.env.get()`: il segreto
Anthropic è già configurato sul progetto Supabase, e c'è già un precedente di
chiamata all'API di Anthropic da una edge function.

---

## 6. Notifiche e push

Due canali, entrambi via edge function, entrambi incapsulati in `js/notify.js`:

- `pushNotify({action, title, message, user_id, url})` → `send-notification` →
  OneSignal. `action: 'send_to_user'` filtra per tag `client_id = user_id`.
- `emailNotify({user_id|to, subject, html, event_type, …})` → `send-email` →
  Resend.
- `pushNotifyStaff({roles, …})` e `emailNotifyStaff({roles, …})` risolvono i
  `user_id` dei ruoli e inviano in parallelo.

**Attenzione:** `getStaffUserIds()` filtra i ruoli contro `VALID_STAFF_ROLES =
['admin','senior','mini_admin','junior','staff']` (`js/notify.js:42`). Il ruolo
`smm` non c'è: va aggiunto, altrimenti le notifiche al social media manager
vengono scartate in silenzio.

`notification_settings(event_type, enabled, roles)` è la configurazione admin,
con precedenza sui destinatari e logica **fail-open** (evento non mappato =
invia). Gestita da `/notifiche-admin.html`.

Notifiche dentro il portale: tabella `notifications(user_id, type, title, body,
link, entity_type, entity_id, read, created_at)`, pagina `/notifiche.html`.

---

## 7. Bacheca e log attività

- Bacheca: `board_posts`, `board_comments`, `board_mentions` +
  `bacheca.html`. Senza realtime.
- Log: `activity_log(user_id, client_id, action, details jsonb, created_at)`.
  Si scrive con `sb.db.log(action, clientId, details)` — non bloccante, errori
  ingoiati (`js/supabase.js`). Pagina `/attivita.html`.

---

## 8. Convenzioni di codice e stile

### Codice

- Italiano per commenti, nomi di funzioni di dominio e messaggi utente.
- I commenti spiegano **perché**, spesso raccontando il bug che la riga evita.
  Vale la pena mantenere questo stile.
- Niente classi: funzioni e oggetti letterali. Export via `window.*`.
- `sb.db.select/insert/update/delete/upsert` per i dati, mai `fetch` diretto
  quando esiste l'helper.
- `ui.showToast(msg, 'success'|'error')` per il feedback.
- `ui.escapeHtml()` prima di interpolare testo utente nell'HTML.
- Le date si formattano con `ui.formatDate()`, i mesi con `ui.MONTHS_FULL`.

### Grafica

Token in `css/style.css:root`:

```
--primary #14161a   --accent #47ee74    --accent-dark #16a34a
--bg #f7f6f2        --surface #ffffff   --surface2 #f1efe8
--border #e7e4dc    --text #14161a      --text-muted #6b6f76
--success #16a34a   --danger #dc2626    --warning #d97706   --info #0369a1
--radius 14px       --sidebar-w 240px   --transition .18s ease
--shadow / --shadow-lg
```

Font Inter (Google Fonts, pesi 400-900). Tema **chiaro, caldo, poco contrasto**:
sfondo sabbia `#f7f6f2`, superfici bianche, bordi `1.5px` color sabbia, accento
verde. Classi condivise: `.app-layout`, `.main-content`, `.topbar`,
`.topbar-title`, `.topbar-subtitle`, `.topbar-actions`, `.page-content`,
`.btn .btn-accent .btn-ghost .btn-sm`, `.modal-overlay .modal .modal-header`,
`.badge`, `.spinner`, `.loading-overlay`.

Nota: il brand dei **contenuti** social è scuro con accento lime `#b5ff00`
(`lib/brands.ts`), il brand del **portale** è chiaro con accento verde
`#47ee74`. La Regia è una pagina del portale: segue il portale. La scena 3D
sarà quindi chiara e luminosa, come chiede il riferimento, e i colori lime
compaiono solo dentro le anteprime dei contenuti.

---

## 9. Chiavi scritte nel codice — da sistemare, indipendentemente dalla Regia

Il repository del portale è **pubblico** su GitHub. Dentro ci sono segreti.

### 9.1 Chiave `service_role` di Supabase

È la chiave che **bypassa tutte le policy RLS**: con quella si legge e si
scrive qualunque riga di qualunque tabella, compresi passaporti, IBAN e dati
dei testamenti. È scritta in chiaro in 14 file:

```
api/_ambassador-lib.js:10        api/create-client-user.js:2
api/create-user.js:2             api/delete-client-user.js:2
api/delete-leave-request.js:2    api/delete-user.js:2
api/leave-requests.js:3          api/seed-leave-data.js:2
api/trigger-employee-report.js:9 api/trigger-notifications.js:9
api/update-password.js:2         api/upload.js:8
setup.html:88
supabase/functions/zoho-proxy/index.ts:8
```

`setup.html:88` è il caso peggiore: **è una pagina HTML servita al browser**.
Chiunque apra `https://<dominio>/setup.html` e guardi il sorgente ha la chiave,
senza bisogno di GitHub.

Cosa va fatto, in quest'ordine:
1. Ruotare la chiave dal pannello Supabase (Settings → API → *Reset service
   role key*). Tutto quello che la usa si rompe fino al passo 2: va fatto in
   una finestra concordata.
2. Mettere la chiave nuova come variabile d'ambiente su Vercel
   (`SUPABASE_SERVICE_ROLE_KEY`) e leggerla con `process.env` nelle funzioni
   `/api/*`; su Supabase le edge function la hanno già come
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Togliere del tutto la chiave da `setup.html`: una pagina che deve fare
   operazioni privilegiate chiama una funzione `/api/*`, non parla con il
   database da sola.
4. Valutare se rendere privato il repository, e in ogni caso ricordare che la
   chiave vecchia resta nella **storia git**: la rotazione del passo 1 è
   l'unica cosa che la rende inutile.

### 9.2 Token GoHighLevel

Un token di integrazione GHL (`pit-…`) è scritto in chiaro in:

```
supabase/functions/ghl-booking/index.ts:3
supabase/functions/ghl-lead-analytics/index.ts:3
supabase/functions/lara-chat/index.ts:9
```

Dà accesso a calendari, contatti e conversazioni della location GHL. Va
ruotato e spostato in un secret `GHL_API_KEY` (lo stesso nome che usa il
social manager, così c'è una sola convenzione).

### 9.3 Cose che invece sono normali

- `js/config.js` e `client-portal/config.js` contengono la chiave **`anon`**.
  È fatta per stare nel browser: è pubblica per progetto e da sola non dà
  accesso a niente, perché le policy RLS valutano il JWT dell'utente.
- `supabase/functions/send-notification/index.ts:3` ha l'**app id** OneSignal,
  che è un identificativo pubblico, non un segreto. La chiave API sta in
  `Deno.env.get('ONESIGNAL_API_KEY')`.

In nessun file di documentazione, commit o log di questo lavoro ho scritto il
valore di una chiave.

---

## 10. Dove si innesta la Regia

| Cosa | Dove |
|---|---|
| Pagina | `regia.html` nella root, id di permesso `regia` |
| Voce di menu | `js/app.js` `allNavItems`, sezione nuova `SOCIAL` |
| Predefiniti | `js/app.js` `ROLE_PAGES_DEFAULT`, con il ruolo `smm` nuovo |
| Matrice | `users.html` `ALL_PAGES`, sezione `SOCIAL` |
| Ruolo | `alter type user_role add value 'smm'` + label, colore e badge in `users.html` |
| Notifiche | `smm` dentro `VALID_STAFF_ROLES` in `js/notify.js` |
| Dati | tabelle `smm_*` su Supabase, RLS con `can_see_smm()` sul modello di `can_see_wills()` |
| Realtime | tabelle SMM aggiunte a `supabase_realtime` |
| Media | bucket privato nuovo `smm-media` |
| Agenti | edge function `smm-worker` (Deno) + coda su Supabase |
| Pubblicazione | edge function `smm-publish` che riscrive `publishToGHL()` |
| Log | ogni scrittura importante anche in `activity_log` |

La voce `smm` che oggi esiste in `js/app.js:129` punta all'app esterna ed è
**cablata per il solo admin**, quindi invisibile al sistema permessi: è
esattamente ciò che `CLAUDE.md` vieta. Resta dov'è (l'app esterna continua a
funzionare e serve ancora), ma viene spostata in una sezione normale e resa
concedibile, così anche il manager può aprirla.
