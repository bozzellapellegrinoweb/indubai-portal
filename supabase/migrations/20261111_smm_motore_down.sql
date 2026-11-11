-- Annulla 20261111_smm_motore.sql: toglie lo strumento e la riga di coda.

update smm_agents
   set strumenti = array_remove(strumenti, 'rendi_immagini'),
       updated_at = now()
 where 'rendi_immagini' = any(strumenti);

update smm_agents
   set system_prompt = regexp_replace(
         system_prompt,
         E'\n\nQuando le slide sono finite, chiama rendi_immagini:.*$',
         '' ),
       updated_at = now()
 where system_prompt like '%rendi_immagini%';
