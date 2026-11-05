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
