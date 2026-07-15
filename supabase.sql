-- =====================================================
--  stricklisel.app  ·  SubConstructor
--  Einmalig im Supabase SQL Editor ausführen.
--  (Supabase > dein Projekt > SQL Editor > New query > einfügen > Run)
-- =====================================================

create table if not exists rezepte (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name       text not null,
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);

-- ein Rezeptname pro Benutzer nur einmal (macht "speichern" zum Überschreiben)
create unique index if not exists rezepte_user_name_idx on rezepte (user_id, name);

-- Row Level Security: jeder sieht ausschließlich seine eigenen Rezepte.
-- Selbst wenn jemand den anon-key aus dem Quelltext zieht, kommt er hier nicht durch.
alter table rezepte enable row level security;

drop policy if exists "eigene rezepte" on rezepte;
create policy "eigene rezepte" on rezepte
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
