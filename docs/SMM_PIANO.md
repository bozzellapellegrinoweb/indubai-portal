# Piano — la Regia SMM dentro il portale

Breve, come chiesto. Le scelte sono motivate dove il prompt chiedeva di
motivarle. Dettagli di contesto in `SMM_INVENTARIO.md` e `SMM_PORTALE.md`.

---

## Le tre scelte di fondo

### 1. 3D: Three.js puro, non React Three Fiber

Il portale è HTML/JS vanilla senza build step (`SMM_PORTALE.md` § 1). React
Three Fiber e drei richiedono React e un bundler: introdurli vorrebbe dire
portare un build step in un progetto che oggi si deploya con
`buildCommand: "echo skip"`. Quindi **Three.js puro** come ES module da
jsDelivr, che la CSP già consente.

Due conseguenze pratiche:
- Il fumetto sopra la testa (`drei Html`) non esiste: lo rifaccio proiettando
  la posizione 3D in coordinate schermo e posizionando dei `div` HTML sopra il
  canvas. Stesso risultato, nessuna dipendenza.
- Per l'occlusione ambientale non uso SSAO (costa troppo su telefono): uso
  ombre morbide `PCFSoftShadowMap` più un piano di "contact shadow" con texture
  radiale sotto ogni oggetto. L'effetto è lo stesso a occhio e gira a 60fps su
  un telefono. Tone mapping ACES filmic, vignettatura leggera in CSS: questo è
  il "post-processing sobrio".

### 2. Media: Supabase Storage per gli originali, Cloudinary solo per ciò che GHL deve scaricare

Requisiti: upload riprendibile fino a 1-2 GB, barra di avanzamento, link
firmati a scadenza mai pubblici, anteprime leggere automatiche, originale
conservato con i derivati collegati, pulizia dei file vecchi.

- **Supabase Storage** ha l'upload riprendibile (protocollo TUS), i link
  firmati a scadenza, i bucket privati con RLS, e sta nello stesso progetto che
  ha già i permessi e i ruoli. Non ha trasformazioni video.
- **Cloudinary** ha le trasformazioni video, ed è già pagato e già usato: il
  reel di oggi è assemblato da una sua transformation URL senza ffmpeg
  (`R-GHL-13`, `lib/upload.ts`). Però le URL di delivery sono pubbliche.

**Scelta: entrambi, con ruoli diversi.** Supabase Storage è l'archivio privato
di ciò che il manager carica e di ciò che gli agenti producono: originali,
anteprime, poster, reference. Cloudinary ospita **solo** i derivati che GHL
deve poter scaricare al momento della pubblicazione — che è l'unica eccezione
al "mai pubblico" prevista dal prompt.

Perché non solo Cloudinary: i video grezzi del manager (1-2 GB) non devono
stare su una CDN pubblica, e il limite per file dei piani Cloudinary non
regge quelle dimensioni senza passare a un piano superiore.
Perché non solo Supabase: senza trasformazioni video servirebbe ffmpeg anche
per generare una semplice anteprima.

Il bucket nuovo è `smm-media`, privato, limite 2 GB per file. **Il limite
globale per file del progetto Supabase va alzato dal pannello** (Storage →
Settings → Upload file size limit): è una tua decisione, perché dipende dal
piano. Finché resta a 50 MB i file grandi vengono rifiutati dal server, e lo
dico nel report.

L'upload dal browser non passa più da `/api/upload` (base64, tetto 10 MB): va
diretto a Supabase Storage via TUS con il JWT dell'utente, con avanzamento
reale e ripresa dopo una caduta di rete.

**Montaggio video.** ffmpeg non gira nelle edge function. Ritagli, sottotitoli,
9:16 e compressione richiedono un worker separato con ffmpeg che prende i
lavori dalla stessa coda (`smm_jobs` con `tipo = 'montaggio'`). Nella
migrazione la coda e i tipi di lavoro ci sono già; il contenitore ffmpeg è da
mettere in piedi su un servizio a tua scelta (Fly.io, Railway, un container su
Hetzner) ed è la cosa che resta aperta. Lo dico nel report finale. Nel
frattempo i reel semplici si fanno con la pipeline Cloudinary già esistente,
che non ha bisogno di ffmpeg.

**App desktop.** Non esiste né Electron né Tauri: il portale staff è una **PWA**
(`manifest-admin.json`, `display: standalone`), l'app Capacitor iOS incapsula
solo `client-portal`. Quindi no, non ha accesso privilegiato al filesystem del
computer. Non serve: il caricamento funziona dal selettore file e dal
trascinamento nel browser, che è il requisito.

### 3. Runtime agenti: coda su Supabase + edge function worker

Il manager non deve dipendere da nessun PC, quindi gli agenti girano lato
server. Coda = tabella `smm_jobs`. Worker = edge function Deno `smm-worker`
che chiama l'API Anthropic con tool use.

Il worker parte in due modi, e servono entrambi:
- **subito**, con una chiamata fire-and-forget dal browser quando si crea un
  lavoro, così la Regia si muove nell'istante in cui scrivi al Direttore;
- **a ripetizione**, con `pg_cron` ogni minuto, così un lavoro non si perde se
  il browser si chiude e i lavori figli vengono raccolti comunque.

Il lavoro viene preso con una funzione SQL `smm_claim_job()` che fa
`update … where stato='in_coda' … for update skip locked`: due worker non
possono prendere lo stesso lavoro.

