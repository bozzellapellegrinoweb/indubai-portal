-- ============================================================
-- La direzione: il piano della settimana e gli interruttori
-- ============================================================
-- Mancavano due cose, e sono la stessa cosa vista da due lati: il manager
-- non aveva modo di dire agli agenti quanto devono produrre, e non aveva
-- modo di fermarli.
--
-- Il piano non e' un modulo da compilare per bellezza: lo legge il worker e
-- finisce nel prompt di ogni agente, insieme a quanto manca per chiudere la
-- settimana. Un piano che nessuno legge non e' direzione, e' un promemoria.
-- ============================================================

-- ── 0. Chi puo' leggere le cose del brand ───────────────────
-- Le funzioni che leggono per conto di qualcuno sono security definer: la RLS
-- non le ferma, quindi il controllo lo devono fare loro. Ma non basta
-- can_see_smm(): il worker parla col ruolo di servizio e non ha un utente,
-- quindi auth.uid() e' vuoto e can_see_smm() risponde falso. Senza questa
-- distinzione il piano lo vedrebbe il manager e non gli agenti, che sono
-- quelli che devono rispettarlo.

create or replace function smm_puo_leggere() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select can_see_smm()
      or coalesce(auth.role(), '') = 'service_role'
      or current_user = 'service_role';
$$;

comment on function smm_puo_leggere() is
  'Vero per chi vede la Regia e per il worker lato server. Da usare nelle funzioni security definer che leggono i dati del brand.';

-- Il corpo di prima, intatto, spostato in una funzione interna: la ricerca
-- non cambia, cambia solo chi la puo' chiamare.
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
       or b.vincolante                        -- le vincolanti arrivano sempre
       or b.ricerca @@ q.ts
       or similarity(b.testo, q.raw) > 0.18
       or exists (select 1 from unnest(b.tags) g
                   where g ilike '%' || q.raw || '%')
     )
   order by rilevanza desc, b.peso desc
   limit greatest(1, least(coalesce(p_limite, 12), 80));
$$;

revoke all on function smm_cervello_cerca_interna(uuid, text, text[], int) from public;
comment on function smm_cervello_cerca_interna(uuid, text, text[], int) is
  'La ricerca vera. Non chiamarla direttamente: passa da smm_cervello_cerca, che controlla chi sei.';

-- Il Cervello usava lo stesso meccanismo senza nessun controllo: essendo
-- security definer, qualunque dipendente autenticato poteva leggersi le
-- regole editoriali del brand chiamando la funzione, anche senza avere la
-- Regia. La RLS sulla tabella non c'entra: la funzione la scavalca.
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
  select * from smm_cervello_cerca_interna(p_brand, p_query, p_tipi, p_limite)
   where smm_puo_leggere();
$$;

comment on function smm_cervello_cerca(uuid, text, text[], int) is
  'Cerca nel Cervello del brand. Risponde a chi vede la Regia e al worker, a nessun altro.';

-- ── 1. Il piano ─────────────────────────────────────────────
-- Una riga per ogni cosa che deve uscire con regolarita'. Piu' righe dello
-- stesso tipo si possono avere: "due caroselli fiscali" e "un carosello di
-- lifestyle" sono due righe, con pillar diversi e magari due responsabili.

create table if not exists smm_piano (
  id                 uuid primary key default uuid_generate_v4(),
  brand_id           uuid not null references smm_brands(id) on delete cascade,
  nome               text not null,
  tipo               text not null check (tipo in ('carosello','reel','storia','post')),
  quanti_a_settimana int  not null default 1 check (quanti_a_settimana between 0 and 70),
  giorni             int[] not null default '{}',   -- 1 lunedi .. 7 domenica; vuoto = decide il Direttore
  ora                time,                          -- ora di uscita preferita, fuso di Dubai
  pillar             text[] not null default '{}',
  categorie          text[] not null default '{}',
  agente_id          uuid references smm_agents(id) on delete set null,
  come               text,                          -- le istruzioni in italiano: come, in che modo
  attivo             boolean not null default true,
  ordine             int not null default 100,
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists smm_piano_brand_idx on smm_piano(brand_id, ordine);

comment on table smm_piano is
  'Il piano editoriale della settimana: quanto deve uscire, di che tipo, con che pillar, chi lo fa e come. Lo legge il worker e finisce nel prompt degli agenti.';
comment on column smm_piano.giorni is
  'Giorni di uscita, 1 lunedi .. 7 domenica. Vuoto: li sceglie il Direttore.';
comment on column smm_piano.come is
  'Istruzioni in italiano per chi lo fa. Finisce nel prompt dell''agente parola per parola.';

drop trigger if exists trg_smm_piano_touch on smm_piano;
create trigger trg_smm_piano_touch before update on smm_piano
  for each row execute function smm_touch();

-- ── 2. Quanto manca per chiudere la settimana ───────────────
-- Settimana da lunedi, ora di Dubai, perche' il brand sta negli Emirati e
-- "questa settimana" per il manager e' la sua, non quella UTC.
--
-- Cosa conta come fatto: quello che e' uscito, piu' quello che ha un posto
-- in calendario dentro la settimana, piu' quello che e' in lavorazione e
-- ancora non ha una data. Se contassi solo il pubblicato, il Direttore
-- lancerebbe cinque caroselli ogni volta che lo svegli.

create or replace function smm_piano_settimana(p_brand uuid, p_offset int default 0)
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
    -- il pillar vincola solo se la riga del piano lo chiede
    and (cardinality(p.pillar) = 0 or ct.pillar = any(p.pillar))
    and (cardinality(p.categorie) = 0 or ct.categoria = any(p.categorie))
) u
where p.brand_id = p_brand
  and smm_puo_leggere()
