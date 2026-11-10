# Inventario SMM — cosa esiste già e cosa si riusa

Questo file è il risultato della lettura integrale del progetto che oggi genera i
contenuti social di InDubai. È la base del **Cervello condiviso**: le regole qui
sotto sono importate fedelmente, una per riga, con la fonte, e vengono caricate
nel Cervello dalla migrazione `supabase/migrations/20261110_smm_regia.sql`.

Le regole non sono riassunte né reinterpretate. Dove il testo originale è una
frase, la frase è riportata come sta. Dove nel codice originale la regola è un
pezzo di codice (una regex, una soglia), è riportata la regola che quel codice
applica, con il riferimento al file e alla riga.

---

## 0. Dove sta il progetto, e una precisazione importante

Il prompt diceva «su questo PC c'è già un progetto che genera post». Questa
sessione gira in un container in cloud, non sul tuo PC: l'unica cosa presente
all'avvio era il repository del portale. Il progetto l'ho trovato comunque,
perché il portale lo linka:

- `js/app.js:129` — voce di menu `smm` → `https://indubai-social-manager.vercel.app`
- `supabase/migrations/20261029_link_utili.sql:37` — stesso indirizzo nei Link Utili

Da lì ho risalito al repository `bozzellapellegrinoweb/indubai-social-manager`,
l'ho collegato alla sessione e letto per intero (107 file). **Quello è il
progetto di cui parlavi**, ed è quello che ho inventariato qui.

Se sul tuo PC c'è anche altro materiale non versionato (cartelle di esempi, PDF
di linee guida, export di post, un `.env` con chiavi) io non l'ho potuto vedere.
Quello che segue copre tutto ciò che è nel repository.

---

## 1. Cosa fa già il progetto

**Stack:** Next.js 15 (App Router) + Prisma su SQLite via **Turso** cloud, deploy
su Vercel, push su `main` = auto-deploy. Fonte: `CLAUDE.md`.

Attenzione: il database **non è Supabase**. È Turso (libsql). Quindi i contenuti
storici del social manager e i contenuti del portale vivono oggi in due database
diversi che non si parlano.

### Modelli dati (`prisma/schema.prisma`)

| Modello | Campi chiave | Note |
|---|---|---|
| `Post` | `brand`, `contentType` (carousel/story), `status` (DRAFT/APPROVED/REJECTED/PUBLISHED), `platform`, `caption`, `hashtags`, `carouselData` (JSON), `carouselImages` (path locali), `carouselImagesUrls` (URL Cloudinary), `canvaImageUrl` (video reel), `publishAt`, `publishedAt`, `ghlPostId` | Ha già il campo `brand`: il multi-brand c'è in embrione |
| `AvatarPhoto` | `url`, `prompt`, `status`, `active` | Pool foto avatar |
| `Newsletter` | `subject`, `previewText`, `hook`, `sentAt`, `sentCount`, `failedCount`, `newsUsed` | Storico invii |

### Pipeline dei contenuti

1. **Post da notizie** — `lib/scraper.ts` raccoglie news, `lib/claude.ts`
   (`generatePostsFromNews`, modello `claude-haiku-4-5-20251001`) produce 2-3
   post con carosello in JSON.
2. **Post originali** — `lib/original-claude.ts` (`claude-sonnet-4-6`) genera da
   un topic della knowledge base, con 5 formati narrativi a rotazione
   (ANALISI, MYTH_BUSTER, CASO_PRATICO, CONFRONTO, PROVOCAZIONE).
3. **Post conversion** — `lib/conversion-claude.ts`, scenario-based,
   rassicurante, con fact-check Haiku integrato, pensato per funzionare sia
   organico sia sponsorizzato.
4. **Carosello PNG** — `lib/carousel.ts`, Puppeteer HTML→PNG **1080×1350**.
5. **Reel** — `lib/reel.ts` + `lib/upload.ts:buildSlideshowVideoUrl()`: il video
   verticale è assemblato **da Cloudinary via transformation URL**
   (`e_zoompan` + `fl_splice`), quindi **senza ffmpeg**. Funziona identico in
   locale e su Vercel.
