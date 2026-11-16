-- ═══════════════════════════════════════════════════════════════════════
--  Un tipo di contenuto si puo' fermare, senza toccare il codice
-- ═══════════════════════════════════════════════════════════════════════
--
-- "Blocca la programmazione e la creazione di reel: non mi piace come
-- vengono realizzati, a breve dara' un'altra opzione." E' una decisione
-- editoriale, e le decisioni editoriali si cambiano spesso: fra una
-- settimana i reel tornano, in un altro modo. Quindi non si cabla "reel"
-- da nessuna parte — ci va un interruttore.
--
-- `smm_settings.tipi_fermi` e' la lista dei tipi in pausa. Un tipo in
-- pausa:
--
--   - non prende una data quando lo si approva. Resta in "approvato" e lo
--     dice, invece di sparire dal calendario senza spiegazioni;
--   - non esce, neanche se una data ce l'ha gia' da prima:
--     smm_programmati_in_scadenza lo salta.
--
-- Fermare la *creazione* non e' una terza regola: e' la riga di piano in
-- pausa — gli agenti lavorano su quello che il piano chiede — piu'
-- l'agente Video spento, che e' l'interruttore che c'era gia'.
--
-- I contenuti del tipo fermo non si buttano e non si nascondono: restano
-- dove sono. Quando il tipo riparte, si approvano e prendono una data come
-- tutti gli altri.
--
-- Qui c'e' solo il meccanismo. La decisione — quali tipi sono fermi oggi —
-- sta in 20261116_smm_reel_in_pausa.sql.
--
-- Reversibile: 20261116_smm_tipi_fermi_down.sql.

-- ── 1. La lista ─────────────────────────────────────────────────────────
alter table smm_settings
  add column if not exists tipi_fermi text[] not null default '{}';

comment on column smm_settings.tipi_fermi is
  'Tipi di contenuto in pausa: non prendono una data quando si approvano e non escono. Vuoto: esce tutto.';

-- ── 2. Approvare un tipo fermo non da' una data ─────────────────────────
create or replace function smm_programma_approvato() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  s             smm_settings;
  v_entra       boolean;
  v_firma_admin boolean;
begin
  v_entra := new.stato = 'approvato'
             and coalesce(old.stato, '') not in
                 ('approvato', 'in_calendario', 'programmato', 'pubblicato');
  v_firma_admin := new.stato = 'approvato'
                   and new.approvato_admin_at is not null
                   and old.approvato_admin_at is null;

  if not (v_entra or v_firma_admin) then return new; end if;
  if new.slot_at is not null then return new; end if;

  if not new.revisore_ok or new.approvato_da is null or new.approvato_at is null then
    return new;
  end if;

  select * into s from smm_settings where brand_id = new.brand_id;

  -- Il tipo e' in pausa: approvato si', in calendario no. Lo stato resta
  -- "approvato" ed e' l'interfaccia a spiegare perche' non ha una data.
  if found and new.tipo = any(s.tipi_fermi) then
    return new;
  end if;

  if found and s.doppia_approvazione
     and (new.sensibile or new.categoria = any(s.categorie_sensibili))
     and new.approvato_admin_da is null then
    return new;
  end if;

  new.slot_at := smm_prossimo_slot(new);
  new.stato   := 'in_calendario';
  return new;
end $$;

-- ── 3. E non esce, neanche se una data ce l'aveva gia' ──────────────────
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
       -- Un tipo in pausa non esce. Vale anche per chi era gia' in
       -- calendario da prima della pausa: e' il caso che conta, perche'
       -- quello e' il contenuto che uscirebbe stanotte senza che nessuno
       -- abbia fatto niente.
       and not exists (
         select 1 from smm_settings s
          where s.brand_id = c.brand_id
            and c.tipo = any(s.tipi_fermi))
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

-- La decisione di quali tipi fermare NON sta qui: e' un dato, non uno
-- schema. Sta in 20261116_smm_reel_in_pausa.sql, che il banco di prova non
-- rigioca — se no ogni ambiente nuovo nascerebbe coi reel spenti per
-- sempre, e i test proverebbero il piano di InDubai invece del motore.
