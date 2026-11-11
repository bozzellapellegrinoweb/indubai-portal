-- ============================================================
-- Il generatore diventa un motore: lo strumento per usarlo
-- ============================================================
-- Il progetto che generava i post non e' piu' un posto dove si va: e' il
-- motore che la Regia chiama per rendere i caroselli in immagini e montare
-- i reel e le storie in video. Qui si da' lo strumento a chi fa quel
-- mestiere.
--
-- Il Grafico impagina e poi rende. Il Video monta. Il Copywriter no: scrive
-- i testi, e un rendering lanciato da chi non guarda il risultato e' solo
-- una spesa.
--
-- Serve che il progetto Supabase abbia due segreti, altrimenti la funzione
-- smm-render lo dice e non prova nemmeno:
--   REGIA_RENDER_URL  l'indirizzo dell'endpoint del generatore
--   REGIA_SECRET      lo stesso segreto impostato sul generatore
-- ============================================================

update smm_agents
   set strumenti = (
         select array_agg(distinct s order by s)
           from unnest(strumenti || array['rendi_immagini']) s
       ),
       updated_at = now()
 where slug in ('grafico', 'video')
   and not ('rendi_immagini' = any(strumenti));

-- Il Grafico deve sapere che il passaggio esiste, altrimenti impagina e si
-- ferma li'. Una riga sola in coda al suo prompt: il resto del mestiere e'
-- gia' scritto e non lo tocco.
update smm_agents
   set system_prompt = system_prompt || E'\n\nQuando le slide sono finite, chiama rendi_immagini: '
       || 'finche'' non esistono i file veri il contenuto non si puo'' pubblicare. '
       || 'Non chiamarlo a meta'' lavoro, perche'' ogni chiamata rifa'' tutto da capo.',
       updated_at = now()
 where slug in ('grafico', 'video')
   and system_prompt not like '%rendi_immagini%';