6. **Storie** — `lib/story.ts`, Puppeteer 1080×1920 (`deviceScaleFactor: 2`),
   poi ffmpeg PNG→MP4 da 5 secondi con audio di brand (`public/audio/brand.mp3`).
7. **Upload** — `lib/upload.ts` su **Cloudinary**, cartella `indubai-smm`.
8. **Pubblicazione** — `lib/ghl.ts:publishToGHL()` su GoHighLevel.
9. **Fact-check** — `lib/fact-check.ts`, Claude Haiku con knowledge base
   normativa; errori `critical` bloccano l'approvazione, `warning` no.
10. **Newsletter** — `lib/newsletter.ts` (1279 righe), tre tipi (news,
    originale, conversion) con piano editoriale a 12 uscite.
11. **Bot Telegram commerciale** (`@IndubaiOS_bot`) — `lib/sales-agent.ts`,
    `lib/ghl-crm.ts`, `lib/telegram.ts`: brief mattutino, follow-up, Q&A sul CRM
    GHL. **Fuori perimetro per la Regia**, ma è utile sapere che esiste perché
    usa le stesse chiavi GHL.

### Cron attivi

| Quando | Endpoint | Cosa fa |
|---|---|---|
| 3:00 | `/api/cron/generate` | Genera post da notizie, status DRAFT |
| 4:00 | `/api/cron/stories` | Genera 1 storia DRAFT per domani, con avatar |
| 5:00 | `/api/cron/verify-stories` | Fact-check Haiku → promuove ad APPROVED |
| 13:00 UTC | `/api/cron/publish` | Pubblica storie APPROVED e post APPROVED con `publishAt` passato |
| 6:00 UTC lun-sab | `/api/cron/sales-brief` | Brief commerciale su Telegram |
| 14:00 UTC lun-sab | `/api/cron/sales-followup` | Follow-up commerciale su Telegram |

### Integrazioni e chiavi usate (nomi, non valori)

`ANTHROPIC_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`, `CRON_SECRET`, `OPENAI_API_KEY`, `HIGGSFIELD_API_KEY`,
`GEMINI_API_KEY`, `PEXELS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`.
Fonte: `CLAUDE.md`. Nel repository del social manager **non ho trovato chiavi
scritte nel codice**: sono tutte lette da `process.env`.

---

## 2. Le regole, importate una per riga

Ogni regola ha un identificativo stabile: è lo stesso che finisce nel Cervello,
così una regola si può citare in una revisione e ritrovare.

### 2.1 Qualifica e terminologia (vincolanti, le applica il Revisore)

| ID | Regola | Fonte |
|---|---|---|
| `R-QUAL-01` | InDubai NON è uno studio legale | `CLAUDE.md` § Regole editoriali InDubai |
| `R-QUAL-02` | MAI usare: avvocato, avv., consulente legale, lawyer, law firm, studio legale | `CLAUDE.md` § Regole editoriali InDubai |
| `R-QUAL-03` | Formule corrette: consulenza fiscale e societaria, fiscalista, consulente aziendale | `CLAUDE.md` § Regole editoriali InDubai |
| `R-QUAL-04` | I termini vietati sono intercettati dalla regex `\b(avvocato\|avv\.\|consulente\s+legale\|lawyer\|law\s+firm\|studio\s+legale)\b` e sostituiti con "consulente aziendale" | `lib/story.ts:20-24` |
| `R-QUAL-05` | "studi legali" viene sostituito con "società di consulenza" | `lib/story.ts:25` |
| `R-QUAL-06` | Il fact-check verifica anche che non ci siano termini vietati | `CLAUDE.md` § Fact-check automatico |
| `R-QUAL-07` | Qualifica corretta: "Consulente fiscale e societario" / "Tax and Corporate Advisor". Su siti e landing: "Fiscalista" e "Consulente aziendale". Nessun titolo davanti al nome. I servizi si descrivono per attività, non con un titolo | Istruzione del committente (sezione 0 del prompt) |
| `R-QUAL-08` | Nessun dato di clienti reali nei contenuti pubblici | Istruzione del committente |
| `R-QUAL-09` | Nessuna promessa di risultato fiscale | Istruzione del committente + `lib/fact-check.ts` |

