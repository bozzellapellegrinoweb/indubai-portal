-- La sezione avatar torna dentro il portale.
--
-- Le foto del manager vivono nel database del generatore, e si gestivano da
-- una pagina di quel progetto. Da quando il generatore e' diventato un
-- motore, quella pagina e' un posto dove bisogna uscire dal portale per
-- andare, e il portale non ha nemmeno piu' una voce di menu per arrivarci.
--
-- Qui serve una cosa sola: poter chiedere "questa persona puo' usare la
-- Regia?" per un utente preciso, e non solo per chi sta chiamando adesso.
-- La funzione che manda avanti le richieste gira lato server con la chiave
-- di servizio, quindi auth.uid() li' non dice niente di utile: l'identita'
-- di chi ha premuto il tasto sta nel suo token, e va verificata
-- esplicitamente.
--
-- Senza questo controllo basterebbe un qualunque utente del portale, anche
-- senza la Regia fra le pagine concesse, per far generare foto che costano.

create or replace function smm_puo_usare(p_user uuid) returns boolean
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
    where p.id = p_user
  ), false);
$$;

comment on function smm_puo_usare(uuid) is
  'Se quell''utente ha la Regia fra le pagine concesse. La decide la matrice dei permessi, non il codice.';

-- can_see_smm() diventa il caso particolare "chi sta chiamando adesso":
-- una definizione sola, cosi' le due non si scollano. Le policy RLS che la
-- usano non cambiano comportamento.
create or replace function can_see_smm() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select smm_puo_usare(auth.uid());
$$;

-- Chiedere il permesso DI UN ALTRO non serve a nessuno in sala: la usa solo
-- il server. can_see_smm() la chiama lo stesso, perche' dentro una funzione
-- security definer i permessi sono quelli del proprietario.
revoke execute on function smm_puo_usare(uuid) from public, anon, authenticated;
grant  execute on function smm_puo_usare(uuid) to service_role;
