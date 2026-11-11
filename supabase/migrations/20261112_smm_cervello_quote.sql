-- ============================================================
-- Il Cervello non deve rispondere solo con i divieti
-- ============================================================
-- La ricerca dava alle voci vincolanti un bonus di rilevanza, perche'
-- devono arrivare sempre. Le vincolanti pero' sono 51: col bonus stanno
-- davanti a tutto, e un limite di venti risultati le restituisce quasi
-- tutte e basta.
--
-- Provato: cercando "conto a Dubai e quadro RW" tornavano otto risultati e
-- nessuno era un topic della knowledge. Il Copywriter chiedeva al Cervello
-- di cosa parlare e riceveva l'elenco di cosa non dire. Ha scritto una
-- storia corretta e anonima, ed era l'unica cosa che poteva scrivere.
--
-- Adesso i posti sono divisi: meta' alle vincolanti piu' pertinenti,
-- meta' al materiale migliore. Le vincolanti continuano ad arrivare
-- sempre, ma non da sole.
-- ============================================================

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
  ),
  tutte as (
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
  ),
  -- Due quote separate, altrimenti i divieti occupano tutto il tavolo.
  -- Almeno una vincolante e almeno una no, anche quando il limite e' basso.
  quote as (
    select greatest(1, least(coalesce(p_limite, 12), 80)) as n
  ),
  vincolanti as (
    select t.* from tutte t, quote
     where t.vincolante
     order by t.rilevanza desc, t.peso desc
     limit (select greatest(1, n / 2) from quote)
  ),
  materiale as (
    select t.* from tutte t, quote
     where not t.vincolante
     order by t.rilevanza desc, t.peso desc
     limit (select greatest(1, n - greatest(1, n / 2)) from quote)
  )
  select id, tipo, codice, testo, fonte, tags, peso, vincolante, rilevanza
    from (select * from vincolanti union all select * from materiale) r
   order by vincolante desc, rilevanza desc;
$$;

revoke all on function smm_cervello_cerca_interna(uuid, text, text[], int) from public, anon, authenticated;
comment on function smm_cervello_cerca_interna(uuid, text, text[], int) is
  'Il conteggio vero della ricerca, senza controllo su chi chiama. Meta'' dei posti alle voci vincolanti, meta'' al materiale: senza quote i divieti riempiono la risposta. Non chiamarla da fuori: passa da smm_cervello_cerca.';
