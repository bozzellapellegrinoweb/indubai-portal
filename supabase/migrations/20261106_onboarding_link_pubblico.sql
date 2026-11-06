-- ============================================================
-- Onboarding testamento su link aperto: il cliente nasce dopo
-- ============================================================
-- Prima la raccolta dati pretendeva un accesso al portale gia' collegato a
-- una scheda cliente: chi apriva il link senza quell'accesso leggeva "Il tuo
-- accesso non e' collegato a nessuna scheda cliente". Ma al momento in cui si
-- manda il link il cliente nel portale spesso non c'e' ancora.
--
-- Ora il link si apre senza entrare da nessuna parte, e la scheda cliente
-- viene creata all'invio, con i dati del modulo.
--
-- Chi non ha un accesso non puo' pero' avere permessi sulle tabelle: tutto
-- passa da tre funzioni SECURITY DEFINER, le uniche cose che 'anon' puo'
-- chiamare. La chiave e' un token casuale nell'indirizzo: chi non ce l'ha
-- non vede e non scrive niente, e le funzioni lavorano solo su righe ancora
-- in bozza.
-- ============================================================

-- ── La riga puo' esistere prima del cliente ─────────────────
alter table will_onboardings alter column client_id drop not null;

alter table will_onboardings
  add column if not exists token uuid not null default gen_random_uuid();

create unique index if not exists will_onboardings_token_key
  on will_onboardings (token);

-- Da dove arriva la compilazione: 'studio' (attivata dalla scheda cliente,
-- come prima) oppure 'link' (il cliente ha aperto il link pubblico).
alter table will_onboardings
  add column if not exists origine text not null default 'studio';

do $$ begin
  alter table will_onboardings add constraint will_onboardings_origine_check
    check (origine in ('studio','link'));
exception when duplicate_object then null; end $$;

comment on column will_onboardings.token is
  'Chiave del link pubblico. Chi ce l''ha puo'' compilare quella raccolta e solo quella.';
comment on column will_onboardings.origine is
  'studio = attivata dalla scheda cliente; link = aperta dal cliente sul link pubblico.';

-- ── 1. Apertura: legge la bozza di quel token ───────────────
-- Non crea niente: una visita che non scrive nulla non lascia righe.
create or replace function will_onboarding_apri(p_token uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
           'trovata', true,
           'status',  w.status,
           'mirror',  w.mirror,
           'payload', coalesce(w.payload, '{}'::jsonb))
    from will_onboardings w
   where w.token = p_token;
$$;

-- ── 2. Salvataggio della bozza ──────────────────────────────
-- Crea la riga al primo salvataggio, poi aggiorna. Una raccolta gia'
-- inviata non si tocca piu': torna false e il modulo lo dice.
create or replace function will_onboarding_salva(
  p_token uuid, p_payload jsonb, p_mirror boolean default false)
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare v_stato text;
begin
  if p_token is null then return false; end if;

  select status into v_stato from will_onboardings where token = p_token;

  if v_stato is null then
    insert into will_onboardings (token, client_id, status, origine, payload, mirror)
    values (p_token, null, 'draft', 'link', coalesce(p_payload, '{}'::jsonb), coalesce(p_mirror, false));
    return true;
  end if;

  if v_stato <> 'draft' then return false; end if;

  update will_onboardings
     set payload = coalesce(p_payload, payload),
         mirror  = coalesce(p_mirror, mirror)
   where token = p_token;
  return true;
end $$;

