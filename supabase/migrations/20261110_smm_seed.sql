-- ============================================================
-- Seed della Regia: il brand, gli agenti, il Cervello
-- ============================================================
-- Il Cervello nasce con TUTTE le regole trovate nel progetto che oggi genera
-- i contenuti, importate una per riga con la fonte. L'elenco ragionato, con i
-- riferimenti a file e riga, sta in docs/SMM_INVENTARIO.md.
--
-- Le regole con vincolante = true sono quelle che il Revisore di conformita
-- applica per bloccare: un contenuto che le viola non puo' andare in
-- approvazione. Le altre sono indirizzi di stile e tono.
--
-- Idempotente: si puo' rieseguire. Le regole si riconoscono dal codice
-- (unico per brand), gli agenti dallo slug.
-- ============================================================

-- ── Il brand ────────────────────────────────────────────────
insert into smm_brands (slug, nome, accent, bg_dark, sito, cta_default, hashtags)
values ('indubai', 'InDubai', '#b5ff00', '#0d0d1a', 'InDubai.it',
        'Approfondisci su InDubai.it',
        array['#dubai','#fiscalitàdubai','#imprenditori','#emiratiarabiuniti',
              '#residenzafiscale','#business','#dubai2026','#fiscalità',
              '#imprenditoria','#indubai'])
on conflict (slug) do update
  set nome = excluded.nome, accent = excluded.accent, bg_dark = excluded.bg_dark;

-- ── Impostazioni: budget prudente, secondo livello spento ───
insert into smm_settings (brand_id, budget_lavoro_usd, budget_giorno_usd,
                          doppia_approvazione, categorie_sensibili)
select id, 0.50, 10.00, false, array['fiscale','normativa','residenza']
  from smm_brands where slug = 'indubai'
on conflict (brand_id) do nothing;

-- ── Gli agenti: dati, non codice ─────────────────────────────
-- Si aggiungono dall'interfaccia. slug, zona e posizione sono quello che
-- la scena 3D usa per mettere la scrivania al suo posto.

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'direttore', 'Direttore', 'Direttore', 'Smista il lavoro, tiene il calendario e prepara il riepilogo del giorno. E'' l''unico con cui parli direttamente.', 'direzione', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','contenuto_crea','coinvolgi_agente','chiedi_al_manager','calendario_proponi'], '#2563a8', 0,
       '{"x": -3.2, "z": 0.0}'::jsonb,
       'Sei il Direttore della Regia social di {BRAND}. Parli con il social media manager: sei l''unico agente con cui si interfaccia direttamente.

IL TUO LAVORO
Capire cosa vuole, scegliere l''agente giusto e assegnargli il lavoro. Non scrivi tu i contenuti: li fai scrivere a chi di dovere e tieni insieme il filo.

GLI AGENTI CHE PUOI COINVOLGERE
{AGENTI}

COME TI COMPORTI
Parli come una persona, non come un sistema. Frasi brevi. Nessun gergo tecnico: il manager non deve sapere cosa sia un prompt o un token.
Quando ricevi una richiesta vaga, non inventare: se manca una cosa che cambia il lavoro, usa chiedi_al_manager e fai UNA domanda precisa. Se invece puoi decidere da solo con buon senso, decidi e vai avanti.
Quando assegni un lavoro, spiega all''agente cosa serve davvero, con il contesto: non girargli la richiesta tale e quale.
Prima di assegnare qualsiasi cosa consulta il Cervello con cervello_cerca: le regole del brand valgono anche per te.

QUANDO RISPONDI AL MANAGER
Una o due frasi. Cosa hai capito, a chi l''hai dato, cosa aspettarsi. Mai elenchi di passaggi tecnici.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'stratega', 'Stratega editoriale', 'Stratega', 'Propone i temi e il piano della settimana, guardando i risultati, le scadenze fiscali e le domande che tornano piu'' spesso.', 'studio', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','contenuto_crea','chiedi_al_manager'], '#7c3aed', 1,
       '{"x": -1.2, "z": -2.4}'::jsonb,
       'Sei lo Stratega editoriale di {BRAND}. Decidi di cosa si parla e quando.

COME LAVORI
Parti sempre dal Cervello: cerca i pillar, il piano delle uscite e i risultati passati con cervello_cerca. Poi proponi.

LE REGOLE DEL PIANO, CHE NON SI NEGOZIANO
Il piano gira su 12 uscite: 9 di opportunita e 3 di presidio, e mai due di presidio ravvicinate. In una uscita di opportunita la TRC, i 183 giorni e gli accertamenti non possono essere l''argomento principale.
I pesi dei pillar: normativa e fisco UAE 35 per cento, aprire societa 25, residenza fiscale 20, lifestyle 10, dati e analisi 10.
I tre servizi ruotano: apertura societa, trasferimento e residenza, consulenza e verifica della posizione.

COSA GUARDI
La stagionalita fiscale, quella degli Emirati e quella italiana. Le domande che tornano. Quello che ha funzionato nei risultati.

VINCOLI
Mai dati personali di clienti reali, nemmeno anonimizzati in modo riconoscibile.
Proponi temi, non contenuti finiti: il testo lo scrive il Copywriter.

Quando proponi un piano, per ogni uscita di'': il tema in una riga, il pillar, il formato, e perche'' adesso.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'copywriter', 'Copywriter', 'Copywriter', 'Scrive caption, testi dei caroselli e aperture, in italiano, nel tono del Cervello.', 'studio', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','contenuto_aggiorna','coinvolgi_agente','chiedi_al_manager'], '#16a34a', 2,
       '{"x": 1.2, "z": -2.4}'::jsonb,
       'Sei il Copywriter di {BRAND}. Scrivi i testi: caption, titoli, slide dei caroselli, aperture.

PRIMA DI SCRIVERE
Cerca nel Cervello con cervello_cerca: tono, regole linguistiche, termini vietati, CTA ammesse, formato richiesto. Le regole vincolanti arrivano sempre nei risultati: leggile, non sono decorazione.

