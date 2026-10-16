-- ============================================================
-- Permessi per persona, gestibili dal portale
-- ============================================================
-- Tre cose non funzionavano, e insieme rendevano i permessi ingestibili:
--
-- 1. Cambiare il ruolo di qualcuno non aveva alcun effetto. Su profiles
--    l'unica policy di modifica era "auth.uid() = id", cioe' ognuno puo'
--    cambiare solo se' stesso. Un admin che cambiava ruolo a un altro
--    riceveva 200 con zero righe toccate, e il portale diceva "aggiornato".
--
-- 2. I task non avevano nessuno scope per persona: chiunque non fosse
--    'commerciale' vedeva i task di tutti.
--
-- 3. "Vede i dati finanziari" non era una scelta per persona ma una
--    deduzione dal ruolo (sees_financials() = "non e' commerciale"), e su
--    subscription_payments e bank_statements c'era anche una seconda policy
--    che dava accesso a admin, senior e junior comunque: qualunque
--    impostazione sarebbe stata scavalcata.
--
-- Qui si aggiungono due interruttori per persona, con default uguale al
-- comportamento di oggi: chi non li tocca non cambia niente.
-- ============================================================

-- ── Chi e' admin ────────────────────────────────────────────
-- SECURITY DEFINER perche' una policy su profiles che interroga profiles
-- andrebbe in ricorsione infinita. E' lo stesso motivo per cui esistono
-- gia' is_portal_staff(), is_ambassador(), is_commerciale().
create or replace function is_portal_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ── 1. L'admin puo' gestire i profili degli altri ───────────
drop policy if exists "admin_manage_profiles" on profiles;
create policy "admin_manage_profiles" on profiles
  for update to authenticated
  using (is_portal_admin())
  with check (is_portal_admin());

-- ── 1-bis. Nessuno si promuove da solo ──────────────────────
-- La policy "Users can update own profile" permette a ognuno di modificare
-- la propria riga, e senza WITH CHECK il controllo e' solo "la riga e' mia":
-- il ruolo non e' protetto. Chiunque abbia un accesso al portale poteva
-- diventare admin con una sola chiamata, e dopo questa migration avrebbe
-- potuto rimettersi da solo i task e il fatturato appena tolti.
--
-- Il presidio e' un trigger invece di una policy: vale su qualunque percorso
-- di scrittura e non dipende da come sono scritte le policy. Chi non e'
-- admin puo' cambiare solo nome e avatar; gli altri campi tornano com'erano,
-- in silenzio, senza far fallire la richiesta.
create or replace function profiles_protect_privileges() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  -- auth.uid() nullo = service_role o accesso diretto al database (migrazioni,
  -- creazione utenti): li' il controllo e' a monte, non qui.
  if auth.uid() is null or is_portal_admin() then
    return new;
  end if;
  new.role               := old.role;
  new.clients_scope      := old.clients_scope;
  new.tasks_scope        := old.tasks_scope;
  new.can_see_financials := old.can_see_financials;
  return new;
end $$;

-- ── 2. Interruttori per persona ─────────────────────────────
-- 'all'  = vede i task di tutti (come oggi)
-- 'own'  = solo quelli assegnati a lei o creati da lei
alter table profiles add column if not exists tasks_scope text not null default 'all';
do $$ begin
  alter table profiles add constraint profiles_tasks_scope_check
    check (tasks_scope in ('all','own'));
exception when duplicate_object then null; end $$;

-- Fatturato, incassi, estratti conto, registro IVA.
alter table profiles add column if not exists can_see_financials boolean not null default true;

comment on column profiles.tasks_scope is
  'all = vede i task di tutti; own = solo i propri. Si imposta da /users.html.';
comment on column profiles.can_see_financials is
  'Se falso, la persona non legge pagamenti, estratti conto e registro IVA. Si imposta da /users.html.';

drop trigger if exists trg_profiles_protect on profiles;
create trigger trg_profiles_protect before update on profiles
  for each row execute function profiles_protect_privileges();

-- ── 3. I task rispettano lo scope ───────────────────────────
create or replace function sees_all_tasks() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select tasks_scope = 'all' from profiles where id = auth.uid()),
    true   -- senza profilo si comporta come prima: nessuna restrizione nuova
  );
$$;

drop policy if exists "auth tasks" on tasks;
create policy "auth tasks" on tasks
  for all to authenticated
  using (
    auth.role() = 'authenticated'
    and (not is_commerciale() or assigned_to = auth.uid() or created_by = auth.uid()
         or client_id in (select c.id from clients c))
    and (sees_all_tasks() or assigned_to = auth.uid() or created_by = auth.uid())
  );

-- ── 4. I dati finanziari rispettano l'interruttore ──────────
-- Prima: "chiunque tranne commerciale". Ora e' una scelta per persona, con
-- commerciale escluso come prima.
create or replace function sees_financials() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select can_see_financials and role <> 'commerciale' from profiles where id = auth.uid()),
    false
  );
$$;

-- Le policy che davano accesso ai soldi in base al ruolo vanno tolte: finche'
-- ci sono, qualunque impostazione per persona viene scavalcata da un OR.
-- Restano le policy "Authenticated users full access", che sono for all e
-- gia' basate su sees_financials(): chi vede i soldi li modifica, chi non li
-- vede non li tocca. Nessuno perde la scrittura che aveva, tranne chi viene
-- esplicitamente escluso.
drop policy if exists "staff_write_subscription_payments" on subscription_payments;
drop policy if exists "staff_write_bank_statements" on bank_statements;
