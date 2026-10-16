-- ============================================================
-- Modulo Proposte — proposte in PDF, accesso con codice, firma semplice
-- ============================================================
-- Additiva e ri-eseguibile. Non cambia la struttura di nessuna tabella
-- esistente. Fuori dalle tabelle proposal_* scrive solo dati:
--   - due fasi in pipeline_stages ("Proposta inviata", "Proposta firmata"),
--     con posizione negativa cosi' le fasi di oggi non si spostano;
--   - i loro id in app_config, cosi' rinominarle non rompe niente;
--   - gli eventi del modulo in notification_settings (on/off da /notifiche-admin).
--
-- Chi scrive: solo le Edge Function proposal-admin e proposal-public, con la
-- service role. Lo staff legge dal portale; il cliente non ha mai un accesso
-- diretto al database (entra dal link pubblico, che passa dalla function).
--
-- Cosa non si puo' fare, nemmeno con la service role (sono trigger, non RLS):
--   - cambiare il contenuto di una proposta dopo l'invio;
--   - toccare una proposta controfirmata;
--   - modificare o cancellare firme ed eventi del registro.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Storage privato ─────────────────────────────────────────
-- Nessuna policy su storage.objects per questo bucket: lo leggono e lo
-- scrivono solo le function con la service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposals', 'proposals', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ============================================================
-- PROPOSALS
-- ============================================================
create table if not exists proposals (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id),
  title               text not null check (length(title) between 1 and 300),
  amount              numeric(14,2) check (amount is null or amount >= 0),
  currency            text not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  locale              text not null default 'it' check (locale in ('it','en')),
  -- draft         = in preparazione (pagine in caricamento), il link non apre
  -- sent          = pubblicata, link attivo
  -- opened        = il cliente l'ha aperta almeno una volta
  -- signed        = firmata dal cliente, in attesa di controfirma
  -- countersigned = controfirmata: chiusa e non piu' modificabile
  -- revoked       = link revocato
  -- "scaduta" non e' uno stato salvato: e' expires_at < now().
  status              text not null default 'draft'
                      check (status in ('draft','sent','opened','signed','countersigned','revoked')),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  -- Il link e' /p/<token>. Si salva l'impronta (per riconoscerlo) e una copia
  -- cifrata con PROPOSAL_LINK_KEY (per poterlo ricopiare dalla scheda cliente).
  link_token_hash     text not null unique,
  link_token_enc      text not null,
  original_pdf_path   text not null,
  original_pdf_name   text,
  original_pdf_sha256 text not null check (original_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  page_count          integer not null check (page_count between 1 and 200),
  -- [{ "n":1, "path":"...", "w":1240, "h":1754, "sha256":"..." }]
  pages               jsonb not null default '[]'::jsonb,
  -- Impronta dell'insieme delle pagine mostrate al cliente, calcolata alla pubblicazione.
  pages_sha256        text,
  ai_extraction       jsonb,
  created_by          uuid not null references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz,
  first_opened_at     timestamptz,
  signed_at           timestamptz,
  signed_by_recipient uuid,
  countersigned_at    timestamptz,
  countersigned_by    uuid references profiles(id),
  final_pdf_path      text,
  final_pdf_sha256    text,
  client_file_id      uuid references client_files(id) on delete set null,
  task_id             uuid references tasks(id) on delete set null
);

create index if not exists idx_proposals_client on proposals(client_id, created_at desc);
create index if not exists idx_proposals_status on proposals(status);

comment on table proposals is
  'Proposte commerciali in PDF con link pubblico, accesso a codice e firma semplice. Scritta solo dalle Edge Function proposal-*.';

-- ============================================================
-- PROPOSAL_RECIPIENTS — chi puo' aprire il link (e chi puo' firmare)
-- ============================================================
create table if not exists proposal_recipients (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  full_name   text not null check (length(full_name) between 1 and 160),
  phone_e164  text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email       text,
  can_sign    boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (proposal_id, phone_e164)
);
create index if not exists idx_proposal_recipients_proposal on proposal_recipients(proposal_id);

do $$ begin
  alter table proposals add constraint proposals_signed_by_fk
    foreign key (signed_by_recipient) references proposal_recipients(id);
exception when duplicate_object then null; end $$;

