-- Reversa 20261124_smm_drive_import.sql
do $$ begin perform cron.unschedule('smm-drive-import'); exception when others then null; end $$;

drop function if exists smm_sveglia_drive_import();
drop function if exists smm_pubblica_ora(uuid);

drop index if exists smm_media_drive_file_idx;
alter table smm_media drop column if exists drive_file_id;

-- Ripristina il trigger originale (senza il check sul video).
create or replace function smm_monta_quando_pronto() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  quante int;
begin
  if new.stato <> 'da_approvare' or coalesce(old.stato,'') = 'da_approvare' then
    return new;
  end if;
  quante := case jsonb_typeof(new.slides)
              when 'array'  then jsonb_array_length(new.slides)
              when 'object' then 1
              else 0
            end;
  if quante = 0 then return new; end if;
  if exists (select 1 from smm_media m
              where m.content_id = new.id and m.ruolo = 'derivato') then
    return new;
  end if;
  if exists (select 1 from smm_jobs j
              where j.content_id = new.id and j.tipo = 'montaggio'
                and j.stato in ('in_coda','in_corso')) then
    return new;
  end if;
  insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
  values (new.brand_id, new.id, 'montaggio',
          'Preparare i file di: ' || new.titolo,
          'Rendere le slide in immagini o video, pronte per la pubblicazione.',
          jsonb_build_object('formato',
            case new.tipo when 'reel' then 'reel'
                          when 'storia' then 'storia'
                          else 'carosello' end),
          75);
  return new;
end $$;