### 2.2 Regole editoriali assolute

| ID | Regola | Fonte |
|---|---|---|
| `R-ED-01` | MAI citare prezzi, costi o tariffe di servizi | `lib/claude.ts` SYSTEM_PROMPT |
| `R-ED-02` | MAI nominare specifiche freezone (no DMCC, IFZA, Meydan, RAKEZ, DAFZ, DSO, DIFC, ecc.) | `lib/claude.ts` SYSTEM_PROMPT |
| `R-ED-03` | MAI essere commerciali o fare vendita diretta | `lib/claude.ts` SYSTEM_PROMPT |
| `R-ED-04` | MAI toni sensazionalistici ("guadagna senza tasse!", "scappa dall'Italia!") | `lib/claude.ts` SYSTEM_PROMPT |
| `R-ED-05` | MAI promesse irrealistiche | `lib/claude.ts` SYSTEM_PROMPT |
| `R-ED-06` | MAI contenuti che possano sembrare evasione fiscale | `lib/claude.ts` SYSTEM_PROMPT |
| `R-ED-07` | MAI promettere risultati specifici tipo "risparmi X%" / "risparmierai il 40%" | `lib/fact-check.ts`, `lib/conversion-claude.ts` |
| `R-ED-08` | MAI dare consigli specifici ("fai così") — solo analisi ("ecco cosa succede se...") | `lib/original-claude.ts` EXPERT_SYSTEM_PROMPT |
| `R-ED-09` | MAI toni da guru, coach motivazionale o venditore di sogni | `lib/conversion-claude.ts` |
| `R-ED-10` | Ogni "paura" deve essere supportata da una norma: mai allarmismo gratuito | `lib/original-claude.ts` |
| `R-ED-11` | Smontare le promesse dei competitor senza mai nominarli ("chi ti dice che...") | `lib/original-claude.ts` |
| `R-ED-12` | Regola d'oro: mai dare la soluzione completa. Si apre il problema, si mostra la complessità, non si dà lo step-by-step — quello è il valore della consulenza | `lib/original-claude.ts` |
| `R-ED-13` | Chiudere sempre con un cliffhanger che crea il bisogno di approfondire | `lib/original-claude.ts` |
| `R-ED-14` | Social proof morbida: scenari tipo riconoscibili, mai testimonial esplicite | `lib/conversion-claude.ts` |
| `R-ED-15` | MAI dare l'impressione che sia tutto facile e immediato — sarebbe poco credibile | `lib/conversion-claude.ts` |
| `R-ED-16` | Ogni scenario deve essere realistico: persona tipo con età, professione, situazione concreta | `lib/conversion-claude.ts` |
| `R-ED-17` | Citare SEMPRE gli articoli di legge specifici: dà credibilità | `lib/original-claude.ts` |

### 2.3 Regole linguistiche

