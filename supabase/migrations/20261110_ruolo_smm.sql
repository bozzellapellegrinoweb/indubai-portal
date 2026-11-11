-- ============================================================
-- Il ruolo del social media manager
-- ============================================================
-- Sta in un file suo perche' Postgres non permette di *usare* un valore di
-- enum appena aggiunto nella stessa transazione che lo aggiunge. Tutto il
-- resto della Regia sta in 20261110_smm_regia.sql e confronta il ruolo come
-- testo (p.role::text), quindi non dipende da questo ordine: ma la creazione
-- di un utente con ruolo 'smm' da /users.html si', e senza questa riga
-- fallirebbe con un errore di enum (22P02).
--
-- Reversibile solo in parte: Postgres non sa togliere un valore da un enum.
-- Per annullare si ricrea il tipo, e lo fa 20261110_smm_regia_down.sql solo
-- se nessun profilo usa il ruolo.
-- ============================================================

alter type user_role add value if not exists 'smm';
