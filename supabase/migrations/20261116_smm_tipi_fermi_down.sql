-- Annulla 20261116_smm_tipi_fermi.sql.
--
-- Rimette le due funzioni com'erano in 20261116_smm_programma_da_solo.sql
-- e 20261113_smm_reel_e_piattaforme.sql, e toglie la colonna.
--
-- Nota: non rimette in piano i reel, non riaccende l'agente Video e non
-- ridà una data al reel tolto dal calendario. Sono decisioni editoriali,
-- e un rollback tecnico non e' il posto per prenderle al posto di qualcuno:
-- si riaccendono dalla Direzione, con un tasto.

create or replace function smm_programma_approvato() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  s             smm_settings;
  v_entra       boolean;
  v_firma_admin boolean;
begin
  v_entra := new.stato = 'approvato'
             and coalesce(old.stato, '') not in
                 ('approvato', 'in_calendario', 'programmato', 'pubblicato');
  v_firma_admin := new.stato = 'approvato'
                   and new.approvato_admin_at is not null
                   and old.approvato_admin_at is null;

  if not (v_entra or v_firma_admin) then return new; end if;
  if new.slot_at is not null then return new; end if;

  if not new.revisore_ok or new.approvato_da is null or new.approvato_at is null then
    return new;
  end if;

  select * into s from smm_settings where brand_id = new.brand_id;
  if found and s.doppia_approvazione
     and (new.sensibile or new.categoria = any(s.categorie_sensibili))
     and new.approvato_admin_da is null then
    return new;
  end if;

  new.slot_at := smm_prossimo_slot(new);
  new.stato   := 'in_calendario';
  return new;
end $$;

create or replace function smm_programmati_in_scadenza() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  with da_fare as (
    select c.id, c.brand_id, c.titolo, c.tipo, c.piattaforme
      from smm_contents c
     where c.stato in ('in_calendario', 'programmato')
       and c.slot_at is not null
       and c.slot_at <= now()
       and c.pubblicato_at is null
       and c.revisore_ok
       and c.approvato_da is not null
       and not exists (
         select 1 from smm_jobs j
          where j.content_id = c.id
            and j.tipo = 'pubblicazione'
            and j.stato in ('in_coda', 'in_corso'))
  )
  insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
  select d.brand_id, d.id, 'pubblicazione',
         'Uscita programmata',
         'E'' arrivata l''ora di uscita di: ' || d.titolo,
         jsonb_build_object(
           'piattaforme',
             case when coalesce(array_length(d.piattaforme, 1), 0) > 0
                  then d.piattaforme
                  else smm_piattaforme_predefinite(d.tipo) end,
           'formato', case d.tipo when 'reel' then 'reel'
                                  when 'storia' then 'storia'
                                  else 'carosello' end),
         90
    from da_fare d;

  get diagnostics n = row_count;
  return n;
end $$;

alter table smm_settings drop column if exists tipi_fermi;