| ID | Regola | Fonte |
|---|---|---|
| `R-LANG-01` | Scrivere SOLO in italiano corretto e fluente, come un giornalista professionista italiano | `lib/claude.ts` |
| `R-LANG-02` | VIETATO mescolare italiano e inglese nella stessa frase ("stai building", "fare il setup", "è molto challenging") | `lib/claude.ts` |
| `R-LANG-03` | Termini inglesi ammessi solo se entrati nell'uso comune italiano: visa, compliance, Emirates ID, business | `lib/claude.ts` |
| `R-LANG-04` | Termini tecnici fiscali in inglese solo quando sono i termini ufficiali: POEM, CRS, UBO, QFZP, AML, KYC | `lib/original-claude.ts` |
| `R-LANG-05` | Prima di usare un termine inglese: esiste una parola italiana altrettanto naturale? Se sì, usala | `lib/claude.ts` |
| `R-LANG-06` | Frasi brevi, dirette, senza ridondanze. Niente giri di parole | `lib/claude.ts` |
| `R-LANG-07` | MAI elenchi puntati, trattini, asterischi o markdown nella caption: testo discorsivo e naturale | `lib/claude.ts`, `lib/original-claude.ts`, `lib/conversion-claude.ts` |
| `R-LANG-08` | MAI trattini lunghi (— o –) nel testo: al loro posto punto o virgola | `lib/claude.ts` |
| `R-LANG-09` | In pratica: i trattini lunghi vengono sostituiti con ". " nelle caption e con ": " nelle storie; i puntini di sospensione multipli con "…" | `lib/text-utils.ts:12`, `lib/story.ts:26-27` |
| `R-LANG-10` | Ogni frase deve suonare come scritta da un madrelingua italiano colto | `lib/claude.ts` |
| `R-LANG-11` | Nessun campo di testo può restare vuoto o mancante: ogni slide ha tutti i campi del suo tipo | `lib/original-claude.ts` |
| `R-LANG-12` | I nomi interni dei formati (FORMATO_A_ANALISI, ecc.) non devono MAI comparire in badge, titoli, caption o testo visibile | `lib/original-claude.ts` |

### 2.4 Tono e posizionamento

| ID | Regola | Fonte |
|---|---|---|
| `R-TONE-01` | Tono professionale, autorevole, rassicurante | `lib/claude.ts` |
| `R-TONE-02` | Contenuti di valore puro: educare, informare, chiarire | `lib/claude.ts` |
| `R-TONE-03` | Posizionare InDubai come il punto di riferimento esperto | `lib/claude.ts` |
| `R-TONE-04` | Titoli di impatto ma mai clickbait | `lib/claude.ts` |
| `R-TONE-05` | Nei contenuti originali: non un social media manager generico, ma un esperto fiscale che usa i social per educare | `lib/original-claude.ts` |
| `R-TONE-06` | Nei contenuti conversion: professionale ma caldo, come un amico esperto che spiega con pazienza; empatico; concreto con tempistiche reali | `lib/conversion-claude.ts` |
| `R-TONE-07` | Nei conversion il lettore deve pensare "ok, è fattibile, ma mi serve qualcuno che mi guidi" | `lib/conversion-claude.ts` |
| `R-TONE-08` | Non nascondere le complessità: dimostrare che si risolvono con metodo | `lib/conversion-claude.ts` |

### 2.5 CTA ammesse

| ID | Regola | Fonte |
|---|---|---|
| `R-CTA-01` | CTA sempre soft | `lib/claude.ts`, `lib/original-claude.ts` |
| `R-CTA-02` | "Approfondisci su InDubai.it" | `lib/claude.ts`, `lib/brands.ts` |
| `R-CTA-03` | "Scrivici per saperne di più" | `lib/claude.ts` |
| `R-CTA-04` | "Ne parliamo?" | `lib/original-claude.ts` |
| `R-CTA-05` | "Scrivici su WhatsApp per una call conoscitiva di 15 minuti — è gratuita" | `lib/conversion-claude.ts` |
| `R-CTA-06` | "Prenota 15 minuti con il team InDubai — senza impegno" | `lib/conversion-claude.ts` |
| `R-CTA-07` | "Hai domande? Scrivici, rispondiamo entro 24h" | `lib/conversion-claude.ts` |
| `R-CTA-08` | "Ne parliamo? Scrivici e ti raccontiamo come funziona davvero" | `lib/conversion-claude.ts` |

### 2.6 Pubblico target

| ID | Regola | Fonte |
|---|---|---|
| `R-AUD-01` | Imprenditori italiani 30-55 anni con attività digitali (SaaS, e-commerce, crypto, dropshipping, affiliate, consulenza) | `lib/claude.ts` |
| `R-AUD-02` | Vogliono ottimizzazione fiscale legale | `lib/claude.ts` |
| `R-AUD-03` | Temono errori con il fisco italiano (AIRE, black list, centro degli interessi vitali) | `lib/claude.ts` |
| `R-AUD-04` | Cercano un partner esperto e affidabile | `lib/claude.ts` |

