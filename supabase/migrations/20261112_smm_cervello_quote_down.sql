-- Annulla 20261112_smm_cervello_quote.sql: la ricerca torna a una sola
-- classifica, col bonus di rilevanza alle voci vincolanti.

create or replace function smm_cervello_cerca_interna(
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
       or b.vincolante
       or b.ricerca @@ q.ts
       or similarity(b.testo, q.raw) > 0.18
       or exists (select 1 from unnest(b.tags) g
                   where g ilike '%' || q.raw || '%')
     )
   order by rilevanza desc, b.peso desc
   limit greatest(1, least(coalesce(p_limite, 12), 80));
$$;

revoke all on function smm_cervello_cerca_interna(uuid, text, text[], int) from public, anon, authenticated;
