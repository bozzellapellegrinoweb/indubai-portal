# Regole di sviluppo — InDubai Portal

## Ogni pagina nuova si collega ai permessi. Sempre.

Non esistono pagine riservate "per costruzione". Se una pagina si vede solo
perché il menu la mostra a un ruolo cablato nel codice, è sbagliata: l'admin
deve poterla concedere o togliere dal portale, senza chiedere un rilascio.

Quando si aggiunge una pagina servono **tre** passaggi, non uno:

1. **La voce di menu** in `js/app.js`, dentro `allNavItems`, in una sezione
   normale. Non dentro i blocchi `...(role === 'admin' ? [...] : [])`: quelli
   la rendono invisibile al sistema permessi.

2. **Il valore predefinito per ruolo** in `js/app.js`, dentro
   `ROLE_PAGES_DEFAULT`. È l'unica fonte: `users.html` lo rilegge da
   `window.ROLE_PAGES_DEFAULT`, non tiene una copia propria.
   Una pagina assente dai predefiniti semplicemente non parte concessa, e si
   concede dalla matrice.

3. **La voce nella matrice permessi** in `users.html`, dentro `ALL_PAGES`,
   nella sezione giusta. Senza questa l'admin non la può concedere.

### Perché tutti e tre

`savePermissions()` scrive in `role_permissions` solo le pagine presenti nella
matrice. Una pagina che sta nel menu ma non nel catalogo viene **cancellata a
ogni salvataggio**, in silenzio: è così che la Pipeline è sparita a junior,
mini_admin e collaborator. Oggi il salvataggio conserva le pagine fuori
catalogo, ma la rete di protezione non sostituisce il passaggio 3.

### Come verificarlo

```
# ogni voce di menu deve comparire nella matrice
grep -o "href: '/[a-z0-9-]*\.html'" js/app.js
grep -o "{ id:'[a-z0-9-]*'" users.html
```

Le uniche voci legittimamente fuori dalla matrice sono quelle della sezione
`ADMIN` che toccano il portale stesso: `attivita`, `ambassadors`, `users`,
`notifiche-admin`, `mcp`. Tutto il resto va concedibile.

### Gli strumenti dentro un'altra pagina

Non tutto e' una pagina del menu. Un pannello dentro la scheda cliente (la
scheda Testamento, l'Onboarding) non passa dal controllo dei permessi, perche'
`client-detail` e' esentata dal redirect: la si apre da Clienti, non dal menu.

Quando lo stesso strumento ha una pagina nel menu e un pannello nella scheda
cliente, **usano lo stesso id**, cosi' una concessione sola copre entrambi:
`testamento.html` e la scheda Testamento sono tutti e due `testamento`.
L'id deve coincidere col nome del file, perche' `app.js` ricava la pagina
corrente dall'indirizzo e chi non ce l'ha viene rimandato altrove.

Vale la stessa regola, con due aggiunte:

- la pagina che lo ospita chiede il permesso da se', con
  `window.canSeePage('<id>')`, e **rimuove** dal DOM il pannello, non lo
  nasconde con il CSS;
- il dato lo chiude una policy RLS che legge la stessa voce. Esempio:
  `can_see_wills()` in `20261106_permesso_testamento.sql`, con la lista dei
  ruoli predefiniti in `wills_default_roles()` da tenere allineata a
  `ROLE_PAGES_DEFAULT`.

Togliere un permesso a un ruolo che ce l'ha oggi e' un cambio di
comportamento: il predefinito conserva cio' che si vede, e la revoca la decide
l'admin dalla matrice.

## I dati li protegge il database, non l'interfaccia

Nascondere un campo o una voce di menu non è una misura di sicurezza: il dato
arriva comunque al browser e si legge dagli strumenti per sviluppatori, o
chiamando l'API con il proprio token.

- **Righe** → RLS su Postgres. È l'unica barriera vera.
- **Colonne** → se un ruolo non deve vedere un importo, la query non deve
  chiederlo (`columns:` esplicito), e il dato va spostato in una tabella
  separata con RLS propria quando la riservatezza conta davvero.

Funzioni già pronte: `is_portal_staff()`, `sees_financials()`,
`is_commerciale()`, `sees_only_assigned_clients()`.

## Prima di aprire un branch

`main` è il branch pubblicato. Un branch va aperto **da `main` aggiornato** e
tenuto corto: un branch vecchio di settimane diverge e diventa impossibile da
unire.

```
git fetch origin && git checkout -b <nome> origin/main
```

## La Regia SMM: i presidi stanno nel database

La sezione social (`regia.html`) e' l'unica parte del portale in cui lavorano
agenti AI che scrivono sul database da soli. Per questo tre regole non sono
controlli nell'interfaccia ma trigger su `smm_contents`, e vanno lasciate li':

1. un contenuto non entra in **approvazione** senza il via libera del
   Revisore (`revisore_ok`);
2. non si **pubblica** senza un'approvazione umana registrata, e sulle
   categorie sensibili con la doppia approvazione accesa serve anche l'admin;
