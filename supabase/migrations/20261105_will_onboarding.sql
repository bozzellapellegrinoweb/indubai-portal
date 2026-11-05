-- ============================================================
-- Onboarding Testamento — raccolta dati DOPO la firma dell'incarico
-- ============================================================
-- Additiva e ri-eseguibile. Non tocca will_intakes, che resta la scheda
-- PRIMA della firma (qualifica la giurisdizione e stima il prezzo).
--
-- Qui si raccoglie quello che l'Art. 5 della lettera di incarico mette in
-- capo al Cliente e che il §8 "I dati da completare" elenca: anagrafica,
-- passaporto, Emirates ID, indirizzo e residenza fiscale; dati di coniuge e
-- figli; ripartizione definitiva dei beni e destinazione delle quote
-- societarie; tutore sostituto dei figli; due esecutori; erede finale; due
-- testimoni; dati della societa' (licenza e conti).
--
-- Chi apre la raccolta e' lo studio, non il cliente: la riga nasce quando lo
-- staff la attiva dalla scheda cliente. Per questo NON c'e' una policy di
-- insert per il cliente. Finche' la riga non esiste, nell'area clienti la
-- voce non compare.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists will_onboardings (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- draft     = aperta dallo studio, il cliente la sta compilando
  -- submitted = inviata, congelata per il cliente
  -- in_review = lo studio la sta verificando
  -- completed = dati passati al Wills Draftsman
  status       text not null default 'draft'
               check (status in ('draft','submitted','in_review','completed')),
  -- true quando si preparano due Full Will speculari per i coniugi: una sola
  -- compilazione raccoglie i dati di entrambi (par. 7 della lettera)
  mirror       boolean not null default false,
  payload      jsonb not null default '{}'::jsonb,
  scheda_text  text,
  attivato_da  uuid references profiles(id),
  attivato_il  timestamptz not null default now(),
  inviato_il   timestamptz
);

-- Una raccolta per cliente: riaprirla e rimandarla aggiorna la stessa riga.
create unique index if not exists uq_will_onboardings_client on will_onboardings(client_id);
create index if not exists idx_will_onboardings_status on will_onboardings(status);

drop trigger if exists trg_will_onboardings_updated_at on will_onboardings;
create trigger trg_will_onboardings_updated_at before update on will_onboardings
  for each row execute function set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table will_onboardings enable row level security;

-- ── Cliente ─────────────────────────────────────────────────
-- Legge la propria riga in qualunque stato: dopo l'invio deve poter vedere
-- che e' stata inviata, altrimenti il tool la farebbe rimandare all'infinito.
drop policy if exists "will_onboardings_client_read" on will_onboardings;
create policy "will_onboardings_client_read" on will_onboardings
  for select to authenticated
  using (exists (
    select 1 from client_users cu
    where cu.client_id = will_onboardings.client_id and cu.user_id = auth.uid()
  ));

-- Scrive solo finche' e' in draft, e solo verso draft o submitted.
-- Nessuna policy di insert: la raccolta la apre lo studio.
drop policy if exists "will_onboardings_client_update" on will_onboardings;
create policy "will_onboardings_client_update" on will_onboardings
  for update to authenticated
  using (
    status = 'draft'
    and exists (
      select 1 from client_users cu
      where cu.client_id = will_onboardings.client_id and cu.user_id = auth.uid()
    )
  )
  with check (
    status in ('draft','submitted')
    and exists (
      select 1 from client_users cu
      where cu.client_id = will_onboardings.client_id and cu.user_id = auth.uid()
    )
  );

-- ── Personale ───────────────────────────────────────────────
drop policy if exists "will_onboardings_staff_read" on will_onboardings;
create policy "will_onboardings_staff_read" on will_onboardings
  for select to authenticated using (is_portal_staff());

drop policy if exists "will_onboardings_staff_insert" on will_onboardings;
create policy "will_onboardings_staff_insert" on will_onboardings
  for insert to authenticated with check (is_portal_staff());

drop policy if exists "will_onboardings_staff_update" on will_onboardings;
create policy "will_onboardings_staff_update" on will_onboardings
  for update to authenticated using (is_portal_staff()) with check (is_portal_staff());

grant select, insert, update on will_onboardings to authenticated;
grant all on will_onboardings to service_role;

comment on table will_onboardings is
  'Raccolta dati dopo la firma dell''incarico, da cui si redige il testamento. Una riga per cliente, aperta dallo studio.';
comment on column will_onboardings.payload is
  'Tutte le risposte del modulo, come le ha compilate il cliente.';
comment on column will_onboardings.mirror is
  'Testamenti speculari per i coniugi: una compilazione copre entrambi.';

-- Evento di notifica, cosi' l'email finisce in email_log con un event_type
-- riconosciuto e si puo' spegnere da /notifiche-admin senza toccare il codice.
insert into notification_settings (event_type, label, category, audience, position, roles) values
  ('will_onboarding_submitted', 'Onboarding Testamento completato', 'Testamento', 'staff', 28,
   '{admin,senior,mini_admin,junior}')
on conflict (event_type) do nothing;
