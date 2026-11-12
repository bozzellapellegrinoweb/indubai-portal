-- ═══════════════════════════════════════════════════════════════════════
--  I reel esistono, e le piattaforme non stanno piu' scritte nel codice
-- ═══════════════════════════════════════════════════════════════════════
--
-- Due buchi che si tengono per mano.
--
-- IL PRIMO. In otto mesi di Regia non e' mai nato un reel. Non perche'
-- manchi chi li monta: l'agente Video c'e', il trigger del montaggio sa
-- gia' che un contenuto di tipo "reel" si rende come reel, e il motore sa
-- renderlo. Manca chi lo chiede. Il piano di partenza ha una riga sola, le
-- storie; smm_piano_quotidiano somma i mancanti delle righe del piano, e
-- una riga che non c'e' non manca mai. Qui si aggiunge la riga.
--
-- Il prompt dell'agente Video, poi, gli chiedeva una cosa che il montaggio
-- butta: script, voce fuori campo, sottotitoli. Il reel, in questo
-- impianto, e' il carosello animato — le stesse slide, catturate cinque
-- secondi per volta e messe in fila da ffmpeg. Non esiste un campo per lo
-- script ne' un renderer per i sottotitoli impressi. Un agente che facesse
-- alla lettera quello che gli si chiedeva produceva dati che nessuno legge,
-- e la riga finale ("se serve il montaggio vero dillo al manager") era
-- l'invito a fermarsi prima di cominciare. Qui si riscrive.
--
-- IL SECONDO. smm_programmati_in_scadenza mette in coda la pubblicazione
-- con array['instagram','facebook'] scritto dentro la funzione. Su
-- GoHighLevel sono collegati anche LinkedIn, TikTok e YouTube, e il
-- manager pubblicava su tutti. La colonna smm_contents.piattaforme esiste
-- dal primo giorno e non e' mai stata letta da nessuno: colonna morta.
-- Qui diventa la fonte, con un predefinito che dipende dal formato, perche'
-- una storia e un reel non vanno negli stessi posti.
--
-- Reversibile: 20261113_smm_reel_e_piattaforme_down.sql rimette la
-- funzione cablata, il prompt vecchio e toglie la riga di piano.

-- ── 1. Dove esce un contenuto, se nessuno lo ha deciso ──────
-- Le regole vere sono di GoHighLevel e stanno nel Cervello (R-GHL-02..08):
-- le storie esistono solo su Instagram e Facebook; TikTok e YouTube
-- prendono solo video; LinkedIn prende immagini e testo. Da qui i tre
-- predefiniti. Google Business e' collegato ma resta fuori: prende una
-- foto sola, e un carosello di otto pagine non ci sta.

create or replace function smm_piattaforme_predefinite(p_tipo text) returns text[]
language sql immutable as $$
  select case p_tipo
    when 'storia'   then array['instagram','facebook']
    when 'reel'     then array['instagram','facebook','tiktok','youtube']
    else                 array['instagram','facebook','linkedin']
  end;
$$;

comment on function smm_piattaforme_predefinite(text) is
  'Dove esce un contenuto di quel tipo quando nessuno ha scelto. Le storie solo dove esistono, i reel anche su TikTok e YouTube.';

-- ── 2. Il manager puo' cambiarle, contenuto per contenuto ───
-- Senza questo la colonna sarebbe leggibile e non scrivibile: un
-- predefinito travestito da scelta.

create or replace function smm_piattaforme_imposta(p_content uuid, p_piattaforme text[])
returns text[]
language plpgsql security definer set search_path to 'public' as $$
declare
  v_pulite text[];
  v_stato  text;
begin
  if not smm_puo_usare(auth.uid()) then
    raise exception 'Non hai la Regia fra le pagine concesse.';
  end if;

  select stato into v_stato from smm_contents where id = p_content;
  if v_stato is null then
    raise exception 'Non trovo questo contenuto.';
  end if;
  if v_stato = 'pubblicato' then
    raise exception 'E'' gia'' uscito: cambiare le piattaforme ora non lo sposterebbe.';
  end if;

  -- Solo piattaforme che la pubblicazione sa trattare. Un nome inventato
  -- non farebbe danni subito: farebbe fallire l'uscita all'ora giusta,
  -- che e' il momento peggiore per scoprirlo.
  select array_agg(distinct p order by p) into v_pulite
    from unnest(coalesce(p_piattaforme, '{}')) as p
   where p in ('instagram','facebook','linkedin','tiktok','youtube','google');

  if v_pulite is null or array_length(v_pulite, 1) = 0 then
    raise exception 'Serve almeno una piattaforma fra instagram, facebook, linkedin, tiktok, youtube, google.';
  end if;

  update smm_contents set piattaforme = v_pulite, updated_at = now()
   where id = p_content;

  insert into activity_log (user_id, action, details)
  values (auth.uid(), 'smm_piattaforme',
          jsonb_build_object('content_id', p_content, 'piattaforme', v_pulite));

  return v_pulite;