`ANTHROPIC_API_KEY` **è già configurata** sul progetto Supabase (la usa
`lara-chat`), quindi non serve una chiave nuova.

Non ho trovato nel portale una soluzione migliore di questa: non c'è un sistema
di code, non c'è un servizio Node sempre attivo, e i cron di Vercel sono
giornalieri. La coda su Postgres è la cosa che si integra senza aggiungere
infrastruttura.

**Realtime.** Oggi il portale non lo usa affatto e la publication è vuota
(`SMM_PORTALE.md` § 5). Le tabelle SMM vengono aggiunte alla publication e la
Regia apre un websocket Realtime nativo, con **polling adattivo come
fallback** se il websocket non si apre (rete aziendale, CSP, piano).

**Spesa.** `smm_settings` porta `budget_lavoro_usd`, `budget_giorno_usd` e
`stop_tutto`. Il worker controlla il budget prima di ogni chiamata, scrive
token e costo su ogni lavoro, e con `stop_tutto` vero non parte niente.

---

## Modello dati

Tutte le tabelle hanno `brand_id` e RLS. `smm_brands` nasce con InDubai;
KeyPrime si aggiunge con una riga.

| Tabella | Cosa tiene |
|---|---|
| `smm_brands` | i brand. Una riga oggi |
| `smm_agents` | gli agenti **come dati**: prompt, modello, strumenti, zona, posizione nella scena |
| `smm_jobs` | la coda: richiesta, stato, agente, lavoro padre, costo, token |
| `smm_contents` | i contenuti e il loro stato, dall'idea alla pubblicazione |
| `smm_content_versions` | i round confrontabili (Round 1 contro Round 7) |
| `smm_notes` | le note agganciate a un punto preciso: secondo del video, slide del carosello |
| `smm_messages` | la chat con ogni agente |
| `smm_brain` | il Cervello: regola, nota, studio, design, con fonte e data |
| `smm_media` | i file, con originale e derivati collegati |
| `smm_results` | le metriche per contenuto |
| `smm_settings` | budget, interruttore generale, doppia approvazione, categorie sensibili |

Stati del contenuto, in ordine:
`idea → in_lavorazione → da_revisione → (respinto) → da_approvare → approvato
→ in_calendario → programmato → pubblicato`

Due presidi nel database, non nell'interfaccia:
- non si entra in `da_approvare` senza `revisore_ok = true`;
- non si pubblica senza `approvato_da` e, sulle categorie sensibili con la
  doppia approvazione attiva, senza `approvato_admin_da`.

Sono trigger, così valgono su qualunque percorso di scrittura.

---

## Permessi

- Ruolo nuovo `smm` nell'enum `user_role`.
- Pagina `regia` concedibile dalla matrice: `allNavItems` + `ROLE_PAGES_DEFAULT`
  + `ALL_PAGES`, i tre passaggi di `CLAUDE.md`.
- Sezione nuova `SOCIAL` nel menu e nella matrice.
- `can_see_smm()` sul modello di `can_see_wills()`: legge la matrice permessi
  dentro le policy RLS, con fallback ai predefiniti del ruolo.
- `smm` aggiunto a `VALID_STAFF_ROLES` in `js/notify.js`, altrimenti le
  notifiche al manager sparirebbero in silenzio.
- Il ruolo `smm` vede **solo** la Regia e le notifiche. L'admin vede tutto.
- La voce esistente verso l'app esterna diventa concedibile anziché cablata
  sull'admin.

---

## Gli agenti

Dati in `smm_agents`, aggiungibili da interfaccia. Partenza: Direttore,
Stratega editoriale, Copywriter, Grafico, Video, Revisore di conformità,
Pubblicatore, Analista. Zone: studio, montaggio, uscita, direzione, revisione.

Ogni agente = system prompt + modello + strumenti + recupero dal Cervello
**per rilevanza** (ricerca full-text italiana con pesi, non tutto il Cervello
in contesto).

Strumenti condivisi: `cervello_cerca`, `contenuto_leggi`. Poi, per ruolo:
`contenuto_crea`, `contenuto_aggiorna`, `coinvolgi_agente`,
`chiedi_al_manager`, `revisore_controlla`, `calendario_proponi`, `pubblica`.
`pubblica` ce l'ha solo il Pubblicatore, e il presidio vero è il trigger.

`coinvolgi_agente` crea un lavoro figlio: è da lì che nasce la linea animata
fra due scrivanie.
`chiedi_al_manager` mette il lavoro in `attesa_risposta`: è da lì che nasce
l'avatar con la mano alzata e la riga nella striscia "Tocca a te".

---

## Ordine di costruzione, un commit per tappa

1. Dati e permessi — migrazione, RLS, ruolo, i tre passaggi del menu
2. Cervello e import delle regole — seed dall'inventario, ricerca per rilevanza
3. Runtime agenti — `smm-worker`, strumenti, budget, interruttore
4. Pannelli e chat — vista lista completa e funzionante, prima del 3D
5. Revisioni con note — lettore, confronto round, note agganciate
6. Calendario — griglia due settimane, trascinamento
7. Pubblicazione GHL — `smm-publish`, presidi di approvazione
8. Risultati — metriche per contenuto e aggregate
9. 3D — scena, avatar, Cervello, linee, luce di Dubai
10. Test e rifiniture

La vista lista arriva **prima** del 3D di proposito: così la sezione è usabile
anche se il 3D non parte, e la lista accessibile richiesta al punto 5.
dell'elenco 3D non è un ripiego costruito dopo ma la base su cui il 3D si
appoggia.
