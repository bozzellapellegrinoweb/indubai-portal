-- Torna indietro: can_see_smm() si rilegge auth.uid() da sola e la funzione
-- parametrica sparisce.

create or replace function can_see_smm() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case
      when p.role = 'admin' then true
      else coalesce(
        (select array_length(rp.allowed_pages, 1) is null
                or 'regia' = any(rp.allowed_pages)
           from role_permissions rp
          where rp.role = p.role::text),
        p.role::text = any(smm_default_roles()))
    end
    from profiles p
    where p.id = auth.uid()
  ), false);
$$;

drop function if exists smm_puo_usare(uuid);