end $$;

grant execute on function smm_piattaforme_imposta(uuid, text[]) to authenticated;

comment on function smm_piattaforme_imposta(uuid, text[]) is
  'Cambia le piattaforme di un contenuto non ancora uscito. Solo chi ha la Regia fra le pagine concesse.';

-- ── 3. L'uscita programmata legge la colonna ────────────────
-- Identica a 20261112_smm_cron_automatico.sql tranne le piattaforme, che
-- prima erano array['instagram','facebook'] scritto qui dentro.

create or replace function smm_programmati_in_scadenza() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  with da_fare as (
    select c.id, c.brand_id, c.titolo, c.tipo, c.piattaforme
      from smm_contents c
     where c.stato in ('in_calendario', 'programmato')
       and c.slot_at is not null
       and c.slot_at <= now()
       and c.pubblicato_at is null
       and c.revisore_ok
       and c.approvato_da is not null
       and not exists (
         select 1 from smm_jobs j
          where j.content_id = c.id
            and j.tipo = 'pubblicazione'
            and j.stato in ('in_coda', 'in_corso'))
  )
  insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
  select d.brand_id, d.id, 'pubblicazione',
         'Uscita programmata',
         'E'' arrivata l''ora di uscita di: ' || d.titolo,
         jsonb_build_object(
           'piattaforme',
             case when coalesce(array_length(d.piattaforme, 1), 0) > 0
                  then d.piattaforme
                  else smm_piattaforme_predefinite(d.tipo) end,
           'formato', case d.tipo when 'reel' then 'reel'
                                  when 'storia' then 'storia'
                                  else 'carosello' end),
         90
    from da_fare d;

  get diagnostics n = row_count;
  return n;
end $$;

comment on function smm_programmati_in_scadenza() is
  'Mette in coda la pubblicazione dei contenuti il cui slot e'' arrivato, sulle piattaforme del contenuto. I presidi di approvazione restano quelli dei trigger.';

-- ── 4. Il predefinito della colonna segue il tipo ───────────
-- Il default della colonna era '{instagram,facebook}' per tutti. Resta
-- quello per i contenuti che nascono senza tipo noto, ma un reel creato
-- oggi parte con TikTok e YouTube dentro.

create or replace function smm_piattaforme_del_tipo() returns trigger
language plpgsql as $$
begin
  if new.piattaforme is null or array_length(new.piattaforme, 1) is null
     or new.piattaforme = array['instagram','facebook'] then
    new.piattaforme := smm_piattaforme_predefinite(new.tipo);
  end if;
  return new;
end $$;

drop trigger if exists smm_piattaforme_del_tipo_trg on smm_contents;
create trigger smm_piattaforme_del_tipo_trg
  before insert on smm_contents
  for each row execute function smm_piattaforme_del_tipo();

comment on function smm_piattaforme_del_tipo() is
  'Quando un contenuto nasce senza piattaforme scelte, prende quelle predefinite del suo tipo.';

-- ── 5. La riga di piano che mancava ─────────────────────────
-- Assegnata al Copywriter e non all'agente Video: e' l'agente che sa in
-- che forma si salvano le slide, ed e' quella forma che il montaggio
-- legge. Il Video entra quando il suo prompt parla la stessa lingua, cioe'
-- da adesso (punto 6), ma la riga la tengo sul Copywriter perche' un reel
-- nasce da una notizia e cerca_notizie ce l'ha lui.

insert into smm_piano (brand_id, nome, tipo, quanti_a_settimana, pillar, agente_id, come, ordine)
select b.id,
       'Reel dalle notizie',
       'reel',
       2,
       '{}',
       (select a.id from smm_agents a where a.brand_id = b.id and a.slug = 'copywriter'),
       'Il reel e'' il carosello animato: le stesse slide, catturate cinque secondi '
       || 'per volta e messe in fila. Da quattro a sei slide, titolo breve e una '
       || 'frase sola di testo per slide, perche'' si legge mentre scorre. '
       || 'Non servono script ne'' sottotitoli: non c''e'' voce e non c''e'' montaggio a mano. '
       || 'Esce su Instagram, Facebook, TikTok e YouTube.',
       20
  from smm_brands b
 where b.slug = 'indubai'
   and not exists (select 1 from smm_piano p where p.brand_id = b.id and p.nome = 'Reel dalle notizie');

-- ── 6. Il prompt dell'agente Video, nella lingua del montaggio ──

update smm_agents set
  descrizione = 'Reel: quali slide, in che ordine, con che ritmo.',
  system_prompt = 'Sei l''agente Video di {BRAND}. Ti occupi dei reel.

