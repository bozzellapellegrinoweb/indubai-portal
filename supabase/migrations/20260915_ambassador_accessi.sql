-- ============================================================
-- Ambassador — accessi: doppio ruolo cliente+ambassador e profili
-- ============================================================
-- Additiva e ri-eseguibile.
--
-- 1. Una persona può essere insieme cliente InDubai e ambassador, con un solo
--    account. La policy di lettura su clients escludeva però gli ambassador in
--    blocco: chi è anche cliente perdeva l'accesso alla propria area clienti.
--    Ora un ambassador può leggere le righe clients a cui è collegato tramite
--    client_users, e nient'altro.
-- 2. Su auth.users non esiste il trigger che crea la riga in profiles, quindi
--    gli ambassador con accesso ne sono rimasti senza. Non è una falla — le
--    funzioni RLS trattano l'assenza di profilo come "non staff" — ma è uno
--    stato incoerente: qui si recuperano.
-- ============================================================

do $$
begin
  if to_regclass('public.client_users') is null then
    raise notice 'client_users non esiste: policy clients lasciata invariata';
  else
    drop policy if exists "Authenticated users can read clients" on clients;
    create policy "Authenticated users can read clients" on clients
      for select using (
        auth.role() = 'authenticated'
        and (
          not is_ambassador()
          -- un ambassador che è anche cliente vede la propria scheda
          or exists (
            select 1 from client_users cu
            where cu.client_id = clients.id and cu.user_id = auth.uid()
          )
        )
      );
  end if;
end $$;

-- Profili mancanti per gli ambassador che hanno già un accesso
insert into profiles (id, full_name, role)
select a.user_id, a.full_name, 'ambassador'::user_role
from ambassadors a
where a.user_id is not null
  and not exists (select 1 from profiles p where p.id = a.user_id)
on conflict (id) do nothing;
