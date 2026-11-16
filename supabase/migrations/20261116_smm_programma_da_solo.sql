-- ═══════════════════════════════════════════════════════════════════════
--  Approvare vuol dire programmare
-- ═══════════════════════════════════════════════════════════════════════
--
-- Prima: si approvava un contenuto, finiva in "approvato", e poi bisognava
-- trascinarlo a mano su un giorno del calendario perche' uscisse. Due gesti
-- per una decisione sola, e il secondo si dimentica: in produzione c'erano
-- quattro contenuti approvati e mai programmati, fermi da giorni. Un
-- contenuto approvato che non esce non e' approvato, e' perso.
--
-- Adesso l'approvazione mette anche la data. Il posto lo decide il piano,
-- che e' il posto giusto: dice gia' quanti ne devono uscire, in che giorni
-- (`smm_piano.giorni`) e a che ora (`smm_piano.ora`).
--
-- La regola, in italiano:
--
--   1. si cerca la riga di piano che corrisponde al contenuto — stesso
--      tipo, e se la riga vincola pillar o categoria devono combaciare.
--      Fra piu' righe buone vince la piu' specifica;
--   2. i giorni sono quelli della riga; vuoto vuol dire tutti;
--   3. l'ora e' quella della riga, se no quella del brand
--      (`smm_settings.ora_uscita`), se no le 21:00 di Dubai — le 18:00 in
--      Italia, che e' il pubblico;
--   4. si prende il primo giorno buono da oggi in avanti in cui non c'e'
--      gia' un altro contenuto dello stesso tipo in calendario. Il piano
--      chiede una storia al giorno: due storie lo stesso giorno non sono
--      il piano;
--   5. se l'ora di oggi e' gia' passata si parte da domani.
--
-- Resta tutto spostabile: il calendario si trascina come prima, e togliere
-- un contenuto dal calendario lo riporta in "approvato" senza che venga
-- riprogrammato da solo — altrimenti non si potrebbe piu' toglierlo.
--
-- I presidi non si toccano: il Revisore e la firma umana valgono come
-- prima, e la pubblicazione resta bloccata dai trigger che ci sono gia'.
--
-- Reversibile: 20261116_smm_programma_da_solo_down.sql.

-- ── 1. L'ora predefinita del brand ──────────────────────────────────────
alter table smm_settings
  add column if not exists ora_uscita time not null default '21:00';

comment on column smm_settings.ora_uscita is
  'Ora di uscita predefinita, fuso di Dubai, quando la riga di piano non ne ha una sua. 21:00 a Dubai sono le 18:00 in Italia.';

-- ── 2. Dove va a finire un contenuto appena approvato ───────────────────
-- p_non_prima_di serve al ripescaggio in fondo a questo file: i contenuti
-- approvati giorni fa e mai programmati non devono uscire stasera tutti
-- insieme, mezz'ora dopo che qualcuno ha applicato una migrazione.
create or replace function smm_prossimo_slot(c smm_contents,
                                             p_non_prima_di date default null)
returns timestamptz
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_riga   smm_piano;
  v_giorni int[];
  v_ora    time;
  v_oggi   date;
  v_giorno date;
  v_quando timestamptz;
  i        int;
begin
  -- La riga di piano che gli corrisponde. L'ordine mette davanti la piu'
  -- specifica: una riga che vincola pillar e categoria dice piu' cose di
  -- una che accetta tutto, e quindi decide lei.
  select p.* into v_riga
    from smm_piano p
   where p.brand_id = c.brand_id
     and p.attivo
     and p.tipo = c.tipo
     and (cardinality(p.pillar) = 0 or c.pillar = any(p.pillar))
     and (cardinality(p.categorie) = 0 or c.categoria = any(p.categorie))
   order by cardinality(p.pillar) + cardinality(p.categorie) desc, p.ordine
   limit 1;

  -- Nessuna riga di piano: tutti i giorni vanno bene. Un contenuto senza
  -- piano e' comunque un contenuto approvato, e deve uscire.
  v_giorni := coalesce(nullif(v_riga.giorni, '{}'), array[1,2,3,4,5,6,7]);

  select s.ora_uscita into v_ora from smm_settings s where s.brand_id = c.brand_id;
  v_ora := coalesce(v_riga.ora, v_ora, '21:00'::time);

  v_oggi := greatest((now() at time zone 'Asia/Dubai')::date, coalesce(p_non_prima_di, '-infinity'::date));

  for i in 0..27 loop
    v_giorno := v_oggi + i;
    continue when not (extract(isodow from v_giorno)::int = any(v_giorni));

    v_quando := (v_giorno + v_ora) at time zone 'Asia/Dubai';
    -- Mai nel passato, e mai cosi' vicino da uscire prima che si riesca a
    -- cambiare idea: il cron delle uscite gira ogni cinque minuti.
    continue when v_quando <= now() + interval '10 minutes';

    -- Un giorno e' libero se non c'e' gia' un altro contenuto dello stesso
    -- tipo messo in calendario. Quello buttato non occupa niente.
    if not exists (
      select 1 from smm_contents x
       where x.brand_id = c.brand_id
         and x.id <> c.id
         and x.tipo = c.tipo
         and x.stato <> 'scartato'
         and x.slot_at is not null
         and (x.slot_at at time zone 'Asia/Dubai')::date = v_giorno
    ) then
      return v_quando;
    end if;
  end loop;

  -- Quattro settimane tutte piene: non dovrebbe succedere, ma una data
  -- lontana e' meglio di nessuna data. Senza slot il contenuto sparirebbe
  -- dal calendario e tornerebbe il problema di partenza.
  return ((v_oggi + 28) + v_ora) at time zone 'Asia/Dubai';