-- ============================================================
-- PROPOSAL_OTP_CODES — codici a sei cifre (mai in chiaro)
-- ============================================================
create table if not exists proposal_otp_codes (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references proposals(id) on delete cascade,
  recipient_id   uuid not null references proposal_recipients(id) on delete cascade,
  provider       text not null,           -- email | ghl | twilio_verify
  channel        text not null,           -- email | whatsapp | sms
  -- HMAC del codice con OTP_PEPPER. Nullo quando il codice lo genera e lo
  -- verifica il fornitore (Twilio Verify).
  code_hash      text,
  provider_ref   text,
  expires_at     timestamptz not null,
  attempts       integer not null default 0,
  max_attempts   integer not null default 5,
  consumed_at    timestamptz,
  invalidated_at timestamptz,
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_proposal_otp_recipient on proposal_otp_codes(recipient_id, created_at desc);

-- ============================================================
-- PROPOSAL_SESSIONS — sessione del cliente dopo il codice
-- ============================================================
create table if not exists proposal_sessions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references proposals(id) on delete cascade,
  recipient_id    uuid not null references proposal_recipients(id) on delete cascade,
  otp_id          uuid references proposal_otp_codes(id) on delete set null,
  token_hash      text not null unique,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  ended_at        timestamptz,
  ip              text,
  user_agent      text,
  device_id       text,
  country         text,
  last_ip         text,
  last_user_agent text,
  read_to_end_at  timestamptz
);
create index if not exists idx_proposal_sessions_recipient on proposal_sessions(recipient_id, created_at desc);

-- ============================================================
-- PROPOSAL_SIGNATURES — firma del cliente e controfirma
-- ============================================================
create table if not exists proposal_signatures (
  id                   uuid primary key default gen_random_uuid(),
  proposal_id          uuid not null references proposals(id),
  kind                 text not null check (kind in ('client','countersign')),
  recipient_id         uuid references proposal_recipients(id),
  signer_user_id       uuid references profiles(id),
  signer_name          text not null,
  method               text not null check (method in ('typed','drawn')),
  typed_text           text,
  signature_path       text,
  signature_sha256     text,
  document_sha256      text not null,
  pages_sha256         text,
  consent_text         text,
  consent_version      text,
  signed_at            timestamptz not null default now(),
  signed_at_dubai      text not null,
  ip                   text,
  user_agent           text,
  device_id            text,
  country              text,
  verified_phone       text,
  verification_channel text,
  session_id           uuid references proposal_sessions(id),
  created_at           timestamptz not null default now(),
  -- Una sola firma cliente (basta un firmatario) e una sola controfirma.
  unique (proposal_id, kind)
);

-- ============================================================
-- PROPOSAL_EVENTS — registro non modificabile, a catena di hash
-- ============================================================
create table if not exists proposal_events (
  id            bigint generated always as identity primary key,
  proposal_id   uuid not null references proposals(id),
  client_id     uuid,
  recipient_id  uuid,
  session_id    uuid,
  event_type    text not null,
  actor_type    text not null check (actor_type in ('staff','recipient','system')),
  actor_user_id uuid,
  ip            text,
  user_agent    text,
  device_id     text,
  country       text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default clock_timestamp(),
  prev_hash     text,
  hash          text
);
create index if not exists idx_proposal_events_proposal on proposal_events(proposal_id, id);

