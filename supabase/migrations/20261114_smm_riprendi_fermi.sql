-- ═══════════════════════════════════════════════════════════════════════
--  Un contenuto che nessuno ha passato avanti non resta li' per sempre
-- ═══════════════════════════════════════════════════════════════════════
--
-- La catena fra agenti la muovono gli agenti stessi, con coinvolgi_agente:
-- il Copywriter scrive e passa al Revisore, il Revisore controlla e il
-- contenuto entra in approvazione. Funziona finche' il modello si ricorda
-- di chiamare lo strumento.
--
-- Stasera non se l'e' ricordato. Sui primi due reel il Copywriter ha
-- scritto sei slide buone e ha chiuso dicendo "ora serve il controllo del
-- Revisore" — scritto nel messaggio al manager, non fatto. I due contenuti
-- sono rimasti in lavorazione, senza un lavoro aperto, senza un errore da
-- nessuna parte. Dalla Regia si vede "tutto fermo", che e' la cosa che
-- somiglia di piu' a "non funziona" pur essendo tutto a posto.
--
-- Questo non e' un presidio come quelli dei trigger: non impedisce niente,
-- rimette solo in moto. Per questo puo' stare in una funzione chiamata dal
-- cron invece che in un trigger.
--
-- Cosa NON fa, di proposito:
--   - non tocca i contenuti senza slide: li' il lavoro non e' finito, e
--     insistere vorrebbe dire pagare un agente per rifare quello che sta
--     gia' facendo;
--   - non riprende due volte lo stesso contenuto nella stessa giornata,
--     perche' un contenuto che si rompe davvero non deve diventare una
--     spesa ricorrente;
--   - non scavalca l'interruttore generale ne' gli agenti spenti.
--
-- Reversibile: 20261114_smm_riprendi_fermi_down.sql.

create or replace function smm_riprendi_fermi() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  with fermi as (
    select c.id, c.brand_id, c.titolo,
           (select a.id from smm_agents a
             where a.brand_id = c.brand_id and a.slug = 'revisore'
               and a.attivo) as revisore
      from smm_contents c
      join smm_settings s on s.brand_id = c.brand_id and not s.stop_tutto
     where c.stato = 'in_lavorazione'
       and not c.revisore_ok
       -- Le slide ci sono: chi scrive ha finito.
       and jsonb_typeof(c.slides) = 'array'
       and jsonb_array_length(c.slides) > 0
       -- Fermo davvero, non solo fra un lavoro e l'altro.
       and c.updated_at < now() - interval '10 minutes'
       and not exists (
         select 1 from smm_jobs j
          where j.content_id = c.id
            and j.stato in ('in_coda', 'in_corso', 'attesa_risposta'))
       -- E non l'ho gia' ripreso oggi.
       and not exists (
         select 1 from smm_jobs j
          where j.content_id = c.id
            and j.titolo = 'Ripresa: controllo di conformita'
            and j.created_at > now() - interval '20 hours')
  )
  insert into smm_jobs (brand_id, agent_id, content_id, tipo, titolo, richiesta, priorita)
  select f.brand_id, f.revisore, f.id, 'agente',
         'Ripresa: controllo di conformita',
         'Le slide di questo contenuto sono pronte da un po'' e nessuno te l''ha '
         || 'passato: il passaggio si e'' perso per strada. Controllalo adesso — '
         || 'dati, termini vietati, qualifica professionale — e se e'' a posto '
         || 'fallo entrare in approvazione.',
         55
    from fermi f
   where f.revisore is not null;

  get diagnostics n = row_count;
  return n;
end $$;

comment on function smm_riprendi_fermi() is
  'Rimette in moto i contenuti con le slide pronte che nessuno ha passato al Revisore. Non impedisce niente: riprende e basta.';

grant execute on function smm_riprendi_fermi() to service_role;

-- Ogni dieci minuti, a un minuto qualunque invece che in punto, dove si
-- accalcano tutti.
do $$ begin perform cron.unschedule('smm-fermi'); exception when others then null; end $$;
select cron.schedule('smm-fermi', '7,17,27,37,47,57 * * * *', $$select smm_riprendi_fermi()$$);
