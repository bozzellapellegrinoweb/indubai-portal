-- ── BACHECA ─────────────────────────────────────────────────────────────────

create table if not exists board_posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references profiles(id) on delete cascade,
  title       text not null,
  body        text,
  file_url    text,
  file_name   text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists board_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references board_posts(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null,
  reply_to    uuid references board_comments(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Tabella menzioni (per notifiche @tag)
create table if not exists board_mentions (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references board_comments(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  notified    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique(comment_id, user_id)
);

-- RLS
alter table board_posts     enable row level security;
alter table board_comments  enable row level security;
alter table board_mentions  enable row level security;

drop policy if exists "board_posts_select"  on board_posts;
drop policy if exists "board_posts_insert"  on board_posts;
drop policy if exists "board_posts_update"  on board_posts;
drop policy if exists "board_posts_delete"  on board_posts;

create policy "board_posts_select" on board_posts
  for select using (auth.role() = 'authenticated');

create policy "board_posts_insert" on board_posts
  for insert with check (auth.uid() = author_id);

create policy "board_posts_update" on board_posts
  for update using (
    auth.uid() = author_id
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "board_posts_delete" on board_posts
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "board_comments_select" on board_comments;
drop policy if exists "board_comments_insert" on board_comments;
drop policy if exists "board_comments_delete" on board_comments;

create policy "board_comments_select" on board_comments
  for select using (auth.role() = 'authenticated');

create policy "board_comments_insert" on board_comments
  for insert with check (auth.uid() = author_id);

create policy "board_comments_delete" on board_comments
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "board_mentions_select" on board_mentions;
drop policy if exists "board_mentions_insert" on board_mentions;

create policy "board_mentions_select" on board_mentions
  for select using (auth.role() = 'authenticated');

create policy "board_mentions_insert" on board_mentions
  for insert with check (auth.role() = 'authenticated');

-- Trigger updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_board_posts_updated_at on board_posts;
create trigger trg_board_posts_updated_at
  before update on board_posts
  for each row execute function set_updated_at();

-- Indici
create index if not exists idx_board_posts_created    on board_posts(created_at desc);
create index if not exists idx_board_comments_post    on board_comments(post_id, created_at asc);
create index if not exists idx_board_mentions_user    on board_mentions(user_id);
