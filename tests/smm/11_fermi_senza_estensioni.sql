-- La stessa funzione di 20261114_smm_riprendi_fermi.sql, senza la parte di
-- pg_cron: sul banco di prova l'estensione non c'e', e quello che va
-- provato e' chi viene ripreso e chi no.
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
       and jsonb_typeof(c.slides) = 'array'
       and jsonb_array_length(c.slides) > 0
       and c.updated_at < now() - interval '10 minutes'
       and not exists (
         select 1 from smm_jobs j
          where j.content_id = c.id
            and j.stato in ('in_coda', 'in_corso', 'attesa_risposta'))
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
