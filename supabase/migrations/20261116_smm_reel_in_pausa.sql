-- ═══════════════════════════════════════════════════════════════════════
--  La decisione del 16 novembre 2026: i reel si fermano
-- ═══════════════════════════════════════════════════════════════════════
--
-- Non e' uno schema, e' una scelta editoriale: il manager non e' contento
-- di come vengono realizzati i reel e sta valutando un altro modo di
-- produrli. Finche' non c'e', meglio niente reel che reel mediocri.
--
-- Sta in un file suo e il banco di prova non lo rigioca, perche' un
-- ambiente nuovo non deve nascere coi reel spenti per sempre: il
-- meccanismo che li ferma e' in 20261116_smm_tipi_fermi.sql, questa e'
-- solo la posizione dell'interruttore oggi.
--
-- Quattro cose, e sono tutte reversibili con un tasto dalla Direzione:
--
--   1. i reel non prendono una data e non escono (tipi_fermi);
--   2. la riga di piano dei reel va in pausa, cosi' il Direttore non
--      lancia lavori per coprirla e i reel non risultano "mancanti";
--   3. l'agente Video si spegne: e' chi li monta;
--   4. i caroselli escono martedi', giovedi' e sabato — gli altri giorni
--      restano liberi per i reel, quando torneranno.
--
-- Il reel che era gia' in calendario torna indietro senza data. Non si
-- butta: quando i reel ripartono e' li' dov'era.
--
-- Reversibile: 20261116_smm_reel_in_pausa_down.sql.

update smm_settings
   set tipi_fermi = array['reel'], updated_at = now()
 where brand_id in (select id from smm_brands);

update smm_piano set attivo = false, updated_at = now()
 where tipo = 'reel';

update smm_piano set giorni = array[2,4,6], updated_at = now()
 where tipo = 'carosello';

update smm_agents set attivo = false, updated_at = now()
 where slug = 'video';

-- Il trigger non lo riprogramma: viene da "in_calendario", e quello e'
-- il caso in cui il manager sta togliendo qualcosa dal calendario apposta.
update smm_contents
   set stato = 'approvato', slot_at = null
 where tipo = 'reel' and stato in ('in_calendario', 'programmato')
   and pubblicato_at is null;
