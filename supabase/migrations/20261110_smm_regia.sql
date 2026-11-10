-- ============================================================
-- La Regia SMM — dati, permessi, presidi
-- ============================================================
-- Una sezione del portale in cui lavorano agenti AI e il social media manager
-- li dirige, approva e corregge.
--
-- Tre cose che valgono per tutto il file:
--
-- 1. brand_id sta su ogni tabella. Oggi c'e' un solo brand (InDubai), ma
--    KeyPrime si aggiunge con una riga in smm_brands e nessuna modifica di
--    schema. Senza questo campo da subito, aggiungerlo dopo vorrebbe dire
--    riscrivere ogni policy e ogni query.
--
-- 2. I presidi stanno nel database, non nell'interfaccia. "Non si pubblica
--    senza approvazione" e "non si va in approvazione senza il Revisore" sono
--    trigger, non controlli in JavaScript: valgono su qualunque percorso di
--    scrittura, API REST compresa.
--
-- 3. Il perimetro di chi legge e scrive e' can_see_smm(), costruita sul
--    modello di can_see_wills() (20261106_permesso_testamento.sql): legge la
--    matrice permessi di /users.html dentro la policy RLS, con fallback ai
--    predefiniti del ruolo. Nascondere la pagina non basta, i dati
--    arriverebbero comunque al browser.
-- ============================================================

create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ============================================================
-- 1. Chi vede la Regia
-- ============================================================

-- I ruoli che hanno la Regia quando per il ruolo non c'e' ancora una
-- configurazione salvata in role_permissions. Rispecchia ROLE_PAGES_DEFAULT
-- in js/app.js: va tenuto allineato a mano, come wills_default_roles().
create or replace function smm_default_roles() returns text[]
language sql immutable as $$ select array['smm'] $$;

comment on function smm_default_roles() is
  'Ruoli che partono con la Regia concessa. Allineato a ROLE_PAGES_DEFAULT in js/app.js.';

create or replace function can_see_smm() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case
      when p.role = 'admin' then true          -- come _getAllowed in js/app.js
      else coalesce(
        (select array_length(rp.allowed_pages, 1) is null   -- array vuoto = tutte
                or 'regia' = any(rp.allowed_pages)
           from role_permissions rp
          where rp.role = p.role::text),
        p.role::text = any(smm_default_roles()))
    end
    from profiles p
    where p.id = auth.uid()
  ), false);
$$;

comment on function can_see_smm() is
  'Vero se il ruolo di chi chiama ha la pagina "regia" nella matrice permessi. L''admin sempre.';

-- Solo l'admin: serve al secondo livello di approvazione sulle categorie
-- sensibili e alle impostazioni di spesa.
-- is_portal_admin() esiste gia' (20261016_permessi_utenti.sql).

-- ============================================================
-- 2. Brand
-- ============================================================