### 2.7 Pillar editoriali con pesi

| ID | Regola | Fonte |
|---|---|---|
| `R-PILLAR-01` | Normativa e fisco UAE — 35% | `lib/claude.ts` |
| `R-PILLAR-02` | Aprire società a Dubai — 25% | `lib/claude.ts` |
| `R-PILLAR-03` | Residenza fiscale (TRC, AIRE, convenzioni) — 20% | `lib/claude.ts` |
| `R-PILLAR-04` | Lifestyle Dubai (costo della vita, opportunità) — 10% | `lib/claude.ts` |
| `R-PILLAR-05` | Dati e insights (statistiche, mercato, tendenze) — 10% | `lib/claude.ts` |
| `R-PILLAR-06` | Pillar dei contenuti originali: rottura di credenze, strutture fiscali, compliance, residenza fiscale, normativa | `lib/original-claude.ts` |
| `R-PILLAR-07` | Piano a 12 uscite: 9 di opportunità e 3 di presidio, mai due di presidio ravvicinate | `lib/newsletter.ts:210-227` |
| `R-PILLAR-08` | In una uscita di opportunità, TRC / 183 giorni / accertamenti NON possono essere l'argomento principale | `lib/newsletter.ts:238` |
| `R-PILLAR-09` | I tre servizi ruotano per non spingere sempre lo stesso: apertura società UAE, trasferimento e residenza fiscale, consulenza e verifica posizione | `lib/newsletter.ts:242-258` |

### 2.8 Dati normativi di riferimento (il Revisore li usa per il fact-check)

Sono i dati del `FACT_CHECK_PROMPT`, aggiornati al 2026. Un contenuto che dice
un numero diverso da questi viene fermato con severità `critical`.

