-- ============================================================
-- Intake da Drive e Pubblica ora
-- ============================================================
-- Un reel con voiceover nasce fuori dalla Regia: lo monta una routine
-- esterna, che mette il video finito in una cartella di Google Drive.
-- Il portale lo trova da solo, lo carica su Cloudinary, lo aggancia
-- alla scheda giusta e lo mette in approvazione.
--
-- Il pulsante "Pubblica ora" serve al manager che ha gia' approvato un
-- contenuto e vuole farlo uscire subito, senza aspettare lo slot del
-- piano. Non scavalca nessun presidio: revisore_ok e approvato_da
-- devono esserci, e la pubblicazione passa per il worker come tutte le
-- altre.
--
-- Reversibile: 20261124_smm_drive_import_down.sql.
-- ============================================================

-- ── 1. Idempotenza: l'id del file Drive sta su smm_media ──────────────
-- Un file importato una volta non si importa di nuovo. L'id e' quello
-- di Google Drive, non il path di Cloudinary: se qualcuno ricaria lo
-- stesso mp4 con un nome diverso, l'id resta quello e non si duplica.
alter table smm_media
  add column if not exists drive_file_id text;

create unique index if not exists smm_media_drive_file_idx
  on smm_media(drive_file_id) where drive_file_id is not null;

-- ── 2. Il montaggio salta i reel che hanno gia' un video ──────────────
-- Il trigger originale guarda ruolo = 'derivato'. Un reel arrivato da
-- Drive ha gia' il video finito, e il montaggio lo sovrascriverebbe.
-- La condizione diventa: se c'e' gia' un media video per questo
-- contenuto, in qualunque ruolo, non si monta niente.
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
  if quante = 0 then
    return new;
  end if;

  -- Ha gia' i file derivati: non si rifa'.
  if exists (select 1 from smm_media m
              where m.content_id = new.id and m.ruolo = 'derivato') then
    return new;
  end if;

  -- Ha gia' un video (da Drive o da altra fonte): non si monta.
  if exists (select 1 from smm_media m
              where m.content_id = new.id
                and m.mime like 'video/%') then
    return new;
  end if;

  -- Gia' in coda o in corso: non si duplica.
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

comment on function smm_monta_quando_pronto() is
  'Quando un contenuto entra in approvazione senza file, mette in coda il montaggio. Salta se c''e'' gia'' un video (anche da Drive).';

-- ── 3. Pubblica ora ───────────────────────────────────────────────────
-- Chi lo chiama deve avere la Regia concessa. La funzione non tocca
-- i trigger di approvazione: controlla revisore_ok e approvato_da,
-- e se manca qualcosa dice cosa manca.
create or replace function smm_pubblica_ora(p_content uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  c     smm_contents;
  v_ora timestamptz := now();
begin
  -- Chi preme deve avere la Regia.
  if not can_see_smm() then
    return jsonb_build_object('ok', false,
      'errore', 'La Regia non e'' fra le pagine che ti sono state concesse.');
  end if;

  select * into c from smm_contents where id = p_content;
  if not found then
    return jsonb_build_object('ok', false, 'errore', 'Contenuto non trovato.');
  end if;

  if c.stato = 'pubblicato' then
    return jsonb_build_object('ok', true,
      'messaggio', 'Questo contenuto era gia'' pubblicato.');
  end if;

  -- Non scavalca i presidi: dice cosa manca.
  if not c.revisore_ok then
    return jsonb_build_object('ok', false,
      'errore', 'Il Revisore di conformita'' non ha ancora passato questo contenuto.');
  end if;
  if c.approvato_da is null or c.approvato_at is null then
    return jsonb_build_object('ok', false,
      'errore', 'Manca la firma del manager: approva prima, poi pubblica.');
  end if;

  -- Niente media = niente da pubblicare.
  if not exists (select 1 from smm_media m
                  where m.content_id = p_content
                    and m.cloudinary_url is not null) then
    return jsonb_build_object('ok', false,
      'errore', 'Non c''e'' nessun file pronto con un indirizzo pubblico.');
  end if;

  -- Non duplicare un lavoro gia' in coda o in corso.
  if exists (select 1 from smm_jobs j
              where j.content_id = p_content and j.tipo = 'pubblicazione'
                and j.stato in ('in_coda', 'in_corso')) then
    return jsonb_build_object('ok', true,
      'messaggio', 'La pubblicazione e'' gia'' in coda: esce a momenti.');
  end if;

  -- slot_at a ora, in_calendario, e lavoro con priorita' alta.
  update smm_contents
     set slot_at = v_ora, stato = 'in_calendario'
   where id = p_content
     and stato in ('approvato', 'in_calendario', 'programmato');

  insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
  values (c.brand_id, p_content, 'pubblicazione',
          'Pubblica ora: ' || c.titolo,
          'Il manager ha chiesto di pubblicare subito.',
          jsonb_build_object(
            'piattaforme', c.piattaforme,
            'formato', case c.tipo when 'reel' then 'reel'
                                   when 'storia' then 'storia'
                                   else 'carosello' end),
          95);

  return jsonb_build_object('ok', true,
    'messaggio', 'Messo in coda con priorita'' alta: esce a momenti.');
end $$;

comment on function smm_pubblica_ora(uuid) is
  'Il manager vuole che esca subito. Verifica revisore_ok e approvato_da, mette slot_at a ora e crea il lavoro di pubblicazione con priorita'' 95.';

grant execute on function smm_pubblica_ora(uuid) to authenticated;

-- ── 4. Cron intake da Drive ───────────────────────────────────────────
-- Ogni 10 minuti chiama la rotta Vercel del social manager. Il segreto
-- e il base URL stanno nel Vault come quelli del worker.
create or replace function smm_sveglia_drive_import() returns void
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_url     text;
  v_segreto text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'smm_drive_import_url';
  select decrypted_secret into v_segreto
    from vault.decrypted_secrets where name = 'smm_regia_secret';

  if v_url is null or v_segreto is null then
    raise notice 'smm_sveglia_drive_import: manca smm_drive_import_url o smm_regia_secret in Vault.';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-regia-secret', v_segreto),
    body    := jsonb_build_object('origine', 'pg_cron'),
    timeout_milliseconds := 120000
  );
end $$;

comment on function smm_sveglia_drive_import() is
  'Chiama la rotta Vercel di intake da Drive ogni 10 minuti.';

do $$
begin
  perform cron.unschedule('smm-drive-import');
exception when others then null;
end $$;

select cron.schedule('smm-drive-import', '*/10 * * * *',
                     $$select smm_sveglia_drive_import()$$);

grant execute on function smm_sveglia_drive_import() to service_role;
