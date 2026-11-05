-- ============================================================
-- La scheda Testamento diventa un permesso concedibile
-- ============================================================
-- L'Onboarding Testamento e la consulenza raccolgono i dati piu' delicati di
-- tutto il portale: numeri di passaporto, IBAN, atti di proprieta', nomi dei
-- figli minori. Finivano visibili a chiunque avesse accesso ai Clienti, per un
-- motivo preciso: vivono dentro la scheda cliente, che e' l'unica pagina
-- esentata dal controllo dei permessi (la si apre da Clienti, non dal menu).
--
-- Da qui in avanti sono una voce della matrice permessi come le altre, e il
-- controllo e' nel database: nascondere la scheda nell'interfaccia non basta,
-- i dati arriverebbero comunque al browser.
--
-- Il valore predefinito non toglie niente a nessuno: la scheda resta a chi la
-- vede oggi (senior, junior, mini_admin, collaborator, cioe' i ruoli che hanno
-- i Clienti). Da adesso pero' si toglie con un clic da /users.html.
-- ============================================================

-- I ruoli che hanno la scheda Testamento quando per il ruolo non c'e' ancora
-- una configurazione salvata. Rispecchia ROLE_PAGES_DEFAULT in js/app.js.
create or replace function wills_default_roles() returns text[]
language sql immutable as $$ select array['senior','junior','mini_admin','collaborator'] $$;

create or replace function can_see_wills() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case
      -- solo l'admin vede tutto per definizione (come _getAllowed in js/app.js)
      when p.role = 'admin' then true
      else coalesce(
        (select array_length(rp.allowed_pages, 1) is null   -- array vuoto = tutte le pagine
                or 'testamento' = any(rp.allowed_pages)
           from role_permissions rp
          where rp.role = p.role::text),   -- profiles.role e' un enum, role_permissions.role e' testo
        -- nessuna riga salvata = valgono i predefiniti del ruolo
        p.role::text = any(wills_default_roles()))
    end
    from profiles p
    where p.id = auth.uid()
  ), false);
$$;

comment on function can_see_wills() is
  'Vero se il ruolo di chi chiama ha la pagina "testamento" nella matrice permessi. L'''admin sempre.';

-- ── Onboarding (dopo la firma) ──────────────────────────────
drop policy if exists "will_onboardings_staff_read" on will_onboardings;
create policy "will_onboardings_staff_read" on will_onboardings
  for select to authenticated using (is_portal_staff() and can_see_wills());

drop policy if exists "will_onboardings_staff_insert" on will_onboardings;
create policy "will_onboardings_staff_insert" on will_onboardings
  for insert to authenticated with check (is_portal_staff() and can_see_wills());

drop policy if exists "will_onboardings_staff_update" on will_onboardings;
create policy "will_onboardings_staff_update" on will_onboardings
  for update to authenticated
  using (is_portal_staff() and can_see_wills())
  with check (is_portal_staff() and can_see_wills());

-- ── Consulenza (prima della firma) ──────────────────────────
drop policy if exists "will_intakes_staff_read" on will_intakes;
create policy "will_intakes_staff_read" on will_intakes
  for select to authenticated using (is_portal_staff() and can_see_wills());

drop policy if exists "will_intakes_staff_update" on will_intakes;
create policy "will_intakes_staff_update" on will_intakes
  for update to authenticated
  using (is_portal_staff() and can_see_wills())
  with check (is_portal_staff() and can_see_wills());

-- ── Allinea le configurazioni gia' salvate ──────────────────
-- Un ruolo con una riga in role_permissions non passa dai predefiniti: senza
-- questo, chi ha una configurazione salvata perderebbe la scheda Testamento
-- che vede oggi. La aggiunge solo dove c'e' gia' l'accesso ai Clienti.
update role_permissions
   set allowed_pages = allowed_pages || '{testamento}'
 where array_length(allowed_pages, 1) is not null
   and 'clients' = any(allowed_pages)
   and not ('testamento' = any(allowed_pages));