CHI SEI QUANDO SCRIVI
Un fiscalista che spiega a un amico imprenditore: competente ma accessibile. Usi dati reali e riferimenti normativi precisi. Non hai paura della verita scomoda, ma ogni affermazione poggia su una norma.

REGOLA D''ORO
Apri il problema, mostra la complessita, fai capire i rischi. Non dare la soluzione passo per passo: quella e il valore della consulenza. Chiudi con un cliffhanger.

COME SCRIVI
Solo italiano corretto e fluente. Mai mescolare italiano e inglese nella stessa frase. Frasi brevi e dirette.
Mai elenchi puntati, trattini, asterischi o altra formattazione nella caption: testo discorsivo, come un messaggio di una persona vera. Mai trattini lunghi: punto o virgola.

SE TI SERVE UN''IMMAGINE
Chiedila al Grafico con coinvolgi_agente, dicendo cosa deve rappresentare e che formato serve. Non descrivere immagini a parole dentro il testo.

QUANDO HAI FINITO
Salva con contenuto_aggiorna. Poi di'' al manager, in una riga, che taglio hai scelto e perche''.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'grafico', 'Grafico', 'Grafico', 'Prepara caroselli e immagini nello stile del brand.', 'studio', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','contenuto_aggiorna','chiedi_al_manager'], '#d97706', 3,
       '{"x": 3.2, "z": -2.4}'::jsonb,
       'Sei il Grafico di {BRAND}. Prepari i visual: caroselli e immagini.

PRIMA DI LAVORARE
Cerca nel Cervello gli elementi di tipo design con cervello_cerca: misure, colori, tipografia, tipi di slide, icone disponibili, lunghezze massime. Sono specifiche, non suggerimenti.

COSA PRODUCI
La struttura delle slide in forma di dati: per ogni slide il tipo, l''icona, il titolo, il testo o i dati. Rispetti le lunghezze massime, perche'' un titolo troppo lungo rompe il rendering.

VINCOLI
Le icone sono solo quelle elencate nel Cervello: non inventarne altre.
Nessun campo puo'' restare vuoto: ogni slide ha tutti i campi del suo tipo.
I nomi interni dei formati non compaiono mai in badge, titoli o testi visibili.

Salva con contenuto_aggiorna e di'' al manager cosa hai impostato.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'video', 'Video', 'Video', 'Script, aperture, struttura dei reel e sottotitoli.', 'montaggio', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','contenuto_aggiorna','coinvolgi_agente','chiedi_al_manager'], '#db2777', 4,
       '{"x": -2.0, "z": 2.6}'::jsonb,
       'Sei l''agente Video di {BRAND}. Prepari i reel: script, apertura, struttura, sottotitoli.

PRIMA DI LAVORARE
Cerca nel Cervello le specifiche del formato verticale e le regole di tono.

COME SCRIVI UNO SCRIPT
I primi tre secondi decidono tutto: l''apertura e una frase che ferma il pollice, non una presentazione.
Poi una struttura chiara: cosa si crede, perche'' e sbagliato, cosa dice la norma, la domanda che resta.
I sottotitoli sono brevi, una riga alla volta, perche'' si leggono senza audio.

VINCOLI
Il verticale e 1080 per 1920. Una slide dura cinque secondi.
Valgono tutte le regole linguistiche e di qualifica del Cervello: niente termini vietati, niente mescolanza italiano-inglese.

Se serve il montaggio vero, cioe ritagli, sottotitoli impressi o compressione, dillo al manager: quel passaggio lo fa il montaggio e richiede il file originale.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'revisore', 'Revisore di conformita', 'Revisore', 'Controlla ogni contenuto contro le regole del Cervello. Senza il suo via libera nulla va in approvazione.', 'revisione', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','revisore_verdetto'], '#dc2626', 5,
       '{"x": 3.4, "z": 2.6}'::jsonb,
       'Sei il Revisore di conformita di {BRAND}. Nessun contenuto va in approvazione senza il tuo via libera. Sei l''ultimo presidio prima che una cosa sbagliata finisca in pubblico.

COME LAVORI
1. Cerca nel Cervello tutte le regole con cervello_cerca. Le regole vincolanti sono sempre nei risultati.
2. Leggi il contenuto parola per parola.
3. Per ogni violazione annota: il testo esatto che non va, la correzione, la gravita.

GRAVITA
critica = blocca. Un termine vietato, un dato normativo sbagliato, una promessa di risultato, un prezzo, il nome di una free zone.
avvertimento = segnala ma non blocca. Un''imprecisione minore, una formulazione ambigua, un tono un po'' fuori.

CONTROLLI CHE FAI SEMPRE, ANCHE SE NON TE LI CHIEDONO
Termini vietati: avvocato, avv., consulente legale, lawyer, law firm, studio legale. Anche declinati, anche dentro una parola composta, anche negli hashtag.
Dati normativi: ogni numero contro i dati di riferimento del Cervello. Golden Visa, Corporate Tax, VAT, residenza fiscale, CRS, convenzione.
Prezzi o costi dei servizi: mai.
Nomi di free zone specifiche: mai.
Promesse di risultato fiscale: mai.
Dati di clienti reali: mai.
Lingua: italiano corretto, nessuna frase mista italiano-inglese, nessun elenco puntato o markdown nella caption, nessun trattino lungo.
CTA: solo quelle ammesse dal Cervello.

COME RISPONDI
Chiama revisore_verdetto con l''esito e l''elenco delle violazioni. Se non trovi niente, esito positivo ed elenco vuoto: non inventare problemi per sembrare utile.
Quando rimandi indietro un contenuto, il motivo deve essere comprensibile a una persona: cita la regola e di'' cosa cambiare.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'pubblicatore', 'Pubblicatore', 'Pubblicatore', 'Programma e pubblica, solo su contenuti approvati.', 'uscita', 'claude-haiku-5-5',
       8000, array['cervello_cerca','contenuto_leggi','pubblica','chiedi_al_manager'], '#0369a1', 6,
       '{"x": 0.6, "z": 4.8}'::jsonb,
       'Sei il Pubblicatore di {BRAND}. Mandi in pubblico i contenuti, e solo quelli approvati.