3. i **termini vietati** (avvocato, studio legale, lawyer, law firm) fermano
   il via libera. Il Revisore e' un modello e puo' distrarsi: quella
   particolare regola riguarda la qualifica professionale, quindi e' scritta
   due volte.

Spostarne una in JavaScript vuol dire toglierla: gli agenti scrivono dal
server, non dal browser.

### La stanza non deve raccontare cose false

Nella scena 3D gli agenti camminano, prendono il caffe', si sdraiano in
pausa e si parlano. E' la parte che si vede da lontano, e per questo e'
anche quella che puo' mentire piu' facilmente: un agente che si alza
mentre sta lavorando dice a chi passa che non sta lavorando.

Quindi il movimento segue lo stato vero e non il caso:

- chi ha `posa` `lavora`, `mano_alzata` o `spento` **resta al suo posto**;
- si alza solo chi e' libero, e per un motivo che esiste — una
  collaborazione vera fra i lavori aperti, o una pausa;
- mai piu' di due **in piedi** che partono insieme, e quattro fuori posto
  in tutto. Il tetto riguarda chi cammina o sta ritto, non chi e' seduto
  altrove: tre che camminano insieme sono un corteo, tre seduti al tavolo
  riunioni sono una riunione. Chi e' seduto fuori posto e ha finito il suo
  tempo aspetta che il tetto si liberi, ma dopo quaranta secondi si alza
  comunque — un tetto che inchioda qualcuno al divano non e' un tetto, e'
  un guasto — quindi di fatto si arriva a tre.

E chi resta alla scrivania senza lavorare non sta immobile: si stiracchia,
si appoggia allo schienale, guarda il telefono, pensa. Erano cinque agenti
liberi su otto nella stessa identica posa, e le uscite verso il caffe' o il
divano sono rade di proposito — quindi la stanza stava ferma quasi sempre.

`tests/banco/prova-movimento.cjs` guarda la stanza per due minuti e mezzo
e verifica proprio questo. I muri sono piani a faccia singola di
proposito: quando la camera gira dietro spariscono invece di tagliare la
vista.

### Approvare vuol dire programmare

Non esiste piu' il gesto «e adesso trascinalo nel calendario». Quando il
manager approva, il contenuto prende da solo una data e passa in
`in_calendario`; da li' lo pubblica il cron come prima.

La data la decide il piano, perche' e' il piano che sa queste cose:

- i **giorni** sono quelli di `smm_piano.giorni` (vuoto = tutti);
- l'**ora** e' `smm_piano.ora`, se no `smm_settings.ora_uscita`, se no le
  21:00 di Dubai — le 18:00 in Italia, che e' il pubblico;
- un giorno e' libero se non c'e' gia' un altro contenuto **dello stesso
  tipo** in calendario: il piano chiede una storia al giorno, e due storie
  lo stesso giorno non sono il piano;
- mai nel passato, e mai entro dieci minuti: il cron gira ogni cinque e
  deve restare il tempo di cambiare idea.

Tutto resta spostabile a mano, e **togliere un contenuto dal calendario non
lo riprogramma**: il trigger non riparte quando lo stato torna ad
«approvato» venendo da «in_calendario», altrimenti non si potrebbe piu'
toglierlo.

Due cose da non rompere:

1. il trigger si chiama `trg_smm_zz_programma` e il nome conta. Postgres
   esegue i trigger in ordine di nome, questo cambia `stato`, e i presidi
   che leggono `new.stato` si chiamano tutti `trg_smm_guard_*`: un nome che
   viene prima della «g» salterebbe il controllo sui termini vietati, in
   silenzio. C'e' un test che lo prova davvero — rinominando il trigger,
   fallisce;
2. un contenuto in «approvato» **con** una data non esce:
   `smm_programmati_in_scadenza` pretende `in_calendario`. Era uno dei due
   modi di restare fermi, ed e' successo.

I test sono in `tests/smm.test.mjs`, gruppo «Approvare vuol dire
programmare»: undici prove, fra cui l'ordine dei trigger e la seconda firma
sulle categorie sensibili, che aspetta l'amministratore prima di dare una
data.

### Un tipo di contenuto si puo' fermare

`smm_settings.tipi_fermi` e' la lista dei tipi in pausa. Un tipo in pausa si
approva ancora — la firma resta registrata — ma **non prende una data** e
**non esce**, neanche se in calendario c'era gia' finito prima della pausa.
Fermare la creazione non e' una terza regola: e' la riga di piano in pausa,
piu' l'agente che lo produce spento.

Non si cabla mai un tipo nel codice. Il 16 novembre si sono fermati i reel
perche' il manager non era contento di come venivano realizzati, e fra una
settimana torneranno fatti in un altro modo: una decisione del genere e' la
posizione di un interruttore, non una riga di `if`.

