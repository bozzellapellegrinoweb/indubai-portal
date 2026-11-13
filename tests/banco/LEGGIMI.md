# Il banco: la Regia in un browser vero

Tre difetti li ha trovati questo, non i test: la scena 3D che occupava un
quarto del riquadro con il resto pavimento vuoto, i fumetti che si
coprivano a vicenda, e l'anteprima che mostrava sempre la stessa pagina.
Nessuno dei tre fa fallire niente: la pagina si carica, non ci sono errori
in console, e tutto quello che un test di forma puo' controllare torna.
Bisogna guardarla.

Il banco apre `regia.html` in Chromium e **sostituisce i quattro file che
parlano col database** — `supabase.js`, `app.js`, `notify.js`,
`regia-dati.js` — con delle finte. Pagina, `regia-ui.js` e la scena 3D
girano per davvero: e' quello il punto.

```
# in una finestra: il server
python3 -m http.server 8099 --bind 127.0.0.1

# nell'altra
node tests/banco/prova.cjs 1440 900            # misure + schermata
node tests/banco/prova.cjs 1920 1080           # su uno schermo grande
node tests/banco/prova.cjs 1440 900 calma=1    # la sala senza lavori
node tests/banco/prova-anteprima.cjs           # le linguette dei video
node tests/banco/prova-tutti.cjs               # i pannelli, e dove esce un contenuto
node tests/banco/prova-calendario.cjs          # il giorno giusto da quattro fusi
node tests/banco/prova-concentrato.cjs         # schermo intero, e la stanza leggibile
node tests/banco/prova-movimento.cjs           # chi si alza, dove va, chi resta seduto
node tests/banco/prova-vetrina.cjs             # lo schermo da appendere in ufficio
```

`prova-movimento.cjs` guarda per un minuto e mezzo, perche' le pause sono
rade di proposito. Controlla che qualcuno si alzi davvero, che chi lavora
resti al suo posto, che non ci siano mai piu' di due persone in piedi
insieme e che nessuno esca dalla stanza. E' anche il test che ha preso un
`Identifier 'dx' has already been declared` nel ciclo di animazione: la
scena non si apriva affatto, e `node --check` non se n'era accorto.

`prova-concentrato.cjs` e' quello che misura invece di guardare, su tre
schermi (1366, 1440, 1920): quanto e' grande la scena e che forma ha, se
la pagina scorre, se **il tasto di ogni fumetto si puo' davvero premere** e
se il testo sta sopra gli undici pixel. Quell'ultimo controllo mancava, ed
e' per questo che il difetto dei fumetti sovrapposti e' sopravvissuto a
tre giri di correzioni: la pagina si caricava, i test passavano, e il
tasto "Guarda" del Copywriter stava sotto il fumetto del Grafico.

Le schermate finiscono qui accanto. Serve Playwright (`require('playwright')`).

## Le finte vanno tenute uguali al vero

Due volte su tre, la prima cosa che il banco ha trovato era un difetto
**della finta**, non del codice: `posaDi` che restituiva una posa che non
esiste, e `riepilogo` con le chiavi sbagliate, che l'interfaccia non legge.
Una finta che si comporta diversamente fa perdere tempo su difetti
inventati e nasconde quelli veri.

Poi ci sono ricascato due volte ancora: `toccaATe` senza titolo ne' azione
— e la tessera usciva senza titolo e con un tasto senza scritta, che
sembrava un difetto della pagina — e `riepilogo` di nuovo, dopo che il
vero aveva cambiato il modo di contare.

Quando `js/regia-dati.js` cambia una di queste, va cambiata anche qui:
`posaDi`, `lavoroVivoDi`, `riepilogo`, `toccaATe`, `accountCollegati`,
`piattaformeImposta`, e la forma di `stato` e di un contenuto.
Le posizioni e le zone degli agenti sono copiate da `smm_agents`: senza,
finiscono tutti nello stesso punto e la stanza sembra un grappolo.
