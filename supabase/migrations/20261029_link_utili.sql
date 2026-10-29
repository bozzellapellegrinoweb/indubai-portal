-- ============================================================
-- LINK UTILI — raccolta di strumenti e aree, modificabile dal portale
-- ============================================================
-- Sezione ADMIN → Link Utili. I link stanno nel database e non nel codice,
-- così se ne aggiungono senza un rilascio.
-- ============================================================

create table if not exists useful_links (
  id uuid primary key default gen_random_uuid(),
  titolo text not null,
  url text not null,                       -- completo (https://…) o interno (/pagina.html)
  descrizione text,
  categoria text not null default 'Strumenti',
  posizione integer not null default 0,
  attivo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table useful_links enable row level security;
create index if not exists idx_useful_links_ordine on useful_links(categoria, posizione);
grant all on useful_links to authenticated;

-- Lettura allo staff (esclude client, ambassador e commerciale): la pagina sta
-- in ADMIN, ma così il vincolo è già corretto se un giorno viene aperta.
drop policy if exists "staff legge useful_links" on useful_links;
create policy "staff legge useful_links" on useful_links
  for select using (auth.role() = 'authenticated' and is_portal_staff() and sees_financials());

-- Scrittura solo agli admin
drop policy if exists "admin gestisce useful_links" on useful_links;
create policy "admin gestisce useful_links" on useful_links
  for all using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

insert into useful_links (titolo, url, descrizione, categoria, posizione) values
  ('Scheda Testamento', 'https://portal.indubai.it/client-portal/testamento.html',
   'Scheda che il cliente compila per il testamento, con invio a PB TAX', 'Strumenti', 0),
  ('Social Manager', 'https://indubai-social-manager.vercel.app',
   'Gestione dei contenuti e delle pubblicazioni social', 'Strumenti', 1),
  ('Ambassador', '/ambassadors.html',
   'Segnalazioni, conversioni e commissioni degli ambassador', 'Aree del portale', 1),
  ('Portale Clienti', 'https://portal.indubai.it/client-portal/login.html',
   'Accesso con cui i clienti entrano nel loro spazio', 'Aree del portale', 2),
  ('Sito InDubai', 'https://www.indubai.it', 'Sito pubblico', 'Siti', 1)
on conflict do nothing;
