-- Si puo' buttare un contenuto.
--
-- Non si poteva: gli stati andavano da "idea" a "pubblicato" e basta.
-- Quello che il Direttore apriva e nessuno scriveva restava li' per
-- sempre, e lo stesso valeva per una prova, per un contenuto respinto che
-- non si vuole riscrivere, per un'idea che non interessa piu'. In una
-- settimana la lista diventa illeggibile, e il disordine non e' un
-- problema estetico: ci si perde dentro quello che aspetta davvero.
--
-- Uno stato, non una cancellazione: cosi' resta la traccia di cosa e'
-- passato e perche', e si puo' tornare indietro. Chi lo guarda non lo
-- vede, ed e' quello che serve.

alter table smm_contents drop constraint if exists smm_contents_stato_check;
alter table smm_contents add constraint smm_contents_stato_check
  check (stato in ('idea','in_lavorazione','da_revisione','respinto',
                   'da_approvare','approvato','in_calendario',
                   'programmato','pubblicato','scartato'));

comment on column smm_contents.stato is
  'Dove sta il contenuto. "scartato" e'' buttato dal manager: resta in archivio ma sparisce dalle liste.';

/**
 * Butta un contenuto.
 *
 * Fa tre cose insieme, e vanno insieme: toglie il contenuto dalle liste,
 * ferma i lavori che lo riguardano, e gli leva la data di uscita. Lasciare
 * un montaggio in coda su una cosa buttata vuol dire pagare un rendering
 * per niente; lasciare la data vuol dire che il cron la pubblica.
 *
 * Quello che e' gia' uscito non si butta: e' uscito, e la traccia serve.
 */
create or replace function smm_scarta(p_content uuid, p_perche text default null)
returns text
language plpgsql security definer set search_path to 'public' as $$
declare
  v_stato text;
  v_titolo text;
  v_fermati int;
begin
  if not smm_puo_usare(auth.uid()) then
    raise exception 'Non hai accesso alla Regia.';
  end if;

  select stato, titolo into v_stato, v_titolo from smm_contents where id = p_content;
  if v_stato is null then
    raise exception 'Questo contenuto non esiste piu''.';
  end if;
  if v_stato = 'pubblicato' then
    raise exception 'Questo e'' gia'' uscito: non si butta. Lo trovi nei Risultati.';
  end if;
  if v_stato = 'scartato' then
    return v_titolo;   -- gia' fatto: non e' un errore
  end if;

  update smm_jobs
     set stato = 'annullato', finished_at = now(),
         errore = 'Il manager ha buttato il contenuto.'
   where content_id = p_content
     and stato in ('in_coda', 'in_corso', 'attesa_risposta');
  get diagnostics v_fermati = row_count;

  update smm_contents
     set stato = 'scartato', slot_at = null
   where id = p_content;

  insert into activity_log (user_id, action, details)
  values (auth.uid(), 'smm_scartato',
          jsonb_build_object('content_id', p_content, 'titolo', v_titolo,
                             'da_stato', v_stato, 'perche', p_perche,
                             'lavori_fermati', v_fermati));

  return v_titolo;
end $$;

comment on function smm_scarta(uuid, text) is
  'Butta un contenuto: sparisce dalle liste, i suoi lavori si fermano e perde la data di uscita. Quello gia'' pubblicato non si butta.';

revoke execute on function smm_scarta(uuid, text) from public, anon;
grant  execute on function smm_scarta(uuid, text) to authenticated, service_role;

-- Un contenuto buttato non rientra dalla finestra: il piano non lo conta
-- piu' fra quelli fatti. La funzione e' quella di 20261112_smm_cron_automatico
-- copiata tale e quale, con una riga in piu': riscriverla a memoria vuol
-- dire perdere per strada il filtro per pillar, ed e' successo.
create or replace function smm_piano_settimana_interna(p_brand uuid, p_offset int default 0)
returns table (
  id uuid, nome text, tipo text, quanti_a_settimana int,
  giorni int[], ora time, pillar text[], categorie text[],
  agente_id uuid, agente text, come text, attivo boolean, ordine int,
  usciti int, in_calendario int, in_lavorazione int, mancanti int
)
language sql stable security definer set search_path to 'public' as $$
with confini as (
  select
    (date_trunc('week', (now() at time zone 'Asia/Dubai')) + (p_offset || ' weeks')::interval)
      at time zone 'Asia/Dubai' as dal,
    (date_trunc('week', (now() at time zone 'Asia/Dubai')) + ((p_offset + 1) || ' weeks')::interval)
      at time zone 'Asia/Dubai' as al
)
select
  p.id, p.nome, p.tipo, p.quanti_a_settimana,
  p.giorni, p.ora, p.pillar, p.categorie,
  p.agente_id, a.nome as agente, p.come, p.attivo, p.ordine,
  u.usciti, u.in_calendario, u.in_lavorazione,
  greatest(0, p.quanti_a_settimana - (u.usciti + u.in_calendario + u.in_lavorazione)) as mancanti
from smm_piano p
left join smm_agents a on a.id = p.agente_id
cross join confini c
cross join lateral (
  select
    count(*) filter (
      where ct.pubblicato_at >= c.dal and ct.pubblicato_at < c.al
    )::int as usciti,
    count(*) filter (
      where ct.pubblicato_at is null
        and ct.slot_at >= c.dal and ct.slot_at < c.al
    )::int as in_calendario,
    count(*) filter (
      where ct.pubblicato_at is null and ct.slot_at is null
        and ct.stato <> 'respinto'
        and ct.created_at >= c.dal
    )::int as in_lavorazione
  from smm_contents ct
  where ct.brand_id = p.brand_id
    and ct.tipo = p.tipo
    -- Quello che il manager ha buttato non conta come fatto, altrimenti
    -- una settimana risulterebbe coperta da roba buttata e gli agenti non
    -- la rifarebbero.
    and ct.stato <> 'scartato'
    and (cardinality(p.pillar) = 0 or ct.pillar = any(p.pillar))
    and (cardinality(p.categorie) = 0 or ct.categoria = any(p.categorie))
) u
where p.brand_id = p_brand
order by p.ordine, p.nome;
$$;

revoke all   on function smm_piano_settimana_interna(uuid, int) from public, anon, authenticated;
grant execute on function smm_piano_settimana_interna(uuid, int) to service_role;
