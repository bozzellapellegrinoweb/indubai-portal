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
```

Le schermate finiscono qui accanto. Serve Playwright (`require('playwright')`).

## Le finte vanno tenute uguali al vero

Due volte su tre, la prima cosa che il banco ha trovato era un difetto
**della finta**, non del codice: `posaDi` che restituiva una posa che non
esiste, e `riepilogo` con le chiavi sbagliate, che l'interfaccia non legge.
Una finta che si comporta diversamente fa perdere tempo su difetti
inventati e nasconde quelli veri.

Quando `js/regia-dati.js` cambia una di queste, va cambiata anche qui:
`posaDi`, `lavoroVivoDi`, `riepilogo`, e la forma di `stato`.
Le posizioni e le zone degli agenti sono copiate da `smm_agents`: senza,
finiscono tutti nello stesso punto e la stanza sembra un grappolo.