| ID | Dato | Fonte |
|---|---|---|
| `R-FACT-01` | Golden Visa investitore: investimento minimo 2.000.000 AED (NON 250.000, NON 500.000, NON 1.000.000) | `lib/fact-check.ts` |
| `R-FACT-02` | Golden Visa immobiliare: proprietà dal valore minimo 2.000.000 AED | `lib/fact-check.ts` |
| `R-FACT-03` | Golden Visa imprenditore: capitale minimo 500.000 AED o approvazione incubatore | `lib/fact-check.ts` |
| `R-FACT-04` | Golden Visa talenti specializzati: su nomina/approvazione | `lib/fact-check.ts` |
| `R-FACT-05` | Golden Visa studenti: GPA minimo 3.8 | `lib/fact-check.ts` |
| `R-FACT-06` | Golden Visa durata: 10 anni, rinnovabile | `lib/fact-check.ts` |
| `R-FACT-07` | Corporate Tax UAE: 9% sopra AED 375.000 | `lib/fact-check.ts` |
| `R-FACT-08` | Corporate Tax in vigore dal 1 giugno 2023 | `lib/fact-check.ts` |
| `R-FACT-09` | Registrazione CT obbligatoria per tutti i soggetti, anche sotto soglia | `lib/fact-check.ts` |
| `R-FACT-10` | QFZP 0%: richiede 7 condizioni stringenti, reddito qualifying, sostanza in free zone | `lib/fact-check.ts` |
| `R-FACT-11` | Small Business Relief: sotto AED 3.000.000, ma si perdono le perdite riportabili | `lib/fact-check.ts` |
| `R-FACT-12` | Sanzione mancata registrazione CT: AED 10.000 | `lib/fact-check.ts` |
| `R-FACT-13` | VAT UAE: aliquota 5%, in vigore dal 2018 | `lib/fact-check.ts` |
| `R-FACT-14` | VAT soglia registrazione obbligatoria: AED 375.000 | `lib/fact-check.ts` |
| `R-FACT-15` | VAT soglia registrazione volontaria: AED 187.500 | `lib/fact-check.ts` |
| `R-FACT-16` | Residenza fiscale Italia, Art. 2 TUIR: domicilio O residenza O sede principale in Italia per la maggior parte del periodo | `lib/fact-check.ts` |
| `R-FACT-17` | Dal 2024 (Art. 2-bis TUIR): basta la presenza per la maggior parte del periodo d'imposta | `lib/fact-check.ts` |
| `R-FACT-18` | AIRE necessaria ma NON sufficiente; l'onere della prova è sul contribuente | `lib/fact-check.ts` |
| `R-FACT-19` | CRS: UAE scambia con Italia dal 2018 | `lib/fact-check.ts` |
| `R-FACT-20` | Quadro RW obbligatorio per attività finanziarie estere | `lib/fact-check.ts` |
| `R-FACT-21` | Sanzione mancata dichiarazione RW: 3-15% del saldo (6-30% se paese black list) | `lib/fact-check.ts` |
| `R-FACT-22` | Convenzione Italia-UAE firmata 22/01/1995, in vigore | `lib/fact-check.ts` |
| `R-FACT-23` | Convenzione, dividendi: ritenuta max 5% (partecipazione ≥25%) o 15% | `lib/fact-check.ts` |
| `R-FACT-24` | Tie-breaker: abitazione permanente → centro interessi vitali → soggiorno abituale → nazionalità | `lib/fact-check.ts` |
| `R-FACT-25` | Affitto monolocale/bilocale Dubai Marina/JBR: 60.000-100.000 AED/anno | `lib/fact-check.ts` |
| `R-FACT-26` | Affitto villa 3BR: 150.000-300.000 AED/anno secondo la zona | `lib/fact-check.ts` |
| `R-FACT-27` | Scuola internazionale: 30.000-80.000 AED/anno per figlio | `lib/fact-check.ts` |
| `R-FACT-28` | Assicurazione sanitaria: 5.000-15.000 AED/anno per persona | `lib/fact-check.ts` |
| `R-FACT-29` | NON fare promesse su risparmi specifici: troppo variabile caso per caso | `lib/fact-check.ts` |
| `R-FACT-30` | Setup società UAE: 7-14 giorni lavorativi con la documentazione pronta | `lib/conversion-claude.ts` |
| `R-FACT-31` | Apertura conto bancario: 2-4 settimane | `lib/conversion-claude.ts` |
| `R-FACT-32` | Emirates ID + visa: 2-3 settimane | `lib/conversion-claude.ts` |
| `R-FACT-33` | "La residenza fiscale si ottiene in 3-6 settimane" è FALSO: quella è la residenza amministrativa. La TRC richiede 183+ giorni di presenza effettiva | `lib/newsletter.ts:421` |
| `R-FACT-34` | Severità `critical` = numero o dato sbagliato che danneggia la credibilità: blocca l'approvazione. `warning` = imprecisione minore: segnala, non blocca | `lib/fact-check.ts` |

### 2.9 Regole tecniche di pubblicazione GHL

| ID | Regola | Fonte |
|---|---|---|
| `R-GHL-01` | Storie: tipo `"story"`, NESSUN `scheduleDate` — con `scheduleDate` GHL le trasforma in post normali | `CLAUDE.md` § GHL Regole critiche |
| `R-GHL-02` | Storie Instagram: tutte le slide in un payload | `CLAUDE.md` |
| `R-GHL-03` | Storie Facebook: solo la prima slide (422 se multi-media) | `CLAUDE.md` |
| `R-GHL-04` | TikTok: `skipThumbnail: true`, solo video, tipo `"reel"`. Non supporta thumbnail custom via API di terze parti | `CLAUDE.md` |
| `R-GHL-05` | Reel su Instagram/Facebook: tipo `"reel"`, media `video/mp4` | `CLAUDE.md` |
| `R-GHL-06` | Post normali: tipo `"post"`, media `image/jpeg` | `CLAUDE.md` |
| `R-GHL-07` | `publishToGHL()` fa chiamate SEPARATE per piattaforme immagine e piattaforme video-only | `lib/ghl.ts:154-230` |
| `R-GHL-08` | Piattaforme video-only: tiktok, youtube, instagram_reels | `lib/ghl.ts:60` |
| `R-GHL-09` | Massimo 10 media per post | `lib/ghl.ts:184,189` |
| `R-GHL-10` | Header GHL: `Version: 2021-07-28` per il social posting, `2021-04-15` per calendari e contatti | `lib/ghl.ts:11`, `supabase/functions/ghl-booking/index.ts` |
| `R-GHL-11` | Endpoint social: `POST /social-media-posting/{locationId}/posts`; account collegati: `GET /social-media-posting/{locationId}/accounts`; upload media: `POST /medias/upload-file` | `lib/ghl.ts` |
| `R-GHL-12` | La caption pubblicata è `caption` + due ritorni a capo + hashtag | `lib/ghl.ts:148` |
| `R-GHL-13` | I video su Cloudinary vanno caricati con `resource_type: "raw"`, altrimenti Cloudinary aggiunge `codecs=avc1` al Content-Type e TikTok/YouTube via GHL falliscono | `lib/upload.ts:26-28` |