create table if not exists smm_brands (
  id          uuid primary key default uuid_generate_v4(),
  slug        text not null unique,
  nome        text not null,
  accent      text not null default '#b5ff00',
  bg_dark     text not null default '#0d0d1a',
  sito        text,
  cta_default text,
  hashtags    text[] not null default '{}',
  attivo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 3. Agenti — dati, non codice
-- ============================================================
-- Gli agenti sono righe: se ne aggiungono dall'interfaccia senza un rilascio.
-- zona = dove sta la scrivania nella scena 3D.

create table if not exists smm_agents (
  id            uuid primary key default uuid_generate_v4(),
  brand_id      uuid not null references smm_brands(id) on delete cascade,
  slug          text not null,
  nome          text not null,
  ruolo         text not null,                 -- "Copywriter", mostrato all'utente
  descrizione   text,                          -- cosa fa, in italiano semplice
  zona          text not null default 'studio'
                check (zona in ('direzione','studio','montaggio','uscita','revisione','cervello')),
  system_prompt text not null,
  model         text not null default 'claude-opus-5-5',
  max_tokens    int  not null default 16000,
  strumenti     text[] not null default '{cervello_cerca,contenuto_leggi}',
  colore        text not null default '#47ee74',
  avatar        jsonb not null default '{}'::jsonb,   -- pelle, capelli, vestito
  posizione     jsonb not null default '{}'::jsonb,   -- {x, z, rot} nella scena
  attivo        boolean not null default true,
  ordine        int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (brand_id, slug)
);

-- ============================================================
-- 4. Contenuti
-- ============================================================

create table if not exists smm_contents (
  id              uuid primary key default uuid_generate_v4(),
  brand_id        uuid not null references smm_brands(id) on delete cascade,
  titolo          text not null,
  tipo            text not null default 'carosello'
                  check (tipo in ('carosello','reel','storia','post')),
  stato           text not null default 'idea'
                  check (stato in ('idea','in_lavorazione','da_revisione','respinto',
                                   'da_approvare','approvato','in_calendario',
                                   'programmato','pubblicato')),
  brief           text,
  pillar          text,
  categoria       text,
  sensibile       boolean not null default false,
  caption         text,
  hashtags        text[] not null default '{}',
  slides          jsonb not null default '[]'::jsonb,
  piattaforme     text[] not null default '{instagram,facebook}',

  -- Revisore di conformita'
  revisore_ok     boolean not null default false,
  revisore_note   jsonb,                       -- [{testo, correzione, severita}]
  revisore_at     timestamptz,

  -- Approvazione del manager
  approvato_da    uuid references profiles(id),
  approvato_at    timestamptz,

  -- Secondo livello, opzionale, per l'admin sulle categorie sensibili
  approvato_admin_da uuid references profiles(id),
  approvato_admin_at timestamptz,

  -- Calendario e pubblicazione
  slot_at         timestamptz,
  programmato_at  timestamptz,
  pubblicato_at   timestamptz,
  ghl_post_id     text,
  errore_pubblicazione text,

  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists smm_contents_brand_stato_idx on smm_contents(brand_id, stato);
create index if not exists smm_contents_slot_idx        on smm_contents(brand_id, slot_at)
  where slot_at is not null;

-- ── Versioni confrontabili (Round 1 contro Round 7) ─────────
create table if not exists smm_content_versions (
  id         uuid primary key default uuid_generate_v4(),
  content_id uuid not null references smm_contents(id) on delete cascade,
  round      int  not null,
  agent_id   uuid references smm_agents(id) on delete set null,
  caption    text,
  slides     jsonb not null default '[]'::jsonb,
  media      jsonb not null default '[]'::jsonb,
  sintesi    text,                              -- "cosa e' cambiato", in italiano
  created_at timestamptz not null default now(),
  unique (content_id, round)
);

-- ── Note agganciate a un punto preciso ──────────────────────
-- ancora: {"tipo":"video","secondo":12.4} oppure {"tipo":"slide","slide":3}
-- oppure {"tipo":"testo","da":120,"a":168}
create table if not exists smm_notes (
  id          uuid primary key default uuid_generate_v4(),
  content_id  uuid not null references smm_contents(id) on delete cascade,
  version_id  uuid references smm_content_versions(id) on delete set null,
  autore      uuid references profiles(id),
  autore_agent_id uuid references smm_agents(id) on delete set null,
  ancora      jsonb not null default '{"tipo":"generale"}'::jsonb,
  testo       text not null,
  risolta     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists smm_notes_content_idx on smm_notes(content_id, created_at desc);

-- ============================================================
-- 5. Il Cervello condiviso
-- ============================================================
-- tipo: regola    = vincolante, il Revisore la applica
--       nota      = correzione del manager, generalizzata
--       studio    = analisi di una reference, knowledge base
--       design    = specifica visiva
--
-- confermata: le note nate da una revisione partono false e il manager le
-- conferma con un tasto. Una regola seed nasce confermata.

create table if not exists smm_brain (
  id            uuid primary key default uuid_generate_v4(),
  brand_id      uuid not null references smm_brands(id) on delete cascade,
  tipo          text not null check (tipo in ('regola','nota','studio','design')),
  codice        text,                           -- R-QUAL-02, stabile e citabile
  testo         text not null,
  fonte         text,                            -- da dove viene
  tags          text[] not null default '{}',
  peso          int  not null default 50,        -- 0-100, pesa nella ricerca
  vincolante    boolean not null default false,  -- il Revisore blocca se violata
  attivo        boolean not null default true,
  confermata    boolean not null default true,
  origine_note_id uuid references smm_notes(id) on delete set null,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Indice di ricerca. to_tsvector con la configurazione scritta come
  -- letterale e' IMMUTABLE, quindi si puo' usare in una colonna generata.
  -- Due dettagli, entrambi scoperti provando la migrazione su un Postgres
  -- vero invece di fidarsi:
  --
  -- 'italian'::regconfig e non 'italian'. Con il letterale di testo
  -- to_tsvector e' STABLE, non IMMUTABLE, perche' la risoluzione del nome
  -- della configurazione dipende dal search_path, e una colonna generata
  -- accetta solo espressioni immutabili.
  --
  -- I tag non stanno qui dentro: array_to_string e' STABLE a sua volta
  -- (dipende dalle funzioni di output del tipo), quindi li cerca la
  -- funzione, con l'indice GIN qui sotto.
  ricerca tsvector generated always as (
    to_tsvector('italian'::regconfig,
      coalesce(codice,'') || ' ' || coalesce(testo,'') || ' ' || coalesce(fonte,''))
  ) stored
);

create index if not exists smm_brain_ricerca_idx on smm_brain using gin(ricerca);
create index if not exists smm_brain_trgm_idx    on smm_brain using gin(testo extensions.gin_trgm_ops);
create index if not exists smm_brain_brand_idx   on smm_brain(brand_id, tipo, attivo);
create index if not exists smm_brain_tags_idx     on smm_brain using gin(tags);
create unique index if not exists smm_brain_codice_idx on smm_brain(brand_id, codice)
  where codice is not null;

-- ── Ricerca per rilevanza ───────────────────────────────────
-- Gli agenti NON caricano tutto il Cervello in contesto: cercano. Le regole
-- vincolanti arrivano sempre, perche' un Revisore che non vede la regola sui
-- termini vietati non serve a niente.
create or replace function smm_cervello_cerca(
  p_brand   uuid,
  p_query   text default null,
  p_tipi    text[] default null,
  p_limite  int default 12
) returns table (
  id uuid, tipo text, codice text, testo text, fonte text,
  tags text[], peso int, vincolante boolean, rilevanza real
)
language sql stable security definer set search_path to 'public', 'extensions' as $$
  with q as (
    select case when coalesce(trim(p_query),'') = '' then null
                else websearch_to_tsquery('italian', p_query) end as ts,
           coalesce(trim(p_query),'') as raw
  )
  select b.id, b.tipo, b.codice, b.testo, b.fonte, b.tags, b.peso, b.vincolante,
         (
           case when q.ts is null then 0
                else ts_rank_cd(b.ricerca, q.ts) * 10 end
           + case when q.raw = '' then 0
                  else similarity(b.testo, q.raw) * 2 end
           + case when q.raw <> '' and exists (
                    select 1 from unnest(b.tags) g
                     where g ilike '%' || q.raw || '%' or q.raw ilike '%' || g || '%')
                  then 3 else 0 end
           + b.peso / 100.0
           + case when b.vincolante then 5 else 0 end
         )::real as rilevanza
    from smm_brain b, q
   where b.brand_id = p_brand
     and b.attivo
     and b.confermata
     and (p_tipi is null or b.tipo = any(p_tipi))
     and (
       q.ts is null
       or b.vincolante                        -- le vincolanti arrivano sempre
       or b.ricerca @@ q.ts
       or similarity(b.testo, q.raw) > 0.18
       or exists (select 1 from unnest(b.tags) g
                   where g ilike '%' || q.raw || '%')
     )
   order by rilevanza desc, b.peso desc
   limit greatest(1, least(coalesce(p_limite, 12), 80));
$$;

comment on function smm_cervello_cerca is
  'Recupero dal Cervello per rilevanza. Le regole vincolanti sono sempre incluse.';

-- ============================================================
-- 6. La coda dei lavori
-- ============================================================

create table if not exists smm_jobs (
  id            uuid primary key default uuid_generate_v4(),
  brand_id      uuid not null references smm_brands(id) on delete cascade,
  agent_id      uuid references smm_agents(id) on delete set null,
  content_id    uuid references smm_contents(id) on delete cascade,
  parent_job_id uuid references smm_jobs(id) on delete set null,

  tipo          text not null default 'agente'
                check (tipo in ('agente','montaggio','nota_cervello','analisi','pubblicazione')),
  titolo        text not null,
  richiesta     text not null,
  payload       jsonb not null default '{}'::jsonb,

  stato         text not null default 'in_coda'
                check (stato in ('in_coda','in_corso','attesa_risposta','fatto','fallito','annullato')),
  priorita      int not null default 50,

  -- Cosa sta facendo, in italiano, per il fumetto sopra la testa
  attivita      text,
  domanda       text,                            -- se attesa_risposta
  risposta      text,
  risultato     jsonb,
  errore        text,

  -- Spesa
  token_in      int not null default 0,
  token_out     int not null default 0,
  costo_usd     numeric(10,5) not null default 0,
  tentativi     int not null default 0,

  richiesto_da  uuid references profiles(id),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists smm_jobs_coda_idx on smm_jobs(stato, priorita desc, created_at)
  where stato = 'in_coda';
create index if not exists smm_jobs_brand_idx on smm_jobs(brand_id, stato);
create index if not exists smm_jobs_agent_idx on smm_jobs(agent_id, stato);

-- ── Prendere un lavoro senza pestarsi i piedi ───────────────
-- Due worker che partono insieme (quello del browser e quello di pg_cron)
-- non devono prendere lo stesso lavoro: skip locked lo garantisce.
create or replace function smm_claim_job() returns smm_jobs
language plpgsql security definer set search_path to 'public' as $$
declare
  v_job smm_jobs;
  v_stop boolean;
begin
  -- L'interruttore generale vale per tutti i brand che l'hanno alzato
  update smm_jobs j
     set stato = 'in_corso',
         started_at = now(),
         tentativi = j.tentativi + 1,
         updated_at = now()
   where j.id = (
     select jj.id
       from smm_jobs jj
       join smm_settings s on s.brand_id = jj.brand_id
      where jj.stato = 'in_coda'
        and not s.stop_tutto
        and (s.speso_oggi_data < current_date
             or s.speso_oggi_usd < s.budget_giorno_usd)
      order by jj.priorita desc, jj.created_at
      limit 1
      for update of jj skip locked
   )
  returning j.* into v_job;

  return v_job;
end $$;

comment on function smm_claim_job() is
  'Prende un lavoro dalla coda. Rispetta l''interruttore generale e il budget giornaliero.';

-- ============================================================
-- 7. Chat con gli agenti
-- ============================================================

create table if not exists smm_messages (
  id         uuid primary key default uuid_generate_v4(),
  brand_id   uuid not null references smm_brands(id) on delete cascade,
  agent_id   uuid references smm_agents(id) on delete cascade,
  job_id     uuid references smm_jobs(id) on delete set null,
  content_id uuid references smm_contents(id) on delete set null,
  autore     text not null check (autore in ('utente','agente')),
  user_id    uuid references profiles(id),
  testo      text not null,
  created_at timestamptz not null default now()
);

create index if not exists smm_messages_agent_idx on smm_messages(agent_id, created_at desc);

-- ============================================================
-- 8. Media
-- ============================================================
-- Gli originali stanno nel bucket privato smm-media e si leggono solo con
-- link firmati a scadenza. cloudinary_url e' l'unica cosa pubblica, e c'e'
-- solo sui derivati che GHL deve poter scaricare al momento della
-- pubblicazione.

create table if not exists smm_media (
  id            uuid primary key default uuid_generate_v4(),
  brand_id      uuid not null references smm_brands(id) on delete cascade,
  content_id    uuid references smm_contents(id) on delete set null,
  originale_id  uuid references smm_media(id) on delete cascade,

  ruolo         text not null default 'originale'
                check (ruolo in ('originale','anteprima','poster','derivato','reference')),
  bucket        text not null default 'smm-media',
  path          text not null,
  nome_file     text,
  mime          text,
  bytes         bigint,
  durata_s      numeric(10,2),
  larghezza     int,
  altezza       int,
  checksum      text,

  cloudinary_url       text,
  cloudinary_public_id text,

  usato         boolean not null default false,   -- la pulizia guarda questo
  ultimo_uso_at timestamptz,
  caricato_da   uuid references profiles(id),
  created_at    timestamptz not null default now(),
  unique (bucket, path)
);

create index if not exists smm_media_content_idx  on smm_media(content_id);
create index if not exists smm_media_pulizia_idx  on smm_media(brand_id, usato, created_at)
  where ruolo in ('originale','derivato');

-- ── Pulizia dei file vecchi non usati ───────────────────────
-- Non cancella: segnala. Cancellare i byte tocca allo Storage, e lo fa la
-- edge function smm-media con action=pulizia, che legge questa vista.
create or replace view smm_media_da_pulire as
  select m.*
    from smm_media m
   where not m.usato
     and m.ruolo in ('originale','derivato')
     and m.content_id is null
     and m.created_at < now() - interval '45 days';

comment on view smm_media_da_pulire is
  'Originali e derivati non agganciati a nessun contenuto e piu'' vecchi di 45 giorni.';

-- ============================================================
-- 9. Risultati
-- ============================================================

create table if not exists smm_results (
  id             uuid primary key default uuid_generate_v4(),
  brand_id       uuid not null references smm_brands(id) on delete cascade,
  content_id     uuid references smm_contents(id) on delete cascade,
  data           date not null default current_date,
  reach          int,
  impressions    int,
  saves          int,
  clicks         int,
  likes          int,
  comments       int,
  shares         int,
  follower_delta int,
  fonte          text not null default 'manuale' check (fonte in ('manuale','ghl','stima')),
  note           text,
  created_at     timestamptz not null default now(),
  unique (content_id, data, fonte)
);

-- ============================================================
-- 10. Impostazioni per brand
-- ============================================================

create table if not exists smm_settings (
  brand_id             uuid primary key references smm_brands(id) on delete cascade,
  stop_tutto           boolean not null default false,
  budget_lavoro_usd    numeric(10,4) not null default 0.50,
  budget_giorno_usd    numeric(10,4) not null default 10.00,
  speso_oggi_usd       numeric(10,4) not null default 0,
  speso_oggi_data      date not null default current_date,
  doppia_approvazione  boolean not null default false,
  categorie_sensibili  text[] not null default '{fiscale,normativa,residenza}',
  updated_at           timestamptz not null default now()
);

comment on column smm_settings.stop_tutto is
  'Interruttore generale: a vero nessun lavoro viene preso dalla coda.';
comment on column smm_settings.doppia_approvazione is
  'A vero, i contenuti nelle categorie sensibili chiedono anche l''approvazione dell''admin.';

-- Azzeramento del contatore giornaliero: lo fa chi legge, non un cron, cosi'
-- non serve che qualcuno sia sveglio a mezzanotte di Dubai.
create or replace function smm_budget_residuo(p_brand uuid) returns numeric
language plpgsql security definer set search_path to 'public' as $$
declare s smm_settings;
begin
  select * into s from smm_settings where brand_id = p_brand;
  if not found then return 0; end if;
  if s.speso_oggi_data < current_date then
    update smm_settings set speso_oggi_usd = 0, speso_oggi_data = current_date,
           updated_at = now()
     where brand_id = p_brand;
    return s.budget_giorno_usd;
  end if;
  return greatest(0, s.budget_giorno_usd - s.speso_oggi_usd);
end $$;

-- ============================================================
-- 11. I presidi — trigger, non interfaccia
-- ============================================================

-- ── 11a. In "da_approvare" solo col via libera del Revisore ─
create or replace function smm_guard_revisore() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  -- Anche 'approvato', non solo 'da_approvare': altrimenti bastava saltare
  -- un passaggio e si approvava un contenuto che il Revisore aveva fermato.
  -- La pubblicazione restava comunque bloccata dal presidio successivo, ma
  -- il contenuto risultava approvato, che e'' una bugia sullo stato.
  if new.stato in ('da_approvare','approvato')
     and coalesce(old.stato,'') not in ('da_approvare','approvato')
     and not new.revisore_ok then
    raise exception
      'Il contenuto non puo'' andare in approvazione: il Revisore di conformita'' non lo ha ancora passato.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── 11b. Non si pubblica senza approvazione umana registrata ─
create or replace function smm_guard_pubblicazione() returns trigger
language plpgsql set search_path to 'public' as $$
declare s smm_settings;
begin
  if new.stato in ('programmato','pubblicato')
     and coalesce(old.stato,'') not in ('programmato','pubblicato') then

    if not new.revisore_ok then
      raise exception 'Non si pubblica un contenuto che il Revisore non ha passato.'
        using errcode = 'check_violation';
    end if;

    if new.approvato_da is null or new.approvato_at is null then
      raise exception 'Non si pubblica senza un''approvazione umana registrata.'
        using errcode = 'check_violation';
    end if;

    select * into s from smm_settings where brand_id = new.brand_id;
    if found and s.doppia_approvazione
       and (new.sensibile or new.categoria = any(s.categorie_sensibili))
       and new.approvato_admin_da is null then
      raise exception
        'Categoria sensibile: serve anche la seconda approvazione dell''amministratore.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- ── 11c. Chi approva non e' un agente, ed e' chi sta scrivendo ─
-- Un agente non puo' mettere la firma del manager: se arriva
-- un'approvazione, il nome e' quello di chi sta facendo la richiesta.
create or replace function smm_guard_firma_approvazione() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.approvato_da is not null
     and coalesce(old.approvato_da::text,'') <> new.approvato_da::text
     and auth.uid() is not null
     and new.approvato_da <> auth.uid() then
    raise exception 'L''approvazione va firmata da chi la sta dando.'
      using errcode = 'check_violation';
  end if;
  if new.approvato_admin_da is not null
     and coalesce(old.approvato_admin_da::text,'') <> new.approvato_admin_da::text
     and auth.uid() is not null
     and not is_portal_admin() then
    raise exception 'La seconda approvazione la da'' solo un amministratore.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── 11d. updated_at ─────────────────────────────────────────
create or replace function smm_touch() returns trigger
language plpgsql set search_path to 'public' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_smm_guard_revisore on smm_contents;
create trigger trg_smm_guard_revisore before update on smm_contents
  for each row execute function smm_guard_revisore();

drop trigger if exists trg_smm_guard_pubblicazione on smm_contents;
create trigger trg_smm_guard_pubblicazione before update on smm_contents
  for each row execute function smm_guard_pubblicazione();

drop trigger if exists trg_smm_guard_firma on smm_contents;
create trigger trg_smm_guard_firma before update on smm_contents
  for each row execute function smm_guard_firma_approvazione();

drop trigger if exists trg_smm_touch_contents on smm_contents;
create trigger trg_smm_touch_contents before update on smm_contents
  for each row execute function smm_touch();

drop trigger if exists trg_smm_touch_jobs on smm_jobs;
create trigger trg_smm_touch_jobs before update on smm_jobs
  for each row execute function smm_touch();

drop trigger if exists trg_smm_touch_agents on smm_agents;
create trigger trg_smm_touch_agents before update on smm_agents
  for each row execute function smm_touch();

-- ============================================================
-- 11e. I termini vietati li ferma anche il database
-- ============================================================
-- Il Revisore di conformita' e' un modello: ragiona, e quindi puo' sbagliare.
-- Su una cosa sola non ci si puo' permettere che sbagli, perche' non e' una
-- questione di stile ma di qualifica professionale: InDubai non e' uno studio
-- legale, e nessun contenuto pubblico puo' dire il contrario.
--
-- Quindi il controllo sui termini vietati e' scritto due volte: una nel
-- prompt del Revisore, che sa anche spiegare perche'; e una qui, che non sa
-- spiegare niente ma non si distrae. Se il modello lascia passare
-- "studio legale", il via libera non si registra.
--
-- L'elenco non e' cablato: sono le regole del Cervello con il tag
-- termini-vietati. Si allunga aggiungendo una regola, senza un rilascio.

-- Il testo si normalizza prima di cercare, perche' le forme sono tante:
-- "studio legale", "#studiolegale", "studio.legale", "Avv. Rossi".
--
-- Tutto cio' che non e' una lettera diventa uno spazio. Cosi' le forme
-- separate restano separate e la regex le prende, le forme puntate
-- diventano separate, e gli hashtag restano un unico pezzo.
--
-- Le forme attaccate si cercano poi token per token, non sul testo intero:
-- se le cercassi sul testo con gli spazi tolti, una slide con titolo
-- "Lo studio" e corpo "Legale rappresentante" diventerebbe
-- "lostudiolegalerappresentante" e verrebbe segnalata per sbaglio.
create or replace function smm_termini_vietati(p_testo text)
returns text[]
language sql immutable as $$
  with norm as (
    select regexp_replace(coalesce(p_testo, ''), '[^[:alpha:]]+', ' ', 'g') as spaziato
  ),
  separati as (
    select m[1] as trovato
      from norm, regexp_matches(norm.spaziato,
             '\m(avvocat[oiae]|consulent[ei]\s+legal[ei]|lawyer[si]?|law\s+firms?|studi[oa]\s+legal[ei]|studi\s+legali)\M',
             'gi') as m
  ),
  token as (
    select lower(t) as t
      from norm, regexp_split_to_table(norm.spaziato, '\s+') as t
     where t <> ''
  ),
  -- abbreviazioni: valgono solo come parola intera, perche' "avv" dentro
  -- un'altra parola non vuol dire niente
  abbreviazioni as (
    select token.t as trovato
      from token
     where token.t in ('avv')
  ),
  -- forme attaccate: dentro un singolo token
  attaccati as (
    select v.etichetta as trovato
      from token, (values
                ('studiolegale'),    ('studilegali'),
                ('consulentelegale'),('consulentilegali'),
                ('lawfirm'),         ('lawfirms')
              ) as v(etichetta)
     where position(v.etichetta in token.t) > 0
  )
  select coalesce(array_agg(distinct trovato), '{}')
    from (select trovato from separati
          union all select trovato from abbreviazioni
          union all select trovato from attaccati) u;
$$;

comment on function smm_termini_vietati(text) is
  'Termini che tradirebbero la qualifica professionale. Vedi R-QUAL-02 e R-QUAL-04 nel Cervello.';

-- Tutto il testo pubblico di un contenuto in un pezzo solo.
--
-- La prima versione metteva jsonb_array_elements(slides) nella FROM: con
-- slides vuoto quella funzione non restituisce nessuna riga, quindi la
-- query non restituiva nessuna riga e la funzione tornava NULL. Risultato:
-- su un contenuto senza slide il controllo sui termini vietati non
-- guardava nemmeno la caption. Il test lo ha trovato subito.
--
-- Le slide si leggono come testo intero invece di pescare campo per campo:
-- cosi' nessun campo sfugge, nemmeno dentro bullets, items o stats, e
-- nemmeno in un tipo di slide che qualcuno aggiungera' domani. Le chiavi
-- JSON (title, body, badge) finiscono nel testo, ma sono parole inglesi
-- che non assomigliano a nessun termine vietato.
create or replace function smm_testo_pubblico(p_content smm_contents)
returns text
language sql immutable as $$
  select concat_ws(' ',
    p_content.titolo,
    p_content.caption,
    array_to_string(p_content.hashtags, ' '),
    coalesce(p_content.slides, '[]'::jsonb)::text
  );
$$;

create or replace function smm_guard_termini() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_trovati text[];
begin
  -- Si controlla solo quando qualcuno prova a dare il via libera o a
  -- pubblicare: durante la scrittura una bozza puo' contenere qualsiasi cosa.
  if (new.revisore_ok and not coalesce(old.revisore_ok, false))
     or (new.stato in ('da_approvare','approvato','programmato','pubblicato')
         and coalesce(old.stato,'') <> new.stato) then

    v_trovati := smm_termini_vietati(smm_testo_pubblico(new));

    if array_length(v_trovati, 1) > 0 then
      raise exception
        'Termini vietati nel contenuto: %. InDubai non e'' uno studio legale: la qualifica corretta e'' consulente fiscale e societario. Vedi R-QUAL-02 nel Cervello.',
        array_to_string(v_trovati, ', ')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_smm_guard_termini on smm_contents;
create trigger trg_smm_guard_termini before update on smm_contents
  for each row execute function smm_guard_termini();

-- ============================================================
-- 12. Ogni correzione diventa una nota nel Cervello
-- ============================================================
-- Il manager scrive una nota in una revisione. Due cose succedono subito:
--
-- 1. la nota entra nel Cervello cosi' com'e', non confermata. Se il worker e'
--    spento o il budget e' finito, la correzione non si perde;
-- 2. parte un lavoro che la generalizza ("non dire 'studio legale' qui"
--    diventa "non usare mai 'studio legale': la qualifica e' consulente
--    aziendale") e riscrive quella stessa riga.
--
-- I duplicati li evita la similarita': se nel Cervello c'e' gia' una nota che
-- dice quasi la stessa cosa, invece di aggiungerne un'altra si alza il peso
-- di quella.
create or replace function smm_nota_nel_cervello() returns trigger
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_brand   uuid;
  v_simile  uuid;
begin
  select brand_id into v_brand from smm_contents where id = new.content_id;
  if v_brand is null then return new; end if;

  -- Una nota di un agente non e' una correzione del manager: non entra.
  if new.autore is null then return new; end if;

  select id into v_simile
    from smm_brain
   where brand_id = v_brand
     and tipo = 'nota'
     and attivo
     and similarity(testo, new.testo) > 0.55
   order by similarity(testo, new.testo) desc
   limit 1;

  if v_simile is not null then
    update smm_brain
       set peso = least(100, peso + 8), updated_at = now()
     where id = v_simile;
    return new;
  end if;

  insert into smm_brain (brand_id, tipo, testo, fonte, tags, peso,
                         confermata, origine_note_id, created_by)
  values (v_brand, 'nota', new.testo,
          'Revisione del ' || to_char(now(), 'DD/MM/YYYY'),
          array['da-revisione'], 55, false, new.id, new.autore);

  insert into smm_jobs (brand_id, tipo, titolo, richiesta, content_id,
                        payload, priorita, richiesto_da)
  values (v_brand, 'nota_cervello',
          'Generalizza una correzione',
          new.testo,
          new.content_id,
          jsonb_build_object('note_id', new.id),
          30, new.autore);

  return new;
end $$;

drop trigger if exists trg_smm_nota_cervello on smm_notes;
create trigger trg_smm_nota_cervello after insert on smm_notes
  for each row execute function smm_nota_nel_cervello();

-- ============================================================
-- 13. Log attivita'
-- ============================================================
-- Ogni scrittura importante finisce anche in activity_log, come il resto del
-- portale. SECURITY DEFINER perche' il trigger deve scrivere anche quando
-- l'azione arriva dal worker.
create or replace function smm_log_attivita() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_azione  text;
  v_dett    jsonb;
begin
  if tg_table_name = 'smm_contents' then
    if tg_op = 'INSERT' then
      v_azione := 'smm_contenuto_creato';
    elsif new.stato is distinct from old.stato then
      v_azione := 'smm_contenuto_' || new.stato;
    else
      return new;
    end if;
    v_dett := jsonb_build_object('content_id', new.id, 'titolo', new.titolo,
                                 'tipo', new.tipo, 'stato', new.stato);

  elsif tg_table_name = 'smm_jobs' then
    if tg_op = 'INSERT' then
      v_azione := 'smm_lavoro_in_coda';
    elsif new.stato is distinct from old.stato
          and new.stato in ('fatto','fallito','attesa_risposta') then
      v_azione := 'smm_lavoro_' || new.stato;
    else
      return new;
    end if;
    v_dett := jsonb_build_object('job_id', new.id, 'titolo', new.titolo,
                                 'stato', new.stato, 'costo_usd', new.costo_usd);

  elsif tg_table_name = 'smm_brain' then
    v_azione := case tg_op when 'INSERT' then 'smm_cervello_nuova_voce'
                           else 'smm_cervello_modifica' end;
    v_dett := jsonb_build_object('brain_id', new.id, 'tipo', new.tipo,
                                 'codice', new.codice, 'confermata', new.confermata);
  else
    return new;
  end if;

  insert into activity_log (user_id, action, details)
  values (coalesce(auth.uid(), new.created_by), v_azione, v_dett);
  return new;
exception when others then
  return new;   -- il log non blocca mai l'operazione
end $$;

drop trigger if exists trg_smm_log_contents on smm_contents;
create trigger trg_smm_log_contents after insert or update on smm_contents
  for each row execute function smm_log_attivita();

drop trigger if exists trg_smm_log_jobs on smm_jobs;
create trigger trg_smm_log_jobs after insert or update on smm_jobs
  for each row execute function smm_log_attivita();

drop trigger if exists trg_smm_log_brain on smm_brain;
create trigger trg_smm_log_brain after insert or update on smm_brain
  for each row execute function smm_log_attivita();

-- ============================================================
-- 14. RLS
-- ============================================================
-- Perimetro: chi ha la pagina "regia" nella matrice permessi. L'admin sempre.
-- smm_settings in lettura a tutti quelli della Regia, in scrittura solo admin:
-- il budget e l'interruttore generale non li cambia il manager.

do $$
declare t text;
begin
  foreach t in array array['smm_brands','smm_agents','smm_contents',
                           'smm_content_versions','smm_notes','smm_brain',
                           'smm_jobs','smm_messages','smm_media','smm_results']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "smm_all" on %I', t);
    execute format(
      'create policy "smm_all" on %I for all to authenticated
         using (can_see_smm()) with check (can_see_smm())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

alter table smm_settings enable row level security;

drop policy if exists "smm_settings_read" on smm_settings;
create policy "smm_settings_read" on smm_settings
  for select to authenticated using (can_see_smm());

drop policy if exists "smm_settings_admin" on smm_settings;
create policy "smm_settings_admin" on smm_settings
  for all to authenticated
  using (is_portal_admin()) with check (is_portal_admin());

grant select on smm_settings to authenticated;
grant insert, update, delete on smm_settings to authenticated;  -- filtrate dalla policy
grant all on smm_settings to service_role;

grant execute on function smm_cervello_cerca(uuid, text, text[], int) to authenticated;
grant execute on function smm_budget_residuo(uuid) to authenticated;
grant execute on function smm_termini_vietati(text) to authenticated, service_role;
grant execute on function can_see_smm() to authenticated;
grant execute on function smm_claim_job() to service_role;

-- ============================================================
-- 15. Realtime
-- ============================================================
-- La publication supabase_realtime esiste ma e' vuota: nessuna pagina del
-- portale usava postgres_changes. Qui serve, perche' gli avatar si animano
-- mentre gli agenti lavorano, senza che il manager ricarichi la pagina.
do $$
declare t text;
begin
  foreach t in array array['smm_jobs','smm_contents','smm_messages','smm_brain']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- replica identity full: senza questo gli eventi di update non portano i
-- valori vecchi e il client non sa cosa e' cambiato.
alter table smm_jobs     replica identity full;
alter table smm_contents replica identity full;

-- ============================================================
-- 16. Storage: il bucket privato dei media
-- ============================================================
-- 2 GB per file. Attenzione: il limite globale del progetto (Storage →
-- Settings) ha la precedenza. Se li' c'e' 50 MB, i file grandi vengono
-- rifiutati dal server qualunque cosa dica questa riga.
insert into storage.buckets (id, name, public, file_size_limit)
values ('smm-media', 'smm-media', false, 2147483648)
on conflict (id) do update
  set public = false, file_size_limit = 2147483648;

drop policy if exists "smm_media_read"   on storage.objects;
create policy "smm_media_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'smm-media' and can_see_smm());

drop policy if exists "smm_media_write"  on storage.objects;
create policy "smm_media_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'smm-media' and can_see_smm());

drop policy if exists "smm_media_update" on storage.objects;
create policy "smm_media_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'smm-media' and can_see_smm())
  with check (bucket_id = 'smm-media' and can_see_smm());

drop policy if exists "smm_media_delete" on storage.objects;
create policy "smm_media_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'smm-media' and can_see_smm());
