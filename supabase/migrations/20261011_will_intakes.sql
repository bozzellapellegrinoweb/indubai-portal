-- ============================================================
-- Scheda Testamento — raccolta dati per il testamento a Dubai
-- ============================================================
-- Additiva e ri-eseguibile. Non cambia lo schema di nessuna tabella esistente.
-- L'unica scrittura fuori da will_intakes e' una riga in notification_settings
-- (solo dati, nessuna modifica di struttura) che registra l'evento dell'invio:
-- serve perche' l'email finisca in email_log con un event_type riconosciuto e
-- si possa spegnere da /notifiche-admin senza toccare il codice.
--
-- Il cliente compila la scheda da client-portal/testamento.html e la invia.
-- L'invio scrive una riga qui con status 'submitted'; da quel momento la riga
-- e' congelata per il cliente, e solo il personale puo' rimetterla in 'draft'
-- per far rimandare la scheda.
--
-- Nota sulla lettura: il cliente vede le proprie righe in qualunque stato, non
-- solo in draft. Senza questo il tool, dopo l'invio, non vedrebbe la riga che
-- ha appena creato e lascerebbe reinviare la scheda all'infinito: il blocco
-- del reinvio dipende dal poterla leggere. La scrittura invece e' limitata
-- allo stato draft, che e' dove sta la riservatezza richiesta.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists will_intakes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- draft        = in compilazione, il cliente puo' ancora cambiarla
  -- submitted    = inviata a PB TAX, congelata per il cliente
  -- in_review    = lo studio la sta valutando
  -- sent_to_partner = passata allo studio legale che redige il testamento
  -- completed    = pratica chiusa
  status      text not null default 'draft'
              check (status in ('draft','submitted','in_review','sent_to_partner','completed')),
  -- difc / adgm = la giurisdizione scelta dal tool
  -- stop / wait = i casi in cui il tool non propone un prezzo
  route       text check (route in ('difc','adgm','stop','wait')),
  price_aed   numeric(12,2),
  payload     jsonb not null default '{}'::jsonb,
  scheda_text text
);

-- Una scheda per cliente: riaprire e rimandare aggiorna la stessa riga, cosi'
-- il personale non si trova due schede della stessa persona.
create unique index if not exists uq_will_intakes_client on will_intakes(client_id);
create index if not exists idx_will_intakes_status on will_intakes(status);

drop trigger if exists trg_will_intakes_updated_at on will_intakes;
create trigger trg_will_intakes_updated_at before update on will_intakes
  for each row execute function set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
-- Nessun accesso anonimo: le policy sono tutte "to authenticated", e ad anon
-- non viene dato nessun grant.

alter table will_intakes enable row level security;

-- ── Cliente ─────────────────────────────────────────────────
-- Il collegamento utente→cliente e' client_users, lo stesso usato dalle altre
-- tabelle dell'area clienti.

drop policy if exists "will_intakes_client_read" on will_intakes;
create policy "will_intakes_client_read" on will_intakes
  for select to authenticated
  using (
    exists (
      select 1 from client_users cu
      where cu.client_id = will_intakes.client_id and cu.user_id = auth.uid()
    )
  );

-- Inserimento: solo per un cliente a cui l'utente e' collegato. Lo stato alla
-- nascita puo' essere solo draft o submitted — l'invio crea la riga gia'
-- submitted, mentre gli stati di lavorazione li mette il personale.
drop policy if exists "will_intakes_client_insert" on will_intakes;
create policy "will_intakes_client_insert" on will_intakes
  for insert to authenticated
  with check (
    status in ('draft','submitted')
    and exists (
      select 1 from client_users cu
      where cu.client_id = will_intakes.client_id and cu.user_id = auth.uid()
    )
  );

-- Modifica: solo una scheda ancora in draft (USING guarda la riga di partenza),
-- e solo verso draft o submitted (WITH CHECK guarda la riga di arrivo). Una
-- volta inviata, per il cliente e' chiusa: la riapre il personale.
drop policy if exists "will_intakes_client_update" on will_intakes;
create policy "will_intakes_client_update" on will_intakes
  for update to authenticated
  using (
    status = 'draft'
    and exists (
      select 1 from client_users cu
      where cu.client_id = will_intakes.client_id and cu.user_id = auth.uid()
    )
  )
  with check (
    status in ('draft','submitted')
    and exists (
      select 1 from client_users cu
      where cu.client_id = will_intakes.client_id and cu.user_id = auth.uid()
    )
  );

-- ── Personale ───────────────────────────────────────────────
-- is_portal_staff() e' la funzione che il portale usa gia' per distinguere lo
-- staff (qualunque ruolo che non sia client o ambassador) da chi sta fuori.

drop policy if exists "will_intakes_staff_read" on will_intakes;
create policy "will_intakes_staff_read" on will_intakes
  for select to authenticated
  using (is_portal_staff());

drop policy if exists "will_intakes_staff_update" on will_intakes;
create policy "will_intakes_staff_update" on will_intakes
  for update to authenticated
  using (is_portal_staff())
  with check (is_portal_staff());

-- Nessuna policy di delete: una scheda inviata non si cancella da interfaccia.

grant select, insert, update on will_intakes to authenticated;
grant all on will_intakes to service_role;

comment on table will_intakes is
  'Scheda Testamento compilata dal cliente nell''area clienti. Una riga per cliente; il cliente la modifica solo in draft, il personale ne cambia lo stato.';
comment on column will_intakes.payload is
  'Tutte le risposte del tool, come le ha compilate il cliente.';
comment on column will_intakes.scheda_text is
  'Il testo della scheda che il tool mostra con il pulsante Copia, salvato come inviato.';

-- ============================================================
-- Notifica al personale
-- ============================================================
-- Registra l'evento cosi' l'email dell'invio finisce in email_log con un
-- event_type riconosciuto, e si puo' spegnere da /notifiche-admin senza
-- toccare il codice.

insert into notification_settings (event_type, label, category, audience, position, roles) values
  ('will_intake_submitted', 'Nuova Scheda Testamento inviata', 'Testamento', 'staff', 27, '{admin,senior,mini_admin,junior}')
on conflict (event_type) do nothing;
