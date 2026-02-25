# InDubai Portal 🇦🇪

Portale di gestione clienti per **InDubai.it** — segreteria abbonati, estratti conto, VAT register, Corporate Tax e onboarding.

---

## Stack

| Layer | Tecnologia |
|-------|-----------|
| Frontend | HTML/CSS/JS custom |
| Hosting | Vercel |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Repo | GitHub |

---

## Setup iniziale

### 1. Supabase — Schema

Apri il **SQL Editor** nel tuo progetto Supabase ed esegui nell'ordine:

```
supabase/schema.sql     ← struttura tabelle, RLS, trigger, views
supabase/seed_data.sql  ← dati iniziali (97 clienti da Excel)
```

### 2. Supabase — Variabili d'ambiente

Crea un file `.env` nella root del progetto (non committare mai questo file):

```env
SUPABASE_URL=https://XXXX.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. Vercel — Deploy

```bash
# Collega il repo
vercel link

# Aggiungi le env vars
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY

# Deploy
vercel --prod
```

### 4. Crea i primi utenti (admin)

Dopo il deploy, vai su **Supabase → Authentication → Users** e crea gli account per Pellegrino e Giuseppe.

Per impostare il ruolo admin, esegui nel SQL Editor:
```sql
update profiles
set role = 'admin'
where id = 'UUID-UTENTE';
```

---

## Struttura Database

```
clients                    ← anagrafica master (97 clienti)
├── onboarding_checklist   ← checklist per ogni nuovo cliente (1:1)
├── bank_statements        ← estratti conto per mese/anno (N:1)
├── subscription_payments  ← pagamenti abbonamento per mese/anno (N:1)
├── vat_register           ← dati VAT e scadenze (1:1)
├── corporate_tax          ← registrazioni CT per mese (N:1)
└── monthly_balance        ← bilancio mensile (N:1)

affinitas_subscriptions    ← abbonati piattaforma Affinitas
profiles                   ← utenti interni (Pellegrino, Giuseppe, staff)
activity_log               ← audit trail di tutte le azioni
```

### Views preconfigurate

| View | Descrizione |
|------|-------------|
| `dashboard_current_month` | KPIs aggregati per il mese corrente |
| `clients_subscription_status` | Status pagamento per tutti i clienti del mese |
| `clients_missing_bank_statements` | Clienti senza estratti conto nel mese corrente |

---

## Rigenera il seed (dopo aggiornamenti Excel)

```bash
pip3 install pandas openpyxl
python3 scripts/seed.py --excel /path/to/2026_Segreteria.xlsx --out supabase/seed_data.sql
```

> ⚠️ Esegui il seed solo su un database vuoto oppure usa `TRUNCATE clients CASCADE;` prima.

---

## Flusso operativo

```
1. Nuovo cliente
   └── Aggiungi in clients → onboarding_checklist creata automaticamente

2. Inizio mese
   └── Richiedi estratti → aggiorna bank_statements.received

3. Durante il mese
   └── Verifica subscription_payments → aggiorna status (ok/failed/ecc.)
   └── Registra estratti → aggiorna bank_statements.registered

4. Scadenze VAT
   └── Monitora vat_register.return_deadline_*
   └── Dashboard segnala scadenze nei prossimi 30 giorni

5. Corporate Tax
   └── Traccia in corporate_tax per mese di competenza
```

---

## Struttura file

```
indubai-portal/
├── index.html              ← Dashboard
├── clients.html            ← Lista clienti
├── client-detail.html      ← Dettaglio cliente + onboarding
├── bank-statements.html    ← Griglia estratti conto
├── subscriptions.html      ← Pagamenti abbonamenti
├── vat-register.html       ← VAT scadenze
├── corporate-tax.html      ← Corporate Tax tracker
├── js/
│   ├── supabase.js         ← Client Supabase
│   ├── auth.js             ← Login/logout/ruoli
│   ├── clients.js
│   ├── bank-statements.js
│   ├── subscriptions.js
│   ├── vat.js
│   └── utils.js
├── css/
│   └── style.css
├── supabase/
│   ├── schema.sql          ← Schema completo
│   └── seed_data.sql       ← Dati iniziali da Excel
└── scripts/
    └── seed.py             ← Script per rigenera seed da Excel
```