### 2.10 Formati e specifiche visive

| ID | Regola | Fonte |
|---|---|---|
| `R-FMT-01` | Carosello: 1080×1350 px | `lib/carousel.ts:168` |
| `R-FMT-02` | Storia / reel: 1080×1920 px, `deviceScaleFactor: 2` | `lib/story.ts`, `CLAUDE.md` |
| `R-FMT-03` | Durata di una slide nelle storie: 5 secondi | `lib/story.ts:17` |
| `R-FMT-04` | Icone disponibili per le slide: tax, building, globe, shield, chart, person | `lib/claude.ts`, `lib/original-claude.ts` |
| `R-FMT-05` | Tipi di slide del carosello: `standard` (icon, title, body) e `stats` (4 dati value/label/desc) | `lib/claude.ts` |
| `R-FMT-06` | Tipi di slide delle storie: `intro`, `content`, `cta` | `lib/story.ts:32` |
| `R-FMT-07` | Lunghezze: coverTitle max 10 parole, coverSubtitle max 15, titolo slide max 8, ctaText max 12, caption max 150 parole | `lib/claude.ts` |
| `R-FMT-08` | Brand InDubai: accent `#b5ff00`, sfondo `#0d0d1a`, card `#13131f`, bordo `#2a2a45` | `lib/brands.ts` |
| `R-FMT-09` | Brand IUS AI: accent `#3b82f6`, sfondo `#0a0f1e`, card `#0f172a`, bordo `#1e3a5f` | `lib/brands.ts` |
| `R-FMT-10` | Font dei visual: `-apple-system, 'Helvetica Neue', Arial, sans-serif` | `lib/carousel.ts:169` |
| `R-FMT-11` | Titolo cover: 96px, weight 900, letter-spacing -4px. Sottotitolo 36px weight 400. Badge 20px weight 700 uppercase letter-spacing 2.5px | `lib/carousel.ts:182-187` |
| `R-FMT-12` | Hashtag InDubai di riferimento: #dubai #fiscalitàdubai #imprenditori #emiratiarabiuniti #residenzafiscale #business #dubai2026 #fiscalità #imprenditoria #indubai | `lib/brands.ts` |

### 2.11 Knowledge base fiscale: 21 topic pronti

`lib/knowledge.ts` contiene 21 `FiscalTopic` strutturati (id, categoria, titolo,
hook, fearFactor, keyPoints, legalRefs, commonMistake, realityCheck,
cliffhanger, difficoltà, potenziale virale, pillar). Categorie: `myth_busting`,
`structure_trap`, `compliance_bomb`, `tax_deep_dive`, `relocation_mistake`.

Elenco: zero-tax-myth, rak-icc-holding-trap, poem-invisible-trap,
qfzp-conditions, aire-not-enough, substance-requirements,
transfer-pricing-trap, small-business-relief-trap, bank-account-compliance,
exit-tax-italy, convenzione-italia-uae, freelancer-dubai-mistake,
permanent-establishment-risk, crypto-dubai-tax, crs-automatic-exchange,
mainland-vs-freezone-real, beneficial-ownership, vat-uae-surprise,
family-business-succession, double-taxation-real-risk.