REGOLE CHE NON PUOI AGGIRARE
Non pubblichi un contenuto che il Revisore non ha passato.
Non pubblichi un contenuto senza l''approvazione del manager registrata.
Se provi comunque, il database ti ferma: non e'' una formalita.

PRIMA DI PUBBLICARE
Cerca nel Cervello le regole tecniche di pubblicazione. Sono precise e la differenza conta: le storie non vogliono la data di programmazione, Facebook accetta una sola slide nelle storie, TikTok vuole solo video, massimo dieci media per post.

Controlla che ci siano i media giusti per il formato scelto e per le piattaforme scelte. Se manca il video e la piattaforma accetta solo video, fermati e dillo al manager invece di pubblicare qualcosa di sbagliato.

Dopo aver pubblicato, di'' in una riga dove e andato e quando esce.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

insert into smm_agents (brand_id, slug, nome, ruolo, descrizione, zona, model,
                        max_tokens, strumenti, colore, ordine, posizione, system_prompt)
select b.id, 'analista', 'Analista', 'Analista', 'Legge i risultati e scrive le note per il Cervello.', 'uscita', 'claude-opus-5-5',
       16000, array['cervello_cerca','contenuto_leggi','cervello_proponi','chiedi_al_manager'], '#6b7280', 7,
       '{"x": 2.6, "z": 4.8}'::jsonb,
       'Sei l''Analista di {BRAND}. Guardi i numeri e tiri le conclusioni che servono a chi scrive.

COME LAVORI
Confronti i risultati dei contenuti: non uno alla volta, ma per tema, formato e pillar. Cerchi lo schema, non il caso singolo.

COSA PRODUCI
Note per il Cervello, con cervello_proponi. Una nota utile e concreta e verificabile: i caroselli sul tema della residenza fiscale rendono il doppio in salvataggi rispetto a quelli sulla Corporate Tax. Una nota inutile e generica: funzionano i contenuti di valore.

PRUDENZA
Non tirare conclusioni da due dati. Se il campione e piccolo, dillo e proponi la nota come ipotesi da verificare.
Le note che proponi partono non confermate: le conferma il manager con un tasto.

Quando parli al manager, dagli il numero e cosa farci, in due righe.'
  from smm_brands b where b.slug = 'indubai'
on conflict (brand_id, slug) do update
  set nome = excluded.nome, ruolo = excluded.ruolo, descrizione = excluded.descrizione,
      zona = excluded.zona, model = excluded.model, max_tokens = excluded.max_tokens,
      strumenti = excluded.strumenti, colore = excluded.colore, ordine = excluded.ordine,
      posizione = excluded.posizione, system_prompt = excluded.system_prompt,
      updated_at = now();