order by p.ordine, p.nome;
$$;

comment on function smm_piano_settimana(uuid, int) is
  'Il piano con quanto e'' stato fatto questa settimana (p_offset 0) o in un''altra. Settimana da lunedi, ora di Dubai.';

-- Il piano in parole, per il prompt degli agenti. Sta in SQL e non nel
-- worker perche' la stessa frase la legge anche il pannello Direzione: una
-- sola versione della verita'.
create or replace function smm_piano_in_parole(p_brand uuid)
returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(string_agg(riga, E'\n' order by ordine, nome), '')
  from (
    select ordine, nome,
      format('- %s: %s %s a settimana%s%s. Fatti o in corso: %s. Mancano: %s.%s%s',
        nome,
        quanti_a_settimana,
        tipo,
        case when cardinality(pillar) > 0
             then ', pillar ' || array_to_string(pillar, ' o ') else '' end,
        case when agente is not null then ', li fa ' || agente else '' end,
        usciti + in_calendario + in_lavorazione,
        mancanti,
        case when cardinality(giorni) > 0
             then ' Giorni: ' || array_to_string(giorni, ', ') || '.' else '' end,
        case when come is not null and come <> '' then ' Come: ' || come else '' end
      ) as riga
    from smm_piano_settimana(p_brand, 0)
    where attivo
  ) r;
$$;

comment on function smm_piano_in_parole(uuid) is
  'Il piano della settimana in italiano, una riga per voce, da mettere nel prompt degli agenti.';

-- ── 3. L'interruttore generale ──────────────────────────────
-- smm_settings la scrive solo l'admin, e per i budget e' giusto. Ma il fermo
-- di emergenza deve averlo chi guarda la stanza: se gli agenti stanno
-- sbagliando, il manager non puo' aspettare una telefonata. Quindi passa da
-- qui, che cambia SOLO stop_tutto e niente altro.

create or replace function smm_interruttore(p_brand uuid, p_stato boolean)
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare v_prima boolean;
begin
  if not can_see_smm() then
    raise exception 'Non hai accesso alla Regia.';
  end if;

  select stop_tutto into v_prima from smm_settings where brand_id = p_brand;
  if v_prima is null then
    raise exception 'Questo brand non ha impostazioni.';
  end if;

  update smm_settings
     set stop_tutto = p_stato, updated_at = now()
   where brand_id = p_brand;

  insert into activity_log (user_id, action, details)
  values (auth.uid(),
          case when p_stato then 'smm_fermo_generale' else 'smm_ripartenza' end,
          jsonb_build_object('brand_id', p_brand, 'prima', v_prima, 'adesso', p_stato));

  return p_stato;
end $$;

comment on function smm_interruttore(uuid, boolean) is
  'Alza o abbassa il fermo generale degli agenti. Cambia solo stop_tutto, e la puo'' chiamare chi vede la Regia, non solo l''admin. I lavori in coda restano in coda.';

-- ── 4. Un agente spento non lavora ──────────────────────────
-- L'interruttore per agente esisteva come colonna ma non lo guardava
-- nessuno: spegnere un agente non fermava i suoi lavori, che venivano presi
-- e pagati come prima. I lavori restano in coda e ripartono quando lo
-- riaccendi.

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
        -- un lavoro senza agente (la pubblicazione, le note del Cervello)
        -- non dipende da nessun interruttore di persona
        and (jj.agent_id is null
             or exists (select 1 from smm_agents a
                         where a.id = jj.agent_id and a.attivo))
      order by jj.priorita desc, jj.created_at
      limit 1
      for update of jj skip locked
   )
  returning j.* into v_job;

  return v_job;
end $$;

comment on function smm_claim_job() is
  'Prende un lavoro dalla coda. Rispetta il fermo generale, il budget del giorno e l''interruttore dell''agente.';

-- ── 5. RLS ──────────────────────────────────────────────────
alter table smm_piano enable row level security;

drop policy if exists smm_piano_all on smm_piano;
create policy smm_piano_all on smm_piano
  for all using (can_see_smm()) with check (can_see_smm());

-- ── 6. Realtime ─────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table smm_piano;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ── 7. Il piano di partenza ─────────────────────────────────
-- Solo quello che esiste davvero: il generatore fa una storia al giorno col
-- cron delle 4 del mattino. I numeri per caroselli, reel e post sono una
-- decisione editoriale, non un dato che ho trovato: li mette il manager dal
-- pannello Direzione, e preferisco una riga sola vera che quattro inventate.

insert into smm_piano (brand_id, nome, tipo, quanti_a_settimana, pillar, agente_id, come, ordine)
select b.id,
       'Storie quotidiane',
       'storia',
       7,
       '{}',
       (select a.id from smm_agents a where a.brand_id = b.id and a.slug = 'copywriter'),
       'Una al giorno, come fa oggi il generatore alle 4 del mattino. '
       || 'Prima slide con la foto dell''avatar, poi contenuto, poi invito. '
       || 'Le storie escono subito e non portano data di programmazione: con la data '
       || 'GoHighLevel le trasforma in post normali.',
       10
  from smm_brands b
 where not exists (select 1 from smm_piano p where p.brand_id = b.id and p.nome = 'Storie quotidiane');
