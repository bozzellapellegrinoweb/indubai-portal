-- ============================================================
-- Le immagini si fanno da sole, non le chiede il manager
-- ============================================================
-- Il Copywriter scriveva, il Revisore passava, e il contenuto arrivava in
-- approvazione senza file. Per vederlo bisognava premere "Prepara le
-- immagini" a mano. Un lavoro in piu' per il manager, ogni volta, su ogni
-- contenuto: esattamente quello che la Regia doveva togliere.
--
-- Perche' succedeva: rendere era uno strumento del Grafico, e nessuno
-- coinvolgeva il Grafico. La catena finiva al Revisore.
--
-- Rendere pero' non e' una decisione: e' un passaggio meccanico. Non serve
-- un agente che ci pensi, e farlo decidere a un modello costa venti
-- centesimi per dire "si', rendi". Quindi diventa un lavoro di tipo
-- "montaggio", che il worker esegue chiamando direttamente il motore,
-- senza modello e senza spesa.
--
-- Parte da solo quando un contenuto entra in approvazione e non ha ancora
-- file. Se i file ci sono gia', non si rifa' niente.
-- ============================================================

create or replace function smm_monta_quando_pronto() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  quante int;
begin
  -- Solo quando ENTRA in approvazione, non a ogni salvataggio.
  if new.stato <> 'da_approvare' or coalesce(old.stato,'') = 'da_approvare' then
    return new;
  end if;

  -- Niente slide, niente da rendere. Le slide possono essere un elenco
  -- oppure l'oggetto completo con dentro la copertina: il motore accetta
  -- tutte e due, e su quest'ultimo jsonb_array_length solleva un errore.
  -- Dentro un trigger un errore non e' un messaggio: e' il verdetto del
  -- Revisore che viene rifiutato e il contenuto che non passa.
  -- In un IF di plpgsql il primo "then" chiude la condizione, anche quello
  -- di un case annidato: il conto si fa prima, in una variabile.
  quante := case jsonb_typeof(new.slides)
              when 'array'  then jsonb_array_length(new.slides)
              when 'object' then 1
              else 0
            end;
  if quante = 0 then
    return new;
  end if;

  -- Ha gia' i file: non si rifa'.
  if exists (select 1 from smm_media m
              where m.content_id = new.id and m.ruolo = 'derivato') then
    return new;
  end if;

  -- Gia' in coda o in corso: non si duplica.
  if exists (select 1 from smm_jobs j
              where j.content_id = new.id and j.tipo = 'montaggio'
                and j.stato in ('in_coda','in_corso')) then
    return new;
  end if;

  insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
  values (new.brand_id, new.id, 'montaggio',
          'Preparare i file di: ' || new.titolo,
          'Rendere le slide in immagini o video, pronte per la pubblicazione.',
          jsonb_build_object('formato',
            case new.tipo when 'reel' then 'reel'
                          when 'storia' then 'storia'
                          else 'carosello' end),
          75);
  return new;
end $$;

comment on function smm_monta_quando_pronto() is
  'Quando un contenuto entra in approvazione senza file, mette in coda il montaggio. Il manager non deve chiederlo.';

drop trigger if exists trg_smm_monta_quando_pronto on smm_contents;
create trigger trg_smm_monta_quando_pronto after update of stato on smm_contents
  for each row execute function smm_monta_quando_pronto();

-- Il tipo "montaggio" era gia' previsto nel vincolo, ma lo rimetto
-- esplicito: questa migrazione lo rende un tipo che esiste davvero.
alter table smm_jobs drop constraint if exists smm_jobs_tipo_check;
alter table smm_jobs add constraint smm_jobs_tipo_check
  check (tipo in ('agente','montaggio','nota_cervello','analisi','pubblicazione','piano'));

-- ─── Chi era gia' in approvazione quando il trigger non c'era ──────────────
--
-- Il trigger scatta sul passaggio di stato, e un contenuto che in
-- approvazione c'e' gia' quel passaggio non lo rifa': resterebbe senza file
-- per sempre, e il manager se li ritroverebbe da chiedere a mano. E' esatta-
-- mente il lavoro che questa migrazione gli toglie, quindi va tolto anche a
-- chi era arrivato prima.
--
-- Si puo' rieseguire: chi ha gia' i file, o un montaggio in coda, resta
-- fuori.
insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
select c.brand_id, c.id, 'montaggio',
       'Preparare i file di: ' || c.titolo,
       'Rendere le slide in immagini o video, pronte per la pubblicazione.',
       jsonb_build_object('formato',
         case c.tipo when 'reel'   then 'reel'
                     when 'storia' then 'storia'
                     else 'carosello' end),
       75
from smm_contents c
where c.stato = 'da_approvare'
  and case jsonb_typeof(c.slides)
        when 'array'  then jsonb_array_length(c.slides)
        when 'object' then 1
        else 0
      end > 0
  and not exists (select 1 from smm_media m
                   where m.content_id = c.id and m.ruolo = 'derivato')
  and not exists (select 1 from smm_jobs j
                   where j.content_id = c.id and j.tipo = 'montaggio'
                     and j.stato in ('in_coda', 'in_corso'));
