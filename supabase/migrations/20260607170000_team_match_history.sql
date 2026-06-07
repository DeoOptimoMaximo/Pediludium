-- Per-team historical results (denormalized) for the "team history" view.
-- Kept separate from public.match (WC2026 scope) so we don't need FK rows for the
-- many historical opponents/tournaments. One row per (tracked team, event). Idempotent.

create table if not exists public.team_match (
  id              bigint generated always as identity primary key,
  team_id         bigint not null references public.team(ss_id) on delete cascade,
  event_id        bigint not null,                 -- SofaScore event id
  start_ts        timestamptz,
  is_home         boolean,
  opponent_id     bigint,
  opponent_name   text,
  opponent_alpha2 text,
  team_score      int,
  opponent_score  int,
  result          char(1),                          -- 'W' | 'D' | 'L'
  tournament_id   bigint,
  tournament_name text,
  season_year     text,
  status_type     text,
  raw             jsonb,
  fetched_at      timestamptz not null default now(),
  unique (team_id, event_id)
);
create index if not exists team_match_team_idx on public.team_match (team_id, start_ts desc);
create index if not exists team_match_result_idx on public.team_match (team_id, result);

grant select on public.team_match to anon, authenticated;
alter table public.team_match enable row level security;
drop policy if exists team_match_read on public.team_match;
create policy team_match_read on public.team_match for select to anon, authenticated using (true);
