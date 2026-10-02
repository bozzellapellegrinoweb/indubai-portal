-- ============================================================
-- RUOLO COMMERCIALE
-- ============================================================
-- Lavora i clienti che gli vengono assegnati e non vede i dati economici
-- dello studio. Due livelli, distinti e con garanzie diverse:
--
--   RIGHE   → applicate dal database (RLS). Non aggirabili: valgono anche
--             chiamando l'API a mano con il suo token.
--   COLONNE → `clients.service_cost` e `subscription_day` restano leggibili
--             per i SUOI clienti se costruisce la richiesta a mano. Le pagine
--             non li chiedono nemmeno al server, ma non è una barriera.
--             Per chiuderla servirebbe spostare quei campi in una tabella
--             separata con RLS propria.
-- ============================================================

-- Ruoli mancanti nell'enum. 'collaborator' era già offerto dal menu di
-- users.html ma non esisteva: assegnarlo faceva fallire il salvataggio.
alter type user_role add value if not exists 'commerciale';
alter type user_role add value if not exists 'collaborator';

-- ── Helper ───────────────────────────────────────────────────
-- Volutamente NON escludono 'client' e 'ambassador': hanno portali propri
-- che leggono alcune di queste tabelle.
create or replace function public.is_commerciale()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'commerciale');
$$;

create or replace function public.sees_financials()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select not exists (select 1 from profiles where id = auth.uid() and role = 'commerciale');
$$;

grant execute on function public.is_commerciale()  to authenticated;
grant execute on function public.sees_financials() to authenticated;

-- ── Tabelle economiche: invisibili al commerciale ────────────
-- Erano tutte "Authenticated users full access": qualunque utente autenticato
-- poteva leggere l'intero storico pagamenti, fatturato e estratti conto.
alter policy "Authenticated users full access subscription_payments" on subscription_payments
  using (auth.role() = 'authenticated' and sees_financials());
alter policy "Authenticated users full access vat_register" on vat_register
  using (auth.role() = 'authenticated' and sees_financials());
alter policy "Authenticated users full access corporate_tax" on corporate_tax
  using (auth.role() = 'authenticated' and sees_financials());
alter policy "Authenticated users full access bank_statements" on bank_statements
  using (auth.role() = 'authenticated' and sees_financials());
alter policy "auth read client_expenses" on client_expenses
  using (auth.role() = 'authenticated' and sees_financials());

-- zoho_snapshots contiene rolling12_aed e total_billed_aed: è il fatturato
-- dei clienti, non solo una soglia VAT.
alter policy "authenticated_read"   on zoho_snapshots using (sees_financials());
alter policy "rls_zoho_snapshots"   on zoho_snapshots using (sees_financials());

-- is_portal_staff() è vero anche per il commerciale: da solo non bastava.
alter policy "read ambassador_commissions" on ambassador_commissions
  using ((is_portal_staff() and sees_financials()) or (ambassador_id = current_ambassador_id()));
alter policy "staff write ambassador_commissions" on ambassador_commissions
  using (is_portal_staff() and sees_financials());

-- ── Task: solo le sue o dei clienti che gestisce ─────────────
-- Altrimenti dai titoli delle task vedrebbe i clienti che non sono suoi.
-- La sottoquery su clients è a sua volta filtrata da RLS.
alter policy "auth tasks" on tasks
  using (
    auth.role() = 'authenticated'
    and (
      not is_commerciale()
      or assigned_to = auth.uid()
      or created_by  = auth.uid()
      or client_id in (select c.id from clients c)
    )
  );

alter policy "auth task_comments" on task_comments
  using (
    auth.role() = 'authenticated'
    and (not is_commerciale() or task_id in (select t.id from tasks t))
  );
