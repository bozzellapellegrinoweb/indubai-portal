-- ============================================================
-- Chloe InDubai — anagrafica dipendente (Ferie & Permessi)
-- Il profilo esisteva già ma mancava la riga in `employees`,
-- che è la fonte dati della pagina ferie.html: senza di essa
-- la dipendente non compariva né in KPI, né nelle card, né nel
-- calendario assenze.
-- Inizio contratto: 01/07/2026 · 30 giorni ferie/anno (UAE)
-- ============================================================

insert into employees (profile_id, start_date, annual_leave_days)
select id, date '2026-07-01', 30
from profiles
where full_name = 'Chloe InDubai'
on conflict (profile_id) do update
  set start_date        = excluded.start_date,
      annual_leave_days = excluded.annual_leave_days;
