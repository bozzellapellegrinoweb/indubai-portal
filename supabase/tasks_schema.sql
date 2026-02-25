-- ============================================================
-- TASKS & NOTIFICATIONS
-- ============================================================

-- Tasks table
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  
  -- Relazioni
  client_id uuid references clients(id) on delete set null,
  created_by uuid not null references profiles(id),
  assigned_to uuid references profiles(id),
  
  -- Status
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  
  -- Categoria
  category text default 'generale' check (category in ('generale', 'vat', 'corporate_tax', 'onboarding', 'estratti', 'pagamenti', 'altro')),
  
  -- Scadenza
  due_date date,
  completed_at timestamptz,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tasks enable row level security;
drop policy if exists "Authenticated full access tasks" on tasks;
create policy "Authenticated full access tasks" on tasks
  for all using (auth.role() = 'authenticated');

-- Task comments (thread)
create table if not exists task_comments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references profiles(id),
  content text not null,
  created_at timestamptz not null default now()
);

alter table task_comments enable row level security;
drop policy if exists "Authenticated full access task_comments" on task_comments;
create policy "Authenticated full access task_comments" on task_comments
  for all using (auth.role() = 'authenticated');

-- Notifications
create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  
  -- Contenuto
  type text not null, -- 'task_assigned', 'task_comment', 'task_completed', 'vat_deadline', 'payment_failed', 'statement_missing'
  title text not null,
  body text,
  
  -- Link
  link text, -- es. '/tasks.html?id=xxx' o '/vat.html'
  entity_type text, -- 'task', 'client', 'vat'
  entity_id uuid,
  
  -- Status
  read boolean default false,
  
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;
drop policy if exists "Users see own notifications" on notifications;
create policy "Users see own notifications" on notifications
  for all using (auth.uid() = user_id);

-- Indexes
create index if not exists idx_tasks_assigned_to on tasks(assigned_to);
create index if not exists idx_tasks_client on tasks(client_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_task_comments_task on task_comments(task_id);
create index if not exists idx_notifications_user on notifications(user_id);
create index if not exists idx_notifications_unread on notifications(user_id, read) where read = false;

-- Triggers
drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at before update on tasks
  for each row execute function update_updated_at();

-- Grant permissions
grant all on tasks to authenticated;
grant all on task_comments to authenticated;
grant all on notifications to authenticated;
