-- ArenaMaster: armazenamento chave → JSON no Supabase (rode UMA vez no SQL Editor do projeto).
-- Acesso só pelo servidor (service role). RLS ligado e sem políticas = ninguém acessa pela chave pública.
create table if not exists public.arena_kv (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz
);

create index if not exists arena_kv_expires_idx on public.arena_kv (expires_at) where expires_at is not null;

alter table public.arena_kv enable row level security;
revoke all on public.arena_kv from anon, authenticated;
