-- Annulla 20261112_smm_knowledge_intera.sql: i topic tornano alla riga di
-- sintesi che avevano, cioe' il titolo soltanto. Non si cancellano, perche'
-- erano gia' li' prima e qualcuno potrebbe averli citati in una nota.

update smm_brain
   set testo = split_part(testo, E'\n', 1),
       fonte = 'social-manager/lib/knowledge.ts',
       peso = 60,
       updated_at = now()
 where codice like 'S-KB-%';
