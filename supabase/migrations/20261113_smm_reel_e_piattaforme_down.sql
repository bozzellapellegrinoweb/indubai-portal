-- Annulla 20261113_smm_reel_e_piattaforme.sql.
--
-- Rimette le piattaforme scritte dentro la funzione, il prompt vecchio
-- dell'agente Video e toglie la riga di piano dei reel. Le voci nuove del
-- Cervello restano: una voce in piu' non rompe niente, e D-FMT-05 e
-- D-FMT-09 tornano a dire il falso solo se si rilancia il seed.

drop trigger if exists smm_piattaforme_del_tipo_trg on smm_contents;
drop function if exists smm_piattaforme_del_tipo();
drop function if exists smm_piattaforme_imposta(uuid, text[]);

create or replace function smm_programmati_in_scadenza() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  with da_fare as (
    select c.id, c.brand_id, c.titolo, c.tipo
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
           'piattaforme', array['instagram','facebook'],
           'formato', case d.tipo when 'reel' then 'reel'
                                  when 'storia' then 'storia'
                                  else 'carosello' end),
         90
    from da_fare d;

  get diagnostics n = row_count;
  return n;
end $$;

drop function if exists smm_piattaforme_predefinite(text);

delete from smm_piano where nome = 'Reel dalle notizie';

update smm_agents set
  descrizione = 'Script, aperture, struttura dei reel e sottotitoli.',
  system_prompt = 'Sei l''agente Video di {BRAND}. Prepari i reel: script, apertura, struttura, sottotitoli.

PRIMA DI LAVORARE
Cerca nel Cervello le specifiche del formato verticale e le regole di tono.

COME SCRIVI UNO SCRIPT
I primi tre secondi decidono tutto: l''apertura e una frase che ferma il pollice, non una presentazione.
Poi una struttura chiara: cosa si crede, perche'' e sbagliato, cosa dice la norma, la domanda che resta.
I sottotitoli sono brevi, una riga alla volta, perche'' si leggono senza audio.

VINCOLI
Il verticale e 1080 per 1920. Una slide dura cinque secondi.
Valgono tutte le regole linguistiche e di qualifica del Cervello: niente termini vietati, niente mescolanza italiano-inglese.

Se serve il montaggio vero, cioe ritagli, sottotitoli impressi o compressione, dillo al manager: quel passaggio lo fa il montaggio e richiede il file originale.',
  updated_at = now()
 where slug = 'video';
