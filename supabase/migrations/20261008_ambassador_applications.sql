-- ============================================================
-- CANDIDATURE AMBASSADOR
-- Landing pubblica /diventa-ambassador -> POST /api/ambassador-apply.
-- Le candidature NON creano un ambassador: lo studio valuta il profilo e,
-- se va bene, lo crea da /ambassadors.html come ha sempre fatto.
-- ============================================================

create table if not exists ambassador_applications (
  id            uuid primary key default gen_random_uuid(),

  -- Chi si candida
  full_name     text not null,
  email         text not null,
  phone         text,
  city          text,                       -- dove vive (Dubai, Abu Dhabi, ...)

  -- Profili social: il cuore della valutazione
  instagram     text,
  tiktok        text,
  other_social  text,                       -- YouTube, LinkedIn, sito, ...
  niche         text,                       -- immobiliare, business, fitness, food, ...
  audience      text,                       -- chi lo segue e da dove
  message       text,                       -- racconto libero

  -- Valutazione
  status        text not null default 'nuova'
                check (status in ('nuova', 'in_valutazione', 'approvata', 'rifiutata')),
  ambassador_id uuid references ambassadors(id) on delete set null,  -- se approvata
  admin_notes   text,
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,

  source        text not null default 'landing',
  created_at    timestamptz not null default now()
);

create index if not exists idx_amb_appl_status  on ambassador_applications(status, created_at desc);
create index if not exists idx_amb_appl_created on ambassador_applications(created_at desc);
create index if not exists idx_amb_appl_email   on ambassador_applications(email);

alter table ambassador_applications enable row level security;

-- Lo staff legge e valuta. L'inserimento passa solo dal service role
-- (/api/ambassador-apply): la landing e' pubblica e l'anon key non deve
-- poter scrivere qui.
drop policy if exists "staff legge le candidature" on ambassador_applications;
create policy "staff legge le candidature" on ambassador_applications
  for select to authenticated
  using (exists (
    select 1 from profiles
    where id = auth.uid() and role not in ('client', 'ambassador')
  ));

drop policy if exists "staff valuta le candidature" on ambassador_applications;
create policy "staff valuta le candidature" on ambassador_applications
  for update to authenticated
  using (exists (
    select 1 from profiles
    where id = auth.uid() and role not in ('client', 'ambassador')
  ));

grant select, update on ambassador_applications to authenticated;
grant all on ambassador_applications to service_role;

-- Notifica allo staff, configurabile da /notifiche-admin.html come le altre.
insert into notification_settings (event_type, label, category, audience, enabled, roles, position)
values ('ambassador_application', 'Nuova candidatura ambassador', 'Ambassador', 'staff', true,
        '{admin,senior,mini_admin}', 70)
on conflict (event_type) do nothing;