Questi entrano nel Cervello come elementi di tipo `studio`, non come regole:
sono materiale da cui lo Stratega pesca i temi.

### 2.12 Tag GHL per la newsletter

`.claude/newsletter-tags.md` elenca i 19 tag GHL a cui la newsletter può essere
inviata. Entra nel Cervello come `studio` con fonte, perché è un dato
operativo che cambia.

---

## 3. Cosa si riusa così com'è

| Cosa | Come si riusa nella Regia |
|---|---|
| **Le regole di 2.1 → 2.12** | Seed del Cervello condiviso. Sono il contratto che il Revisore applica |
| **I 21 topic fiscali** | Elementi `studio` nel Cervello, materiale per lo Stratega |
| **`FACT_CHECK_PROMPT`** | Diventa il system prompt del Revisore di conformità, esteso con le regole della sezione 0 del prompt |
| **I 5 formati narrativi** | Diventano i formati che il Copywriter può scegliere |
| **Il piano a 12 uscite 9+3** | Diventa la regola che lo Stratega segue per il piano settimanale |
| **`publishToGHL()` e le regole R-GHL** | Riscritte in Deno nella edge function `smm-publish`, stessa logica, stessi header, stessi tipi di post |
| **Cloudinary** | Resta il luogo dei media *derivati pubblici* che GHL deve poter scaricare |
| **Le specifiche visive R-FMT** | Diventano gli elementi `design` del Cervello |
| **La pipeline Cloudinary `e_zoompan`+`fl_splice`** | Resta la via per i reel semplici senza ffmpeg: è gratis in termini di infrastruttura |

### Cosa NON si riusa

- **Turso**: il portale è su Supabase. Riportare i contenuti su Turso vorrebbe
  dire due database e nessuna RLS. I nuovi contenuti nascono su Supabase.
- **Il bot Telegram commerciale**: è un altro perimetro (vendite, non contenuti).
- **Le automazioni DM**: fuori perimetro per esplicita indicazione.
- **Puppeteer su Vercel**: nelle edge function Deno non gira. I visual si
  generano nel worker (vedi `docs/SMM_PIANO.md`).

---

## 4. Contraddizioni e punti che vanno decisi

1. **`brands.ts` usa `"ius"`, `CLAUDE.md` dice `"iusai"`.** Due identificativi
   per lo stesso brand. Nella Regia il brand è una riga in tabella
   (`smm_brands`) con slug esplicito: per InDubai `indubai`.
2. **`lib/original-claude.ts` scrive nel prompt «parli come un avvocato
   tributarista che spiega al bar».** La parola è nel prompt, non nei contenuti,
   ma è un rischio: un modello che legge "avvocato" nel ruolo può usarlo in
   output. Nel prompt del Copywriter della Regia la similitudine è riscritta
   come «un fiscalista che spiega a un amico imprenditore».
3. **`brands.ts` dà a IUS AI gli hashtag `#avvocato` e `#studiolegale`.** Per IUS
   AI (legal tech) è coerente; per InDubai sono vietati. La regola `R-QUAL-02`
   nel Cervello è legata al brand `indubai`, non globale, così quando aggiungi
   KeyPrime o IUS AI non erediti il divieto sbagliato.
4. **`task-attachments` è un bucket pubblico.** Non va usato per i media SMM.

---

## 5. Chiavi trovate scritte nel codice

Nel repository del social manager: **nessuna**. Tutto da `process.env`.

Nel repository del portale, che è **pubblico su GitHub**: sì, e sono gravi.
Il dettaglio è in `docs/SMM_PORTALE.md` § 9, con i file e le righe. In sintesi:
una chiave `service_role` di Supabase (quella che bypassa ogni RLS) è scritta in
14 file, di cui uno è una **pagina HTML servita al browser**; e un token di
integrazione GoHighLevel è scritto in 3 edge function. Non ho messo i valori in
nessun file di questo repository né in nessun commit.
