-- Pipeline board sui clienti: fasi configurabili + colonna sul cliente
-- Additiva e non distruttiva.

create table if not exists pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null default 0,
  color text default '#3b82f6',
  created_at timestamptz not null default now()
);

alter table pipeline_stages enable row level security;

drop policy if exists "auth read pipeline_stages" on pipeline_stages;
create policy "auth read pipeline_stages" on pipeline_stages
  for select using (auth.role() = 'authenticated');

drop policy if exists "auth insert pipeline_stages" on pipeline_stages;
create policy "auth insert pipeline_stages" on pipeline_stages
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "auth update pipeline_stages" on pipeline_stages;
create policy "auth update pipeline_stages" on pipeline_stages
  for update using (auth.role() = 'authenticated');

drop policy if exists "auth delete pipeline_stages" on pipeline_stages;
create policy "auth delete pipeline_stages" on pipeline_stages
  for delete using (auth.role() = 'authenticated');

-- Privilegi di tabella (le policy RLS da sole non bastano: senza GRANT il ruolo
-- authenticated riceve "permission denied for table pipeline_stages").
grant select, insert, update, delete on public.pipeline_stages to authenticated;
grant select on public.pipeline_stages to anon;
grant select, insert, update, delete on public.pipeline_stages to service_role;

-- In quale fase della pipeline si trova ogni cliente (null = non assegnato)
alter table clients add column if not exists pipeline_stage_id uuid
  references pipeline_stages(id) on delete set null;
create index if not exists idx_clients_pipeline_stage on clients(pipeline_stage_id);

-- Seed delle 6 fasi definite (solo se la tabella è ancora vuota)
insert into pipeline_stages (name, position, color)
select v.name, v.position, v.color from (values
  ('Cliente ha pagato',    1, '#22c55e'),
  ('In fase di firme',     2, '#eab308'),
  ('Società aperta',       3, '#3b82f6'),
  ('Società e visti ok',   4, '#8b5cf6'),
  ('Corporate tax',        5, '#f97316'),
  ('Avviare contabilità',  6, '#ef4444')
) as v(name, position, color)
where not exists (select 1 from pipeline_stages);
