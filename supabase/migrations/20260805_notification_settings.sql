-- Configurazione notifiche email: on/off + destinatari per ruolo, per ogni evento.
-- + flag per-fase pipeline "avvisa quando un cliente entra". Additiva.

create table if not exists notification_settings (
  event_type text primary key,
  label      text not null,
  category   text not null default 'Generale',
  audience   text not null default 'staff',   -- 'staff' | 'user' | 'client'
  enabled    boolean not null default true,
  roles      text[] default '{admin,senior,mini_admin,junior,collaborator,staff}',
  position   integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table notification_settings enable row level security;

drop policy if exists "auth read notif_settings" on notification_settings;
create policy "auth read notif_settings" on notification_settings
  for select using (auth.role() = 'authenticated');
drop policy if exists "auth insert notif_settings" on notification_settings;
create policy "auth insert notif_settings" on notification_settings
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "auth update notif_settings" on notification_settings;
create policy "auth update notif_settings" on notification_settings
  for update using (auth.role() = 'authenticated');

grant select, insert, update, delete on public.notification_settings to authenticated;
grant select on public.notification_settings to anon;
grant select, insert, update, delete on public.notification_settings to service_role;

-- Flag per-fase: avvisa lo staff quando un cliente entra in questa fase
alter table pipeline_stages add column if not exists notify_on_enter boolean not null default false;

-- Seed degli eventi noti (idempotente)
insert into notification_settings (event_type, label, category, audience, position) values
  ('client_created',         'Nuovo cliente creato',                 'Clienti',    'staff',  10),
  ('client_welcome',         'Email di benvenuto al cliente',        'Clienti',    'client', 11),
  ('pipeline_stage',         'Cliente entra in una fase (Pipeline)', 'Pipeline',   'staff',  20),
  ('payment_failed',         'Pagamento fallito / scaduto',          'Pagamenti',  'staff',  30),
  ('vat_deadline',           'Scadenza VAT',                         'Compliance', 'staff',  40),
  ('ct_deadline',            'Scadenza Corporate Tax',               'Compliance', 'staff',  41),
  ('task_assigned',          'Task assegnata',                       'Task',       'user',   50),
  ('task_completed',         'Task completata',                      'Task',       'user',   51),
  ('task_completed_client',  'Task completata (avviso al cliente)',  'Task',       'client', 52),
  ('task_comment',           'Nuovo commento / risposta su task',    'Task',       'user',   53),
  ('board_new_post',         'Nuovo post in Bacheca',                'Bacheca',    'staff',  60),
  ('board_reply',            'Risposta a un commento in Bacheca',    'Bacheca',    'user',   61),
  ('board_mention',          'Menzione in Bacheca',                  'Bacheca',    'user',   62),
  ('leave_request_new',      'Nuova richiesta ferie/permesso',       'Ferie',      'staff',  70),
  ('leave_request_approved', 'Richiesta ferie approvata',            'Ferie',      'user',   71),
  ('leave_request_rejected', 'Richiesta ferie rifiutata',            'Ferie',      'user',   72),
  ('broadcast',              'Broadcast ai clienti',                 'Broadcast',  'client', 80),
  ('employee_report',        'Report attività dipendenti',           'Report',     'staff',  90)
on conflict (event_type) do nothing;

-- Allinea i destinatari al comportamento attuale del codice
update notification_settings set roles = '{admin,senior}' where event_type = 'leave_request_new';
update notification_settings set roles = null where audience in ('client','user');