-- ── 3. Invio: qui nasce la scheda cliente ───────────────────
-- Se la raccolta era stata attivata dallo studio il cliente c'e' gia' e si
-- lascia com'e'. Se arriva dal link, la scheda viene creata adesso, segnata
-- come non attiva: e' un contatto che avete appena conosciuto, non un
-- cliente in gestione, e lo attivate voi dopo aver controllato.
create or replace function will_onboarding_invia(
  p_token   uuid,
  p_payload jsonb,
  p_scheda  text,
  p_mirror  boolean default false,
  p_nome    text default null,
  p_email   text default null,
  p_allegati jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  w          will_onboardings%rowtype;
  v_client   uuid;
  v_nome     text := nullif(btrim(coalesce(p_nome, '')), '');
  f          jsonb;
begin
  select * into w from will_onboardings where token = p_token;
  if not found          then return jsonb_build_object('ok', false, 'motivo', 'sconosciuta'); end if;
  if w.status <> 'draft' then return jsonb_build_object('ok', false, 'motivo', 'gia_inviata'); end if;

  v_client := w.client_id;

  if v_client is null then
    insert into clients (company_name, contact_name, email, is_active, notes)
    values (coalesce(v_nome, 'Testamento — da identificare'),
            v_nome,
            nullif(btrim(coalesce(p_email, '')), ''),
            false,
            'Scheda creata dall''invio del modulo Onboarding Testamento.')
    returning id into v_client;
  end if;

  update will_onboardings
     set client_id   = v_client,
         status      = 'submitted',
         payload     = coalesce(p_payload, payload),
         scheda_text = p_scheda,
         mirror      = coalesce(p_mirror, mirror),
         inviato_il  = now()
   where token = p_token;

  -- I file erano stati caricati sotto onboarding/<token>/, quando il cliente
  -- non esisteva ancora. Adesso che esiste li si registra fra i suoi
  -- documenti, cosi' si trovano anche dalla scheda Documenti.
  for f in select * from jsonb_array_elements(coalesce(p_allegati, '[]'::jsonb)) loop
    if coalesce(f->>'path', '') <> '' then
      insert into client_files (client_id, storage_path, display_name, original_name,
                                file_size, mime_type, folder)
      values (v_client, f->>'path', coalesce(f->>'nome', 'documento'),
              coalesce(f->>'nome', 'documento'),
              coalesce((f->>'dim')::bigint, 0), nullif(f->>'tipo', ''), '/Testamento')
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'client_id', v_client);
end $$;

-- ── Permessi: 'anon' puo' chiamare solo queste tre ──────────
revoke all on function will_onboarding_apri(uuid)                               from public;
revoke all on function will_onboarding_salva(uuid, jsonb, boolean)              from public;
revoke all on function will_onboarding_invia(uuid, jsonb, text, boolean, text, text, jsonb) from public;
grant execute on function will_onboarding_apri(uuid)                            to anon, authenticated;
grant execute on function will_onboarding_salva(uuid, jsonb, boolean)           to anon, authenticated;
grant execute on function will_onboarding_invia(uuid, jsonb, text, boolean, text, text, jsonb) to anon, authenticated;

-- ── Caricamento dei file senza accesso ──────────────────────
-- Solo dentro onboarding/<token>/, e solo finche' quella raccolta e' in
-- bozza: senza un token valido non si carica niente, e dopo l'invio si
-- chiude. Nessuna lettura e nessuna cancellazione per 'anon'.
drop policy if exists "onboarding_pubblico_upload" on storage.objects;
create policy "onboarding_pubblico_upload" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'onboarding'
    and exists (
      select 1 from will_onboardings w
       where w.token::text = (storage.foldername(name))[2]
         and w.status = 'draft')
  );

-- ── Correzione applicata subito dopo, in produzione ─────────
-- La policy qui sopra interrogava will_onboardings direttamente. Quella
-- sotto-query viene valutata con i permessi di chi carica, e chi non ha un
-- accesso al portale non ha nessun permesso su quella tabella: la policy
-- andava in errore invece di dare un verdetto, e OGNI caricamento falliva
-- con "permission denied for table will_onboardings". Il controllo passa da
-- una funzione SECURITY DEFINER, come le altre tre.
create or replace function will_onboarding_bozza_aperta(p_token text)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from will_onboardings w
     where w.token::text = p_token
       and w.status = 'draft');
$$;

grant execute on function will_onboarding_bozza_aperta(text) to anon, authenticated;

alter policy "onboarding_pubblico_upload" on storage.objects
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'onboarding'
    and will_onboarding_bozza_aperta((storage.foldername(name))[2])
  );