Per questo la decisione sta in un file suo — `20261116_smm_reel_in_pausa.sql`
— che **il banco di prova non rigioca**. Il meccanismo sta in
`20261116_smm_tipi_fermi.sql` e quello si', si rigioca. Mettere la decisione
dentro la migrazione del meccanismo ha rotto quattro test al primo
tentativo, ed era il sintomo giusto: ogni ambiente nuovo sarebbe nato coi
reel spenti per sempre, e i test avrebbero provato il piano editoriale di
InDubai invece del motore.

La si cambia dalla Direzione, con i tasti sotto «Che cosa e' fermo».

### «Tocca a te» non puo' crescere all'infinito

La striscia in cima alla Regia e' la lista delle cose che aspettano una
persona. Il 16 novembre erano diciotto — una domanda, tre contenuti fermati
dal Revisore, la settimana scoperta, tredici pronti da approvare — e la
griglia andava a tre righe: 550 pixel di tessere, la stanza schiacciata al
suo minimo di 360 e la pagina che scorreva. Diciotto cose da fare non sono
un difetto: sono una giornata normale, e i contenuti pronti si accumulano
da soli.

Quindi:

- la striscia mostra **quante ne stanno in una riga**, e dice quante
  restano («Altre 12»), che e' un tasto, non una perdita. Quante ne stanno
  lo chiede alla griglia (`gridTemplateColumns`), non a una copia del
  `minmax` del foglio di stile: due copie divergono al primo ritocco;
- l'ordine lo decide `toccaATe()` in `js/regia-dati.js`, e i contenuti
  **pronti da approvare vanno in fondo**: sono i piu' numerosi e i meno
  urgenti, e stando per primi nascondevano chi aspetta una risposta;
- titolo e testo delle tessere hanno un tetto di righe, e cosi' il testo
  dei fumetti nella stanza. Una domanda lunga una pagina si legge nel
  pannello, che e' dove si risponde: in una tessera faceva 322 pixel, in un
  fumetto copriva la stanza.

`tests/banco/prova-pieno.cjs` tiene fermo il contratto su uno schermo da
scrivania, con la giornata piena accesa da
`window.__BANCO_GIORNATA = 'piena'` (i dati stanno nello stub, non nel
test). Verifica anche che nessun cartellino finisca sotto un fumetto: i
cartellini si posizionano **dopo**, proprio per potersi scansare.

### Il nome e il mestiere sono due cose diverse

Gli agenti si chiamano Vegeta, Bulma, Gohan, Trunks, Goku, Piccolo, Crilin e
Whis. In `smm_agents` sono due colonne: `nome` e' la persona, `ruolo` e' cosa
fa. Prima coincidevano — si chiamavano "Direttore", "Copywriter" — e bastava
scrivere il nome.

Adesso non basta piu': dove c'era il solo nome vanno tutti e due. Cartellino
nella stanza, fumetto, fascia laterale, «Tocca a te», tendina di chi fa una
riga del piano. «Piccolo ha una domanda» non dice di cosa si parla, e il
mestiere dipinto sul monitor non salva niente: alla scala di resa e' alto tre
pixel.

Chi aggiunge un agente scrive tutti e due, e aggiorna anche
`tests/banco/stub-regia-dati.js`. Una finta col nome vecchio e' la trappola
del mestiere di `tests/banco/LEGGIMI.md`: il banco direbbe che la stanza
scrive "Direttore" mentre il portale scrive "Vegeta".

La **vetrina** (tasto V) e' la Regia da appendere a uno schermo in
ufficio: niente linguette ne' filtri, schermo intero vero, camera che gira
piano. Non e' la modalita' di lavoro, che e' lo **schermo intero** (tasto
F) e nasconde solo il menu del portale.

### Dove esce un contenuto non si scrive nel codice

Le piattaforme stanno in `smm_contents.piattaforme`, con un predefinito che
dipende dal formato (`smm_piattaforme_predefinite`): le storie solo dove
esistono, i reel anche su TikTok e YouTube, i caroselli anche su LinkedIn.
Il manager le cambia dal pannello del contenuto, con
`smm_piattaforme_imposta`.

Per mesi quella colonna e' esistita senza che nessuno la leggesse, mentre
`smm_programmati_in_scadenza` aveva `array['instagram','facebook']` scritto
dentro la funzione: un reel montato apposta per TikTok non ci sarebbe mai
arrivato, e non c'era un posto in cui accorgersene. Una colonna che nessuna
schermata mostra e nessun codice legge e' una colonna morta, e le colonne
morte tornano morte da sole: quando se ne aggiunge una, serve anche chi la
scrive, chi la legge e un test che lo verifichi.

Quali account siano davvero collegati su GoHighLevel si chiede a
`smm-publish` con `{"azione":"account"}`: non tocca nessun contenuto e non
manda niente. Prima si poteva sapere soltanto tentando una pubblicazione.

Il resto dell'impianto, con le regole editoriali importate dal progetto che
genera i post, sta in `docs/SMM_INVENTARIO.md`, `docs/SMM_PORTALE.md` e
`docs/SMM_PIANO.md`. I test sono in `tests/smm.test.mjs` e girano su un
PostgreSQL vero:

```
node tests/smm.test.mjs
```
