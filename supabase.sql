-- =====================================================
--  stricklisel.app  ·  SubConstructor
--  Einmalig im Supabase SQL Editor ausführen.
-- =====================================================

create table if not exists programme (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name       text not null,
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);

-- ein Programmname pro Benutzer nur einmal ("speichern" = überschreiben)
create unique index if not exists programme_user_name_idx on programme (user_id, name);

-- Row Level Security: jeder sieht ausschließlich seine eigenen Programme.
alter table programme enable row level security;

drop policy if exists "eigene programme" on programme;
create policy "eigene programme" on programme
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