end $$;

comment on function smm_prossimo_slot(smm_contents, date) is
  'Il primo posto libero in calendario per un contenuto, secondo la sua riga di piano: giorni, ora, e un solo contenuto dello stesso tipo al giorno.';

-- ── 3. Il trigger: approvato significa in calendario ────────────────────
create or replace function smm_programma_approvato() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  s             smm_settings;
  v_entra       boolean;
  v_firma_admin boolean;
begin
  -- Due momenti, non uno:
  --  - il contenuto entra in "approvato" venendo da qualcos'altro;
  --  - oppure arriva la seconda firma su una categoria sensibile, che
  --    e' il momento in cui diventa davvero pubblicabile.
  -- Chi era gia' in calendario e torna in "approvato" NON rientra: e'
  -- il manager che lo sta togliendo dal calendario apposta.
  v_entra := new.stato = 'approvato'
             and coalesce(old.stato, '') not in
                 ('approvato', 'in_calendario', 'programmato', 'pubblicato');
  v_firma_admin := new.stato = 'approvato'
                   and new.approvato_admin_at is not null
                   and old.approvato_admin_at is null;

  if not (v_entra or v_firma_admin) then return new; end if;
  if new.slot_at is not null then return new; end if;

  -- Gli stessi requisiti della pubblicazione: se non e' pubblicabile non
  -- si programma, o il giorno dell'uscita si fermerebbe con un errore.
  if not new.revisore_ok or new.approvato_da is null or new.approvato_at is null then
    return new;
  end if;

  select * into s from smm_settings where brand_id = new.brand_id;
  if found and s.doppia_approvazione
     and (new.sensibile or new.categoria = any(s.categorie_sensibili))
     and new.approvato_admin_da is null then
    -- Aspetta l'amministratore. Quando firma, questo trigger riparte.
    return new;
  end if;

  new.slot_at := smm_prossimo_slot(new);
  new.stato   := 'in_calendario';
  return new;
end $$;

comment on function smm_programma_approvato() is
  'Approvare vuol dire programmare: mette slot_at e porta il contenuto in calendario.';

-- Il nome comincia per "zz" di proposito, e non e' un vezzo.
--
-- Postgres esegue i trigger dello stesso tipo in ordine di nome, e questo
-- cambia `stato` da "approvato" a "in_calendario". I presidi che guardano
-- `new.stato` — il Revisore e i termini vietati — devono vedere
-- "approvato", cioe' devono girare prima. Si chiamano tutti
-- trg_smm_guard_*, quindi qualunque nome dopo la "g" va bene e qualunque
-- nome prima rompe tutto in silenzio: con trg_smm_calendario, per dire, il
-- controllo sui termini vietati non vedrebbe piu' "approvato" e lascerebbe
-- passare "studio legale" in un contenuto approvato.
--
-- "zz" non e' il minimo indispensabile, e' il margine: cosi' resta vero
-- anche se domani qualcuno aggiunge un presidio con un nome diverso.
-- C'e' un test che lo verifica davvero — l'ho provato rinominando il
-- trigger: "i termini vietati fermano l'approvazione anche adesso che
-- programma da sola" fallisce con un nome che viene prima delle guardie.
drop trigger if exists trg_smm_zz_programma on smm_contents;
create trigger trg_smm_zz_programma before update on smm_contents
  for each row execute function smm_programma_approvato();

-- ── 4. I contenuti gia' approvati e mai messi in calendario ─────────────
-- Sono quelli che hanno fatto nascere questa migrazione: approvati e poi
-- dimenticati perche' il secondo gesto non e' stato fatto. Si programmano
-- adesso, uno per giorno per tipo come tutti gli altri — ma non oggi:
-- roba approvata giorni fa che esce stasera, senza che nessuno l'abbia
-- riletta, sarebbe una sorpresa, e una sorpresa su Instagram non si
-- riprende. Da domani in avanti, cosi' c'e' un giorno per toglierli dal
-- calendario.
-- Due modi di restare fermi, non uno:
--  - approvato e senza data, perche' nessuno l'ha trascinato;
--  - approvato CON una data, ma rimasto in "approvato": e'
--    smm_programmati_in_scadenza a pretendere lo stato "in_calendario", e
--    una data da sola non basta. In produzione ce n'era uno cosi', con
--    data 13 novembre e approvazione del 12: non e' mai uscito e non lo
--    diceva nessuno.
-- Una data gia' passata non si tiene: quel giorno non torna. Una data
-- futura invece resta com'e' — e' una scelta di chi l'ha messa.
do $$
-- r e' di tipo smm_contents, non record: smm_prossimo_slot vuole la riga
-- intera e un record generico non si lascia passare per quel tipo.
declare r smm_contents;
begin
  for r in
    select * from smm_contents
     where stato = 'approvato' and revisore_ok
       and approvato_da is not null and approvato_at is not null
     order by created_at
  loop
    if r.slot_at is not null and r.slot_at > now() + interval '10 minutes' then
      update smm_contents set stato = 'in_calendario' where id = r.id;
    else
      update smm_contents
         set slot_at = smm_prossimo_slot(r, (now() at time zone 'Asia/Dubai')::date + 1),
             stato   = 'in_calendario'
       where id = r.id;
    end if;
  end loop;
end $$;
