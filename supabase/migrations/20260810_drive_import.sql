-- Import automatico clienti da cartelle Google Drive. Additiva.

-- Collegamento cliente ↔ cartella Drive (chiave anti-duplicato)
alter table clients add column if not exists drive_folder_id text;
create unique index if not exists uq_clients_drive_folder_id
  on clients(drive_folder_id) where drive_folder_id is not null;

-- Config privata (segreti integrazioni). Nessuna policy => leggibile solo da service_role.
create table if not exists app_config (
  key   text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;  -- nessuna policy: anon/authenticated NON leggono
grant select, insert, update, delete on public.app_config to service_role;

-- Segreto condiviso per la Edge Function drive-import-client.
-- NB: impostare il valore reale a mano (non committare il segreto vero nel repo):
--   update app_config set value = '<SEGRETO>' where key = 'drive_import_secret';
insert into app_config(key, value) values ('drive_import_secret', 'REPLACE_WITH_SECRET')
on conflict (key) do nothing;

-- Il trigger handle_new_client() inserisce in onboarding_checklist al create di un cliente:
-- serve il grant per il service_role usato dalla Edge Function.
grant select, insert, update, delete on public.onboarding_checklist to service_role;
