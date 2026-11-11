-- Annulla 20261111_smm_direzione.sql.
-- Riporta smm_claim_job alla versione che non guarda l'interruttore
-- dell'agente, cosi' il rollback e' davvero il database di prima.


-- Il Cervello torna come era: una funzione sola, senza il controllo su chi
-- chiama. E' il comportamento di prima, che il rollback deve ripristinare.
drop function if exists smm_cervello_cerca(uuid, text, text[], int);
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

drop function if exists smm_cervello_cerca_interna(uuid, text, text[], int);
drop function if exists smm_puo_leggere();

drop function if exists smm_piano_in_parole(uuid);
drop function if exists smm_piano_settimana(uuid, int);
drop function if exists smm_interruttore(uuid, boolean);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime drop table smm_piano;
    exception when undefined_object then null;
    end;
  end if;
end $$;

drop table if exists smm_piano;

create or replace function smm_claim_job() returns smm_jobs
language plpgsql security definer set search_path to 'public' as $$
declare
  v_job smm_jobs;
begin
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