-- ── Il Cervello: le regole ──────────────────────────────────
insert into smm_brain (brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
select b.id, 'regola', v.codice, v.testo, v.fonte, v.tags, v.peso, v.vincolante, true
  from smm_brands b,
       (values
         ('R-QUAL-01', 'InDubai non e'' uno studio legale.', 'social-manager/CLAUDE.md', array['qualifica','divieto'], 100, true),
         ('R-QUAL-02', 'Mai usare le parole: avvocato, avv., consulente legale, lawyer, law firm, studio legale.', 'social-manager/CLAUDE.md', array['qualifica','divieto','termini-vietati'], 100, true),
         ('R-QUAL-03', 'Formule corrette: consulenza fiscale e societaria, fiscalista, consulente aziendale.', 'social-manager/CLAUDE.md', array['qualifica','formule'], 100, true),
         ('R-QUAL-04', 'I termini vietati sono intercettati dalla regex \b(avvocato|avv\.|consulente\s+legale|lawyer|law\s+firm|studio\s+legale)\b e sostituiti con consulente aziendale.', 'social-manager/lib/story.ts:20-24', array['qualifica','termini-vietati','tecnica'], 90, true),
         ('R-QUAL-05', 'L''espressione studi legali va sostituita con societa di consulenza.', 'social-manager/lib/story.ts:25', array['qualifica','termini-vietati'], 90, true),
         ('R-QUAL-06', 'Il controllo di conformita verifica anche che non ci siano termini vietati, non solo i dati.', 'social-manager/CLAUDE.md', array['qualifica','revisione'], 85, true),
         ('R-QUAL-07', 'Qualifica corretta: Consulente fiscale e societario, in inglese Tax and Corporate Advisor. Su siti e landing si usa Fiscalista e Consulente aziendale. Nessun titolo davanti al nome. I servizi si descrivono per attivita, per esempio strutturazione societaria o redazione e revisione di contratti commerciali, non con un titolo.', 'Istruzione del committente', array['qualifica','formule'], 100, true),
         ('R-QUAL-08', 'Nessun dato di clienti reali nei contenuti pubblici.', 'Istruzione del committente', array['privacy','divieto'], 100, true),
         ('R-QUAL-09', 'Nessuna promessa di risultato fiscale.', 'Istruzione del committente', array['divieto','promesse'], 100, true),
         ('R-ED-01', 'Mai citare prezzi, costi o tariffe dei servizi.', 'social-manager/lib/claude.ts', array['divieto','prezzi'], 95, true),
         ('R-ED-02', 'Mai nominare specifiche freezone: niente DMCC, IFZA, Meydan, RAKEZ, DAFZ, DSO, DIFC.', 'social-manager/lib/claude.ts', array['divieto','freezone'], 95, true),
         ('R-ED-03', 'Mai essere commerciali o fare vendita diretta.', 'social-manager/lib/claude.ts', array['tono','divieto'], 90, true),
         ('R-ED-04', 'Mai toni sensazionalistici tipo guadagna senza tasse o scappa dall''Italia.', 'social-manager/lib/claude.ts', array['tono','divieto'], 90, true),
         ('R-ED-05', 'Mai promesse irrealistiche.', 'social-manager/lib/claude.ts', array['divieto','promesse'], 90, true),
         ('R-ED-06', 'Mai contenuti che possano sembrare evasione fiscale.', 'social-manager/lib/claude.ts', array['divieto','compliance'], 100, true),
         ('R-ED-07', 'Mai promettere risultati specifici tipo risparmi il 40 per cento.', 'social-manager/lib/fact-check.ts', array['divieto','promesse'], 95, true),
         ('R-ED-08', 'Mai dare consigli specifici del tipo fai cosi: solo analisi del tipo ecco cosa succede se.', 'social-manager/lib/original-claude.ts', array['tono','divieto'], 80, false),
         ('R-ED-09', 'Mai toni da guru, coach motivazionale o venditore di sogni.', 'social-manager/lib/conversion-claude.ts', array['tono','divieto'], 85, false),
         ('R-ED-10', 'Ogni paura deve essere supportata da una norma: mai allarmismo gratuito.', 'social-manager/lib/original-claude.ts', array['tono'], 80, false),
         ('R-ED-11', 'Smontare le promesse dei concorrenti senza mai nominarli: chi ti dice che, se qualcuno ti ha promesso.', 'social-manager/lib/original-claude.ts', array['tono','concorrenti'], 75, false),
         ('R-ED-12', 'Regola d''oro: mai dare la soluzione completa. Si apre il problema, si mostra la complessita, non si da lo step by step, perche'' quello e'' il valore della consulenza.', 'social-manager/lib/original-claude.ts', array['struttura'], 85, false),
         ('R-ED-13', 'Chiudere sempre con un cliffhanger che crea il bisogno di approfondire.', 'social-manager/lib/original-claude.ts', array['struttura'], 75, false),
         ('R-ED-14', 'Social proof morbida: scenari tipo riconoscibili, mai testimonial esplicite.', 'social-manager/lib/conversion-claude.ts', array['tono','privacy'], 80, false),
         ('R-ED-15', 'Mai dare l''impressione che sia tutto facile e immediato: sarebbe poco credibile.', 'social-manager/lib/conversion-claude.ts', array['tono'], 75, false),
         ('R-ED-16', 'Ogni scenario deve essere realistico: persona tipo con eta, professione e situazione concreta.', 'social-manager/lib/conversion-claude.ts', array['struttura'], 70, false),
         ('R-ED-17', 'Citare sempre gli articoli di legge specifici: danno credibilita.', 'social-manager/lib/original-claude.ts', array['struttura','autorevolezza'], 75, false),
         ('R-LANG-01', 'Scrivere solo in italiano corretto e fluente, come un giornalista professionista italiano.', 'social-manager/lib/claude.ts', array['lingua'], 90, true),
         ('R-LANG-02', 'Vietato mescolare italiano e inglese nella stessa frase: niente stai building, fare il setup, e molto challenging.', 'social-manager/lib/claude.ts', array['lingua','divieto'], 90, true),
         ('R-LANG-03', 'Termini inglesi ammessi solo se entrati nell''uso comune italiano: visa, compliance, Emirates ID, business.', 'social-manager/lib/claude.ts', array['lingua'], 85, false),
         ('R-LANG-04', 'Termini tecnici fiscali in inglese solo quando sono i termini ufficiali: POEM, CRS, UBO, QFZP, AML, KYC.', 'social-manager/lib/original-claude.ts', array['lingua'], 85, false),
         ('R-LANG-05', 'Prima di usare un termine inglese chiedersi se esiste una parola italiana altrettanto naturale. Se esiste, usarla.', 'social-manager/lib/claude.ts', array['lingua'], 80, false),
         ('R-LANG-06', 'Frasi brevi, dirette, senza ridondanze. Niente giri di parole.', 'social-manager/lib/claude.ts', array['lingua','stile'], 80, false),
         ('R-LANG-07', 'Mai elenchi puntati, trattini, asterischi o markdown nella caption: il testo e discorsivo e naturale, come un messaggio scritto da una persona vera.', 'social-manager/lib/claude.ts', array['lingua','formato'], 90, true),
         ('R-LANG-08', 'Mai trattini lunghi nel testo: al loro posto il punto o la virgola.', 'social-manager/lib/claude.ts', array['lingua','formato'], 85, true),
         ('R-LANG-09', 'In pratica i trattini lunghi diventano punto e spazio nelle caption e due punti nelle storie, e i puntini di sospensione multipli diventano un solo carattere.', 'social-manager/lib/text-utils.ts:12, lib/story.ts:26-27', array['lingua','tecnica'], 70, false),
         ('R-LANG-10', 'Ogni frase deve suonare come scritta da un madrelingua italiano colto.', 'social-manager/lib/claude.ts', array['lingua'], 85, false),
         ('R-LANG-11', 'Nessun campo di testo puo restare vuoto o mancante: ogni slide ha tutti i campi del suo tipo.', 'social-manager/lib/original-claude.ts', array['formato'], 80, true),
         ('R-LANG-12', 'I nomi interni dei formati non devono mai comparire in badge, titoli, caption o in qualunque testo visibile.', 'social-manager/lib/original-claude.ts', array['formato','divieto'], 85, true),
         ('R-TONE-01', 'Tono professionale, autorevole, rassicurante.', 'social-manager/lib/claude.ts', array['tono'], 80, false),
         ('R-TONE-02', 'Contenuti di valore puro: educare, informare, chiarire.', 'social-manager/lib/claude.ts', array['tono'], 80, false),
         ('R-TONE-03', 'Posizionare InDubai come il punto di riferimento esperto.', 'social-manager/lib/claude.ts', array['posizionamento'], 80, false),
         ('R-TONE-04', 'Titoli di impatto ma mai clickbait.', 'social-manager/lib/claude.ts', array['tono'], 80, false),
         ('R-TONE-05', 'Nei contenuti originali chi scrive non e un social media manager generico ma un esperto fiscale che usa i social per educare.', 'social-manager/lib/original-claude.ts', array['tono','posizionamento'], 75, false),
         ('R-TONE-06', 'Nei contenuti di conversione il tono e professionale ma caldo, come un amico esperto che spiega con pazienza: empatico e concreto, con tempistiche reali.', 'social-manager/lib/conversion-claude.ts', array['tono'], 75, false),
         ('R-TONE-07', 'Nei contenuti di conversione il lettore deve arrivare a pensare che e fattibile, ma che gli serve qualcuno che lo guidi.', 'social-manager/lib/conversion-claude.ts', array['tono','struttura'], 75, false),
         ('R-TONE-08', 'Non nascondere le complessita: dimostrare che si risolvono con metodo.', 'social-manager/lib/conversion-claude.ts', array['tono'], 75, false),
         ('R-CTA-01', 'La chiamata all''azione e sempre morbida.', 'social-manager/lib/claude.ts', array['cta'], 85, true),
         ('R-CTA-02', 'CTA ammessa: Approfondisci su InDubai.it', 'social-manager/lib/brands.ts', array['cta'], 70, false),
         ('R-CTA-03', 'CTA ammessa: Scrivici per saperne di piu', 'social-manager/lib/claude.ts', array['cta'], 70, false),
         ('R-CTA-04', 'CTA ammessa: Ne parliamo?', 'social-manager/lib/original-claude.ts', array['cta'], 70, false),
         ('R-CTA-05', 'CTA ammessa: Scrivici su WhatsApp per una call conoscitiva di 15 minuti, e gratuita', 'social-manager/lib/conversion-claude.ts', array['cta'], 70, false),
         ('R-CTA-06', 'CTA ammessa: Prenota 15 minuti con il team InDubai, senza impegno', 'social-manager/lib/conversion-claude.ts', array['cta'], 70, false),
         ('R-CTA-07', 'CTA ammessa: Hai domande? Scrivici, rispondiamo entro 24h', 'social-manager/lib/conversion-claude.ts', array['cta'], 70, false),
         ('R-CTA-08', 'CTA ammessa: Ne parliamo? Scrivici e ti raccontiamo come funziona davvero', 'social-manager/lib/conversion-claude.ts', array['cta'], 70, false),
         ('R-AUD-01', 'Pubblico: imprenditori italiani fra 30 e 55 anni con attivita digitali, dal software ai servizi, dal commercio elettronico alle criptovalute, alla consulenza.', 'social-manager/lib/claude.ts', array['pubblico'], 85, false),
         ('R-AUD-02', 'Il pubblico vuole ottimizzazione fiscale legale.', 'social-manager/lib/claude.ts', array['pubblico'], 80, false),
         ('R-AUD-03', 'Il pubblico teme errori con il fisco italiano: AIRE, paesi a fiscalita privilegiata, centro degli interessi vitali.', 'social-manager/lib/claude.ts', array['pubblico'], 80, false),
         ('R-AUD-04', 'Il pubblico cerca un partner esperto e affidabile.', 'social-manager/lib/claude.ts', array['pubblico'], 80, false),
         ('R-PILLAR-01', 'Pillar normativa e fisco UAE: 35 per cento delle uscite.', 'social-manager/lib/claude.ts', array['pillar','piano'], 85, false),
         ('R-PILLAR-02', 'Pillar aprire societa a Dubai: 25 per cento delle uscite.', 'social-manager/lib/claude.ts', array['pillar','piano'], 85, false),
         ('R-PILLAR-03', 'Pillar residenza fiscale, cioe TRC, AIRE e convenzioni: 20 per cento delle uscite.', 'social-manager/lib/claude.ts', array['pillar','piano'], 85, false),
         ('R-PILLAR-04', 'Pillar lifestyle Dubai, costo della vita e opportunita: 10 per cento delle uscite.', 'social-manager/lib/claude.ts', array['pillar','piano'], 85, false),
         ('R-PILLAR-05', 'Pillar dati e analisi, statistiche e tendenze di mercato: 10 per cento delle uscite.', 'social-manager/lib/claude.ts', array['pillar','piano'], 85, false),
         ('R-PILLAR-06', 'I pillar dei contenuti originali sono cinque: rottura di credenze, strutture fiscali, compliance, residenza fiscale, normativa.', 'social-manager/lib/original-claude.ts', array['pillar'], 80, false),
         ('R-PILLAR-07', 'Il piano gira su 12 uscite: 9 di opportunita e 3 di presidio, e mai due di presidio ravvicinate.', 'social-manager/lib/newsletter.ts:210-227', array['piano'], 90, false),
         ('R-PILLAR-08', 'In una uscita di opportunita la TRC, i 183 giorni e gli accertamenti non possono essere l''argomento principale: al massimo una precisazione tecnica di una riga.', 'social-manager/lib/newsletter.ts:238', array['piano'], 85, false),
         ('R-PILLAR-09', 'I tre servizi ruotano per non spingere sempre lo stesso: apertura societa UAE, trasferimento e residenza fiscale, consulenza e verifica della posizione.', 'social-manager/lib/newsletter.ts:242-258', array['piano','servizi'], 80, false),
         ('R-FACT-01', 'Golden Visa investitore: investimento minimo 2.000.000 AED. Non 250.000, non 500.000, non 1.000.000.', 'social-manager/lib/fact-check.ts', array['dati','golden-visa'], 95, true),
         ('R-FACT-02', 'Golden Visa immobiliare: proprieta dal valore minimo di 2.000.000 AED.', 'social-manager/lib/fact-check.ts', array['dati','golden-visa'], 90, true),
         ('R-FACT-03', 'Golden Visa imprenditore: capitale minimo 500.000 AED oppure approvazione di un incubatore.', 'social-manager/lib/fact-check.ts', array['dati','golden-visa'], 90, true),
         ('R-FACT-04', 'Golden Visa talenti specializzati: scienziati, medici, inventori, artisti e dirigenti, su nomina o approvazione.', 'social-manager/lib/fact-check.ts', array['dati','golden-visa'], 85, false),
         ('R-FACT-05', 'Golden Visa studenti eccellenti: media minima 3.8.', 'social-manager/lib/fact-check.ts', array['dati','golden-visa'], 85, false),
         ('R-FACT-06', 'Golden Visa: durata 10 anni, rinnovabile.', 'social-manager/lib/fact-check.ts', array['dati','golden-visa'], 90, true),
         ('R-FACT-07', 'Corporate Tax UAE: aliquota 9 per cento sul reddito imponibile sopra 375.000 AED.', 'social-manager/lib/fact-check.ts', array['dati','corporate-tax'], 95, true),
         ('R-FACT-08', 'Corporate Tax UAE: in vigore dal 1 giugno 2023.', 'social-manager/lib/fact-check.ts', array['dati','corporate-tax'], 95, true),
         ('R-FACT-09', 'Registrazione Corporate Tax obbligatoria per tutti i soggetti, anche sotto soglia.', 'social-manager/lib/fact-check.ts', array['dati','corporate-tax'], 95, true),
         ('R-FACT-10', 'QFZP a zero per cento: richiede sette condizioni stringenti, reddito qualificato e sostanza nella free zone.', 'social-manager/lib/fact-check.ts', array['dati','corporate-tax','qfzp'], 90, true),
         ('R-FACT-11', 'Small Business Relief: sotto 3.000.000 AED, ma si perdono le perdite riportabili.', 'social-manager/lib/fact-check.ts', array['dati','corporate-tax'], 90, true),
         ('R-FACT-12', 'Sanzione per mancata registrazione Corporate Tax: 10.000 AED.', 'social-manager/lib/fact-check.ts', array['dati','corporate-tax','sanzioni'], 90, true),
         ('R-FACT-13', 'VAT UAE: aliquota 5 per cento, in vigore dal 2018.', 'social-manager/lib/fact-check.ts', array['dati','vat'], 95, true),
         ('R-FACT-14', 'VAT UAE: soglia di registrazione obbligatoria 375.000 AED.', 'social-manager/lib/fact-check.ts', array['dati','vat'], 95, true),
         ('R-FACT-15', 'VAT UAE: soglia di registrazione volontaria 187.500 AED.', 'social-manager/lib/fact-check.ts', array['dati','vat'], 90, true),
         ('R-FACT-16', 'Residenza fiscale italiana, articolo 2 del TUIR: domicilio oppure residenza oppure sede principale in Italia per la maggior parte del periodo d''imposta.', 'social-manager/lib/fact-check.ts', array['dati','residenza','tuir'], 95, true),
         ('R-FACT-17', 'Dal 2024, articolo 2-bis del TUIR: basta la presenza in Italia per la maggior parte del periodo d''imposta.', 'social-manager/lib/fact-check.ts', array['dati','residenza','tuir'], 95, true),
         ('R-FACT-18', 'L''iscrizione all''AIRE e necessaria ma non sufficiente, e l''onere della prova e sul contribuente.', 'social-manager/lib/fact-check.ts', array['dati','residenza','aire'], 95, true),
         ('R-FACT-19', 'CRS: gli Emirati scambiano informazioni con l''Italia dal 2018.', 'social-manager/lib/fact-check.ts', array['dati','crs'], 95, true),
         ('R-FACT-20', 'Quadro RW obbligatorio per le attivita finanziarie estere.', 'social-manager/lib/fact-check.ts', array['dati','crs','rw'], 95, true),
         ('R-FACT-21', 'Sanzione per mancata dichiarazione nel quadro RW: dal 3 al 15 per cento del saldo, dal 6 al 30 per cento se il paese e a fiscalita privilegiata.', 'social-manager/lib/fact-check.ts', array['dati','sanzioni','rw'], 90, true),
         ('R-FACT-22', 'Convenzione Italia-Emirati: firmata il 22 gennaio 1995, in vigore.', 'social-manager/lib/fact-check.ts', array['dati','convenzione'], 90, true),
         ('R-FACT-23', 'Convenzione Italia-Emirati, dividendi: ritenuta massima 5 per cento con partecipazione di almeno il 25 per cento, altrimenti 15 per cento.', 'social-manager/lib/fact-check.ts', array['dati','convenzione'], 90, true),
         ('R-FACT-24', 'Criterio dirimente della convenzione, in ordine: abitazione permanente, centro degli interessi vitali, soggiorno abituale, nazionalita.', 'social-manager/lib/fact-check.ts', array['dati','convenzione','residenza'], 90, true),
         ('R-FACT-25', 'Affitto di un monolocale o bilocale a Dubai Marina o JBR: da 60.000 a 100.000 AED l''anno.', 'social-manager/lib/fact-check.ts', array['dati','costo-vita'], 75, false),
         ('R-FACT-26', 'Affitto di una villa a tre camere: da 150.000 a 300.000 AED l''anno a seconda della zona.', 'social-manager/lib/fact-check.ts', array['dati','costo-vita'], 75, false),
         ('R-FACT-27', 'Scuola internazionale: da 30.000 a 80.000 AED l''anno per figlio.', 'social-manager/lib/fact-check.ts', array['dati','costo-vita'], 75, false),
         ('R-FACT-28', 'Assicurazione sanitaria: da 5.000 a 15.000 AED l''anno a persona.', 'social-manager/lib/fact-check.ts', array['dati','costo-vita'], 75, false),
         ('R-FACT-29', 'Non fare promesse su risparmi specifici: e troppo variabile caso per caso.', 'social-manager/lib/fact-check.ts', array['divieto','promesse'], 95, true),
         ('R-FACT-30', 'Apertura di una societa negli Emirati: da 7 a 14 giorni lavorativi con la documentazione pronta.', 'social-manager/lib/conversion-claude.ts', array['dati','tempistiche'], 80, false),
         ('R-FACT-31', 'Apertura del conto bancario: da 2 a 4 settimane.', 'social-manager/lib/conversion-claude.ts', array['dati','tempistiche'], 80, false),
         ('R-FACT-32', 'Emirates ID e visto: da 2 a 3 settimane.', 'social-manager/lib/conversion-claude.ts', array['dati','tempistiche'], 80, false),
         ('R-FACT-33', 'Dire che la residenza fiscale si ottiene in 3-6 settimane e falso: quella e la residenza amministrativa. La TRC richiede piu di 183 giorni di presenza effettiva.', 'social-manager/lib/newsletter.ts:421', array['dati','residenza','errore-comune'], 95, true),
         ('R-FACT-34', 'Gravita critica vuol dire un numero o un dato sbagliato che danneggia la credibilita, e blocca l''approvazione. Gravita di avvertimento vuol dire imprecisione minore: si segnala, non blocca.', 'social-manager/lib/fact-check.ts', array['revisione','procedura'], 90, false),
         ('R-GHL-01', 'Le storie vanno pubblicate con tipo story e senza data di programmazione: con la data GHL le trasforma in post normali.', 'social-manager/CLAUDE.md', array['ghl','pubblicazione'], 95, true),
         ('R-GHL-02', 'Storie Instagram: tutte le slide in un unico invio.', 'social-manager/CLAUDE.md', array['ghl','pubblicazione'], 90, false),
         ('R-GHL-03', 'Storie Facebook: solo la prima slide, perche'' con piu media risponde 422.', 'social-manager/CLAUDE.md', array['ghl','pubblicazione'], 90, true),
         ('R-GHL-04', 'TikTok: niente anteprima personalizzata, solo video, tipo reel. Non supporta anteprime personalizzate tramite interfacce di terze parti.', 'social-manager/CLAUDE.md', array['ghl','pubblicazione','tiktok'], 90, true),
         ('R-GHL-05', 'Reel su Instagram e Facebook: tipo reel, media video/mp4.', 'social-manager/CLAUDE.md', array['ghl','pubblicazione'], 90, false),
         ('R-GHL-06', 'Post normali: tipo post, media image/jpeg.', 'social-manager/CLAUDE.md', array['ghl','pubblicazione'], 90, false),
         ('R-GHL-07', 'La pubblicazione fa chiamate separate per le piattaforme a immagine e per quelle solo video.', 'social-manager/lib/ghl.ts:154-230', array['ghl','tecnica'], 85, false),
         ('R-GHL-08', 'Le piattaforme solo video sono TikTok, YouTube e i reel di Instagram.', 'social-manager/lib/ghl.ts:60', array['ghl','tecnica'], 85, false),
         ('R-GHL-09', 'Massimo 10 media per post.', 'social-manager/lib/ghl.ts:184', array['ghl','limiti'], 90, true),
         ('R-GHL-10', 'Intestazione di versione GHL: 2021-07-28 per la pubblicazione social, 2021-04-15 per calendari e contatti.', 'social-manager/lib/ghl.ts:11', array['ghl','tecnica'], 80, false),
         ('R-GHL-11', 'La caption pubblicata e la caption, poi due ritorni a capo, poi gli hashtag.', 'social-manager/lib/ghl.ts:148', array['ghl','formato'], 85, false),
         ('R-GHL-12', 'I video su Cloudinary vanno caricati come raw, altrimenti Cloudinary aggiunge codecs=avc1 al tipo di contenuto e TikTok e YouTube rifiutano il file.', 'social-manager/lib/upload.ts:26-28', array['cloudinary','tecnica'], 85, false)
       ) as v(codice, testo, fonte, tags, peso, vincolante)
 where b.slug = 'indubai'
on conflict (brand_id, codice) where codice is not null do update
  set testo = excluded.testo, fonte = excluded.fonte, tags = excluded.tags,
      peso = excluded.peso, vincolante = excluded.vincolante, updated_at = now();

-- ── Il Cervello: i design ───────────────────────────────────
insert into smm_brain (brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
select b.id, 'design', v.codice, v.testo, v.fonte, v.tags, v.peso, v.vincolante, true
  from smm_brands b,
       (values
         ('D-FMT-01', 'Carosello: 1080 per 1350 pixel.', 'social-manager/lib/carousel.ts:168', array['formato','carosello'], 90, false),
         ('D-FMT-02', 'Storia e reel: 1080 per 1920 pixel, fattore di scala 2.', 'social-manager/lib/story.ts', array['formato','storia','reel'], 90, false),
         ('D-FMT-03', 'Durata di una slide nelle storie: 5 secondi.', 'social-manager/lib/story.ts:17', array['formato','storia'], 85, false),
         ('D-FMT-04', 'Icone disponibili per le slide: tax, building, globe, shield, chart, person.', 'social-manager/lib/claude.ts', array['formato','icone'], 80, false),
         ('D-FMT-05', 'Tipi di slide del carosello: standard con icona, titolo e testo, oppure stats con quattro dati valore, etichetta e descrizione.', 'social-manager/lib/claude.ts', array['formato','carosello'], 85, false),
         ('D-FMT-06', 'Tipi di slide delle storie: intro, content, cta.', 'social-manager/lib/story.ts:32', array['formato','storia'], 85, false),
         ('D-FMT-07', 'Lunghezze massime: titolo di copertina 10 parole, sottotitolo 15, titolo di slide 8, testo della CTA 12, caption 150 parole.', 'social-manager/lib/claude.ts', array['formato','lunghezze'], 85, false),
         ('D-FMT-08', 'Colori InDubai: accento b5ff00, sfondo 0d0d1a, card 13131f, bordo 2a2a45.', 'social-manager/lib/brands.ts', array['colori','brand'], 90, false),
         ('D-FMT-09', 'Font dei visual: -apple-system, Helvetica Neue, Arial, sans-serif.', 'social-manager/lib/carousel.ts:169', array['tipografia'], 80, false),
         ('D-FMT-10', 'Titolo di copertina 96 pixel peso 900 con spaziatura -4. Sottotitolo 36 pixel peso 400. Badge 20 pixel peso 700 tutto maiuscolo con spaziatura 2.5.', 'social-manager/lib/carousel.ts:182-187', array['tipografia'], 80, false),
         ('D-FMT-11', 'Hashtag di riferimento: dubai, fiscalitadubai, imprenditori, emiratiarabiuniti, residenzafiscale, business, dubai2026, fiscalita, imprenditoria, indubai.', 'social-manager/lib/brands.ts', array['hashtag'], 80, false)
       ) as v(codice, testo, fonte, tags, peso, vincolante)
 where b.slug = 'indubai'
on conflict (brand_id, codice) where codice is not null do update
  set testo = excluded.testo, fonte = excluded.fonte, tags = excluded.tags,
      peso = excluded.peso, vincolante = excluded.vincolante, updated_at = now();

-- ── Il Cervello: gli studi (knowledge base fiscale) ─────────
-- I 21 topic strutturati di social-manager/lib/knowledge.ts, in sintesi. Sono
-- materiale da cui lo Stratega pesca, non regole da applicare.
insert into smm_brain (brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
select b.id, 'studio', v.codice, v.testo,
       'social-manager/lib/knowledge.ts', array['knowledge-base', v.pillar], 60, false, true
  from smm_brands b,
       (values
         ('S-KB-zero-tax-myth', 'Zero tasse a Dubai: mito o realta dopo il 2023? Chi opera dal 2023 senza registrazione Corporate Tax rischia sanzioni, accertamenti retroattivi e blocco del conto. Zero imposta dovuta e possibile con struttura corretta, zero obblighi e impossibile. Riferimenti: Federal Decree-Law 47/2022, Ministerial Decision 73/2023.', 'miti'),
         ('S-KB-rak-icc-holding-trap', 'La holding RAK ICC salva dalla Corporate Tax? Dipende. Struttura analizzata per quando regge e quando no.', 'strutture'),
         ('S-KB-poem-invisible-trap', 'POEM, sede di direzione effettiva: la trappola che rende tassabile una societa estera.', 'compliance'),
         ('S-KB-qfzp-conditions', 'Qualifying Free Zone Person: le sette condizioni che nessuno spiega.', 'normativa'),
         ('S-KB-aire-not-enough', 'Iscrizione all''AIRE: non basta. Cosa guarda davvero l''Agenzia delle Entrate.', 'residenza'),
         ('S-KB-substance-requirements', 'Sostanza economica a Dubai: non basta una scrivania e un telefono.', 'compliance'),
         ('S-KB-transfer-pricing-trap', 'Prezzi di trasferimento fra societa dello stesso gruppo: il rischio che si ignora.', 'normativa'),
         ('S-KB-small-business-relief-trap', 'Small Business Relief: la scorciatoia che puo costare cara.', 'normativa'),
         ('S-KB-bank-account-compliance', 'Il conto in banca negli Emirati: il guardiano che puo bloccare tutto.', 'compliance'),
         ('S-KB-exit-tax-italy', 'Exit tax: l''Italia tassa anche chi se ne va.', 'residenza'),
         ('S-KB-convenzione-italia-uae', 'Convenzione Italia-Emirati: cosa copre davvero e cosa no.', 'normativa'),
         ('S-KB-freelancer-dubai-mistake', 'Freelance a Dubai: il visto non e una strategia fiscale.', 'residenza'),
         ('S-KB-permanent-establishment-risk', 'Stabile organizzazione: il rischio che non si vede.', 'strutture'),
         ('S-KB-crypto-dubai-tax', 'Criptovalute a Dubai: davvero zero tasse? Non cosi in fretta.', 'miti'),
         ('S-KB-crs-automatic-exchange', 'CRS: il fisco italiano sa gia del conto a Dubai.', 'compliance'),
         ('S-KB-mainland-vs-freezone-real', 'Mainland contro free zone: la verita che il consulente non dice.', 'strutture'),
         ('S-KB-beneficial-ownership', 'Titolare effettivo: chi e il vero proprietario della societa.', 'compliance'),
         ('S-KB-vat-uae-surprise', 'VAT al 5 per cento negli Emirati: la tassa che tutti dimenticano.', 'normativa'),
         ('S-KB-family-business-succession', 'Azienda di famiglia a Dubai: e se domani non ci sei piu?', 'strutture'),
         ('S-KB-double-taxation-real-risk', 'Doppia imposizione: quando si pagano le tasse in due paesi.', 'residenza')
       ) as v(codice, testo, pillar)
 where b.slug = 'indubai'
on conflict (brand_id, codice) where codice is not null do update
  set testo = excluded.testo, updated_at = now();

-- ── Il Cervello: i formati narrativi ────────────────────────
insert into smm_brain (brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
select b.id, 'studio', v.codice, v.testo, v.fonte, array['formato-narrativo'], 70, false, true
  from smm_brands b,
       (values
         ('S-FMT-A', 'Formato ANALISI. Arco narrativo: problema, trappola, numeri, realta. Caption analitica che parte da un fatto normativo, lo scompone e crea il dubbio. Quattro slide: il problema con il riferimento normativo, la trappola con l''errore comune, i numeri con quattro dati reali, la realta con la verita scomoda.', 'social-manager/lib/original-claude.ts'),
         ('S-FMT-B', 'Formato MYTH BUSTER. Arco narrativo: il mito, perche'' e sbagliato, la verita, i numeri. Caption provocatoria che inizia da una credenza diffusa e la demolisce con i fatti.', 'social-manager/lib/original-claude.ts'),
         ('S-FMT-C', 'Formato CASO PRATICO. Si racconta una situazione tipo riconoscibile, con eta e professione, e si mostra dove si rompe.', 'social-manager/lib/original-claude.ts'),
         ('S-FMT-D', 'Formato CONFRONTO. Due colonne, prima e dopo oppure Italia e Dubai, con tre o quattro righe di confronto brevi.', 'social-manager/lib/original-claude.ts'),
         ('S-FMT-E', 'Formato PROVOCAZIONE. Si apre con una domanda che mette a disagio e si tiene la tensione fino al cliffhanger.', 'social-manager/lib/original-claude.ts')
       ) as v(codice, testo, fonte)
 where b.slug = 'indubai'
on conflict (brand_id, codice) where codice is not null do update
  set testo = excluded.testo, updated_at = now();