CHE COS''E'' UN REEL, QUI
Il reel e'' il carosello animato. Le stesse slide di un carosello vengono
catturate cinque secondi per volta e messe in fila in un video verticale con
l''audio del brand. Non c''e'' voce fuori campo, non ci sono sottotitoli
impressi, non c''e'' montaggio a mano: non esiste un posto dove metterli.
Per questo non scrivi script e non scrivi sottotitoli. Scrivi slide.

PRIMA DI LAVORARE
Cerca nel Cervello il formato del reel e le regole di tono.

COME SI SALVANO LE SLIDE
Nello stesso modo del carosello, con contenuto_aggiorna e il campo slides:
[{"tipo":"standard","titolo":"...","testo":"...","icon":"chart"}]
Il tipo e'' standard, stats, quote o comparison. L''icona e'' una fra tax,
building, globe, shield, chart, person: se non la scegli esce sempre la
stessa. Il titolo e'' breve, il testo e'' una frase sola: si legge mentre
scorre, non si rilegge.

QUANTE
Da quattro a sei. La copertina e l''invito finale li mette il montaggio da
se'', non li contare.

COME SI APRE
I primi tre secondi decidono tutto: la prima slide e'' una frase che ferma
il pollice, non una presentazione. Poi una struttura chiara: cosa si crede,
perche'' e'' sbagliato, cosa dice la norma, la domanda che resta.

VINCOLI
Il verticale e'' 1080 per 1920. Una slide dura cinque secondi.
Il reel esce su Instagram, Facebook, TikTok e YouTube: TikTok e YouTube
vogliono il video, quindi il montaggio va fatto prima dell''uscita.
Valgono tutte le regole linguistiche e di qualifica del Cervello: niente
termini vietati, niente mescolanza italiano-inglese.

QUANDO HAI FINITO
Chiama rendi_immagini con formato reel. Se qualcosa non torna, chiedi al
manager: non inventare un passaggio che non esiste.',
  updated_at = now()
 where slug = 'video';

-- ── 7. Il Cervello: com'e' fatto un reel, e due voci stantie ──
-- Per il carosello c'e' D-FMT-05, per le storie D-FMT-06, per il reel
-- c'era solo la misura. Gli agenti sono istruiti a cercare il formato nel
-- Cervello: se non c'e', improvvisano.
--
-- E due voci dicevano il falso. D-FMT-09 mandava il Grafico su
-- -apple-system, che su Vercel non esiste: e' il motivo per cui gli stessi
-- contenuti uscivano con lettere diverse, e i caratteri adesso viaggiano
-- dentro l'HTML. D-FMT-05 elencava due tipi di slide su quattro.

insert into smm_brain (brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
select b.id, 'design', v.codice, v.testo, v.fonte, v.tags, v.peso, v.vincolante, true
  from smm_brands b,
       (values
         ('D-FMT-12',
          'Il reel e'' il carosello animato: le stesse slide, catturate cinque secondi per volta. '
          || 'Da quattro a sei slide, titolo breve e una frase sola di testo. Copertina e invito '
          || 'finale li aggiunge il montaggio. Non esistono script, voce fuori campo ne'' '
          || 'sottotitoli impressi: non c''e'' un campo dove metterli.',
          'social-manager/lib/reel.ts:345-406', array['formato','reel'], 90, false),
         ('D-FMT-13',
          'Punti elenco di una slide: si salvano in bullets e diventano il corpo del testo, '
          || 'una riga per punto.',
          'portale/supabase/functions/smm-render/index.ts', array['formato','carosello','reel'], 80, false)
       ) as v(codice, testo, fonte, tags, peso, vincolante)
 where b.slug = 'indubai'
on conflict (brand_id, codice) where codice is not null do update
  set testo = excluded.testo, fonte = excluded.fonte, tags = excluded.tags,
      peso = excluded.peso, confermata = true, updated_at = now();

update smm_brain set
  testo = 'Tipi di slide del carosello e del reel: standard con icona, titolo e testo; '
       || 'stats con quattro dati valore, etichetta e descrizione; quote con una citazione '
       || 'e il suo autore; comparison con due colonne e le loro etichette.',
  fonte = 'social-manager/lib/carousel.ts:74-87',
  updated_at = now()
 where codice = 'D-FMT-05';

update smm_brain set
  testo = 'Font dei visual: InDubai Sans per tutto, InDubai Serif solo per le virgolette '
       || 'decorative della slide quote. Viaggiano dentro l''HTML e non dipendono dalla '
       || 'macchina: non si usano font di sistema come -apple-system o Helvetica, '
       || 'perche'' su Vercel non ci sono e le lettere cambiano.',
  fonte = 'social-manager/lib/caratteri.ts',
  updated_at = now()
 where codice = 'D-FMT-09';