-- ============================================================
-- PROPOSAL_COUNTERSIGNERS — la firma salvata di chi controfirma
-- ============================================================
create table if not exists proposal_countersigners (
  user_id          uuid primary key references profiles(id) on delete cascade,
  display_name     text not null,
  role_title       text,
  signature_path   text not null,
  signature_sha256 text not null,
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- TRIGGER — cosa non si puo' cambiare
-- ============================================================

create or replace function proposals_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then return old; end if;
    raise exception 'Una proposta pubblicata non si cancella: si revoca.';
  end if;

  if old.status = 'countersigned' then
    raise exception 'Proposta controfirmata: il documento non e'' piu'' modificabile.';
  end if;

  -- Il contenuto si fissa alla pubblicazione.
  if old.status <> 'draft' and (
       new.client_id           is distinct from old.client_id
    or new.title               is distinct from old.title
    or new.amount              is distinct from old.amount
    or new.currency            is distinct from old.currency
    or new.original_pdf_path   is distinct from old.original_pdf_path
    or new.original_pdf_sha256 is distinct from old.original_pdf_sha256
    or new.page_count          is distinct from old.page_count
    or new.pages               is distinct from old.pages
    or new.pages_sha256        is distinct from old.pages_sha256
    or new.created_by          is distinct from old.created_by
    or new.created_at          is distinct from old.created_at
  ) then
    raise exception 'Il contenuto di una proposta inviata non si modifica.';
  end if;

  -- Transizioni di stato ammesse
  if new.status is distinct from old.status and not (
       (old.status = 'draft'  and new.status in ('sent','revoked'))
    or (old.status = 'sent'   and new.status in ('opened','signed','revoked'))
    or (old.status = 'opened' and new.status in ('signed','revoked'))
    or (old.status = 'signed' and new.status = 'countersigned')
  ) then
    raise exception 'Passaggio di stato non ammesso: % -> %', old.status, new.status;
  end if;

  if old.status = 'revoked' and (new.link_token_hash is distinct from old.link_token_hash
                                 or new.expires_at is distinct from old.expires_at) then
    raise exception 'Una proposta revocata non si riattiva: creane una nuova.';
  end if;

  -- Dopo la firma del cliente la scadenza non conta piu' e il link non cambia.
  if old.status = 'signed' and (new.link_token_hash is distinct from old.link_token_hash
                                or new.expires_at is distinct from old.expires_at) then
    raise exception 'Proposta gia'' firmata: link e scadenza non si cambiano.';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_proposals_guard on proposals;
create trigger trg_proposals_guard before update or delete on proposals
  for each row execute function proposals_guard();

create or replace function proposal_recipients_guard() returns trigger
language plpgsql set search_path = public as $$
declare st text;
begin
  select status into st from proposals
   where id = coalesce(old.proposal_id, new.proposal_id);
  -- st nullo = la proposta e' gia' stata cancellata (bozza): cascata ammessa
  if st is null or st = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'I destinatari di una proposta inviata non si modificano.';
end $$;

drop trigger if exists trg_proposal_recipients_guard on proposal_recipients;
create trigger trg_proposal_recipients_guard before update or delete on proposal_recipients
  for each row execute function proposal_recipients_guard();

-- Firme ed eventi: solo inserimento, per chiunque.
create or replace function proposal_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% e'' un registro non modificabile', tg_table_name;
end $$;

drop trigger if exists trg_proposal_signatures_ro on proposal_signatures;
create trigger trg_proposal_signatures_ro before update or delete on proposal_signatures
  for each row execute function proposal_append_only();
drop trigger if exists trg_proposal_signatures_trunc on proposal_signatures;
create trigger trg_proposal_signatures_trunc before truncate on proposal_signatures
  for each statement execute function proposal_append_only();

drop trigger if exists trg_proposal_events_ro on proposal_events;
create trigger trg_proposal_events_ro before update or delete on proposal_events
  for each row execute function proposal_append_only();
drop trigger if exists trg_proposal_events_trunc on proposal_events;
create trigger trg_proposal_events_trunc before truncate on proposal_events
  for each statement execute function proposal_append_only();

-- Catena di hash: ogni evento include l'hash del precedente della stessa
-- proposta. Togliere o alterare una riga (anche a mano, disattivando i
-- trigger) rompe la catena, e proposal_events_verify() lo segnala.
create or replace function proposal_events_chain() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtext('proposal_events:' || new.proposal_id::text));
  select hash into new.prev_hash from proposal_events
   where proposal_id = new.proposal_id order by id desc limit 1;
  new.created_at := clock_timestamp();
  new.hash := encode(digest(
    coalesce(new.prev_hash, '') || '|' || new.proposal_id::text || '|' || new.event_type || '|' ||
    new.actor_type || '|' || coalesce(new.actor_user_id::text, '') || '|' ||
    coalesce(new.recipient_id::text, '') || '|' || coalesce(new.ip, '') || '|' ||
    new.details::text || '|' || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex');
  return new;
end $$;

drop trigger if exists trg_proposal_events_chain on proposal_events;
create trigger trg_proposal_events_chain before insert on proposal_events
  for each row execute function proposal_events_chain();

create or replace function proposal_events_verify(p_proposal uuid)
returns table (ok boolean, broken_at bigint)
language plpgsql stable set search_path = public, extensions as $$
declare r record; prev text := null; h text;
begin
  for r in select * from proposal_events where proposal_id = p_proposal order by id loop
    h := encode(digest(
      coalesce(prev, '') || '|' || r.proposal_id::text || '|' || r.event_type || '|' ||
      r.actor_type || '|' || coalesce(r.actor_user_id::text, '') || '|' ||
      coalesce(r.recipient_id::text, '') || '|' || coalesce(r.ip, '') || '|' ||
      r.details::text || '|' || to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'sha256'), 'hex');
    if r.prev_hash is distinct from prev or r.hash is distinct from h then
      ok := false; broken_at := r.id; return next; return;
    end if;
    prev := r.hash;
  end loop;
  ok := true; broken_at := null; return next;
end $$;

-- ============================================================
-- RLS
-- ============================================================
-- Lettura: staff del portale (is_portal_staff(), come le altre tabelle).
-- Scrittura: nessuna policy -> solo la service role delle Edge Function.
-- Codici e sessioni: nessuna policy -> invisibili a chiunque tranne la service role.

alter table proposals               enable row level security;
alter table proposal_recipients     enable row level security;
alter table proposal_otp_codes      enable row level security;
alter table proposal_sessions       enable row level security;
alter table proposal_signatures     enable row level security;
alter table proposal_events         enable row level security;
alter table proposal_countersigners enable row level security;

drop policy if exists "proposals_staff_read" on proposals;
create policy "proposals_staff_read" on proposals
  for select to authenticated using (is_portal_staff());

drop policy if exists "proposal_recipients_staff_read" on proposal_recipients;
create policy "proposal_recipients_staff_read" on proposal_recipients
  for select to authenticated using (is_portal_staff());

drop policy if exists "proposal_signatures_staff_read" on proposal_signatures;
create policy "proposal_signatures_staff_read" on proposal_signatures
  for select to authenticated using (is_portal_staff());

drop policy if exists "proposal_events_staff_read" on proposal_events;
create policy "proposal_events_staff_read" on proposal_events
  for select to authenticated using (is_portal_staff());

drop policy if exists "proposal_countersigners_own_read" on proposal_countersigners;
create policy "proposal_countersigners_own_read" on proposal_countersigners
  for select to authenticated using (user_id = auth.uid());

revoke all on proposals, proposal_recipients, proposal_otp_codes, proposal_sessions,
              proposal_signatures, proposal_events, proposal_countersigners
  from anon, authenticated;
grant select on proposals, proposal_recipients, proposal_signatures, proposal_events,
                proposal_countersigners
  to authenticated;
grant all on proposals, proposal_recipients, proposal_otp_codes, proposal_sessions,
             proposal_signatures, proposal_events, proposal_countersigners
  to service_role;
revoke execute on function proposal_events_verify(uuid) from public, anon;
grant execute on function proposal_events_verify(uuid) to authenticated, service_role;

-- ============================================================
-- Pipeline: due fasi nuove, prima di quelle esistenti
-- ============================================================
insert into pipeline_stages (name, position, color)
select 'Proposta inviata', -2, '#0ea5e9'
 where not exists (select 1 from app_config where key = 'proposals_stage_sent');
insert into app_config (key, value)
select 'proposals_stage_sent', id::text from pipeline_stages
 where name = 'Proposta inviata' order by created_at desc limit 1
on conflict (key) do nothing;

insert into pipeline_stages (name, position, color)
select 'Proposta firmata', -1, '#16a34a'
 where not exists (select 1 from app_config where key = 'proposals_stage_signed');
insert into app_config (key, value)
select 'proposals_stage_signed', id::text from pipeline_stages
 where name = 'Proposta firmata' order by created_at desc limit 1
on conflict (key) do nothing;

-- ============================================================
-- Notifiche (on/off e destinatari da /notifiche-admin)
-- ============================================================
insert into notification_settings (event_type, label, category, audience, position, roles) values
  ('proposal_opened',     'Proposta aperta dal cliente',                    'Proposte', 'staff',  100, '{admin}'),
  ('proposal_otp_failed', 'Proposta: codici sbagliati piu'' volte',         'Proposte', 'staff',  101, '{admin}'),
  ('proposal_new_device', 'Proposta: accesso da dispositivo o paese nuovo', 'Proposte', 'staff',  102, '{admin}'),
  ('proposal_signed',     'Proposta firmata, da controfirmare',             'Proposte', 'staff',  103, '{admin}'),
  ('proposal_completed',  'Proposta completata (PDF firmato)',              'Proposte', 'staff',  104, '{admin}'),
  ('proposal_completed_client', 'PDF firmato inviato al cliente',           'Proposte', 'client', 105, null)
on conflict (event_type) do nothing;
