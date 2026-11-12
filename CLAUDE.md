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
