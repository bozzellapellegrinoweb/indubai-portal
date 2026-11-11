# Linee guida della Regia

Regole per chi tocca `regia.html`, `js/regia-ui.js` e `js/regia-3d.js`.
Non sono gusto personale: ognuna nasce da una cosa che si era rotta, e
accanto c'è scritto quale.

---

## 1. I livelli: una scala sola, dichiarata in un posto solo

**La regola.** Tutto ciò che si sovrappone prende il numero da `:root` in
cima a `regia.html`. Nessuno scrive uno `z-index` a mano nel punto in cui
serve.

```
--liv-scena      1      la tela 3D
--liv-fumetti    3      i fumetti sopra le teste
--liv-controlli  6      zoom, schermo intero, orologio
--liv-velo    1000      il velo che spegne la pagina
--liv-pannello 1001     il pannello laterale
--liv-modale  1100      le finestre, sempre sopra il pannello
--liv-toast   1200      gli avvisi, sempre in cima
```

**Perché.** Il portale ha i suoi numeri sparsi: modale 200, barre 300,
toast 999. Il pannello della Regia stava a 600. Risultato: premendo
«Aggiungi la nota» la finestra si apriva **dietro** il pannello, e
sembravano due finestre accavallate. La Regia alza modale e toast del
portale sopra il proprio pannello, e lo fa in quelle due righe, non sparse.

---

## 2. Mai una finestra sopra un pannello aperto

**La regola.** Se il pannello laterale è aperto, un'azione che chiede
qualcosa si apre **dentro** il pannello, come riquadro
(`riquadroNelPannello`), non come finestra. Le finestre (`modale`) restano
per le azioni che partono dalla pagina, e se il pannello è aperto lo
chiudono prima.

**Perché.** Alzare lo `z-index` nascondeva il sintomo. Il problema era che
una finestra sopra un pannello già aperto è una cosa di troppo: due
contenitori, due pulsanti «chiudi», e non si capisce più dove si sta
lavorando. Il riquadro compare dove stai già guardando.

Oggi stanno dentro il pannello: aggiungi la nota, carica un file, rimanda
indietro. Restano finestre: nuovo lavoro, reference, inserisci i numeri.

---

## 3. Quello che è coperto è anche spento

**La regola.** Quando il pannello è aperto, lo sfondo prende `inert`
(`sfondoInerte(true)`), e `[inert]` lo desatura.

**Perché.** Prima la pagina dietro era solo scurita: i pulsanti sembravano
cliccabili. Premendo «Nuovo lavoro» si colpiva il velo, che chiudeva il
pannello, e il pulsante sembrava rotto. Con `inert` il browser lo toglie
dal puntatore, dalla tastiera e dagli screen reader. Se non si può
premere, non deve sembrare che si possa.

---

## 4. Esc chiude un livello alla volta

**La regola.** Dall'alto: finestra, riquadro, pannello, schermo intero.
Un `Escape`, un livello.

**Perché.** Chiudere tutto insieme fa perdere il posto: stavi scrivendo
una nota, premi Esc per annullare quella, e ti ritrovi fuori dal
contenuto.

---

## 5. Il colore vuol dire sempre la stessa cosa

```
rosso    qualcuno è fermo e aspetta te, oppure il Revisore ha bloccato
giallo   da sistemare, ma non blocca
verde    fatto, approvato, pronto
grigio   in corso, nessuna azione richiesta
```

Vale ovunque: anello sotto l'avatar, bordo della scheda, **e il pulsante
dentro quella scheda**. Una scheda rossa con il pulsante verde era la cosa
che faceva sembrare la pagina casuale.

---

## 6. Prima cosa da fare, poi lo stato

**La regola.** «Tocca a te» sta **sopra** la scena.

**Perché.** La stanza in 3D è lo stato: chi lavora, chi è fermo, chi ha
una domanda. «Tocca a te» è la lista delle cose che aspettano te. Stava
sotto la scena, cioè sotto la piega: su un portatile si vedeva la stanza
e non si vedeva cosa fare. La cosa che chiede un'azione viene prima.

---

## 7. La barra dei comandi su due file

Sopra: **dove sei** (Sala, Calendario, Risultati) e l'azione principale
(Nuovo lavoro). Sotto: **come guardi** (zona, vista a lista). La seconda
fila sparisce dove non serve.

**Perché.** Nove comandi in fila non dicevano quali cambiano pagina e
quali cambiano solo la vista.

---

## 8. La scena ha comandi visibili, non solo gesti

Zoom più, zoom meno, vista d'insieme, schermo intero: in basso a destra,
sempre.

**Perché.** Prima lo zoom era solo la rotellina e l'inquadratura si
riportava a posto solo cliccando. Un comando che esiste solo come gesto,
per metà delle persone non esiste. La rotellina sulla scena non fa più
scorrere la pagina.

---

## 9. L'ufficio resta leggibile a qualunque ora

La luce segue l'ora di Dubai, ma di sera **cala quella da fuori e salgono
le lampade**, con un bianco caldo.

**Perché.** La prima versione abbassava tutto: alle due di notte la
stanza era una poltiglia grigia in cui non si distingueva un agente da una
pianta. Un ufficio di sera non è buio, è illuminato dall'interno. Cambia
l'atmosfera, non la leggibilità.

---

## 10. La vista a lista è la base, il 3D ci si appoggia

Ogni cosa che si fa nella scena si deve poter fare nella lista: stesse
informazioni, stesse azioni. Chi aggiunge qualcosa al 3D la aggiunge anche
lì.

**Perché.** La lista è quello che vede chi ha `prefers-reduced-motion`,
chi ha un dispositivo lento, chi usa uno screen reader, e chiunque se il
3D non parte. Se è un ripiego costruito dopo, è peggiore. Se è la base,
non lo è.

---

## 11. Si parla come si parla a un collega

Niente prompt, token, modelli, coda, record, endpoint. Gli agenti dicono
cosa stanno facendo («scrive la caption», «monta le slide»), gli errori
dicono cosa è andato storto e cosa fare.

Gli errori che arrivano dal database sono già scritti per una persona
(«Non si pubblica senza un'approvazione umana registrata»): si mostrano
così come sono, ripuliti solo del prefisso tecnico.

---

## 12. Prima di dire che è a posto

```
node tests/smm.test.mjs     # 62 test su un PostgreSQL vero
```

E una passata nel browser a tre larghezze (1440, 860, 390) controllando:
nessuno scroll orizzontale, nessun id duplicato, il campo di un form
raggiungibile davvero (`elementFromPoint`, non solo «è visibile»),
Esc che chiude un livello alla volta, zero errori in console.

Gli ultimi quattro bug di questa sezione li ha trovati il browser, non la
lettura del codice: un `id` duplicato, una tela senza misura in CSS, un
`mouseup` su `window` che apriva pannelli a caso, e un riquadro invisibile
steso sopra la scena che si mangiava i click.
