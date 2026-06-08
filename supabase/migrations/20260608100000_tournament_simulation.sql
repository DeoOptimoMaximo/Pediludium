-- Monte-Carlo tournament simulation output (docs/08 #5, docs/13).
-- One row per (season, team, model_version): advance / round-reach / win-cup probabilities
-- plus expected group points. Generic & versioned like prediction — many sims can coexist.
-- Computed entirely from our own match + prediction data (no SofaScore calls). Idempotent.

create table if not exists public.tournament_simulation (
  id                bigint generated always as identity primary key,
  season_id         bigint not null references public.season(ss_id) on delete cascade,
  team_id           bigint not null references public.team(ss_id) on delete cascade,
  model_version     text not null,
  iterations        int,
  -- group stage
  exp_group_points  double precision,
  p_win_group       double precision,   -- finish 1st in group
  p_runner_up       double precision,   -- finish 2nd
  p_third           double precision,   -- finish 3rd (best-third pool)
  p_advance         double precision,   -- reach Round of 32 (top-2 OR qualifying best-third)
  -- knockout reach probabilities
  p_r16             double precision,   -- reach Round of 16
  p_qf              double precision,   -- reach Quarterfinals
  p_sf              double precision,   -- reach Semifinals
  p_final           double precision,   -- reach Final
  p_win_cup         double precision,   -- lift the trophy
  updated_at        timestamptz not null default now(),
  unique (season_id, team_id, model_version)
);
create index if not exists tournament_simulation_season_idx
  on public.tournament_simulation(season_id, model_version);

grant select on public.tournament_simulation to anon, authenticated;
alter table public.tournament_simulation enable row level security;
drop policy if exists tournament_simulation_read on public.tournament_simulation;
create policy tournament_simulation_read on public.tournament_simulation
  for select to anon, authenticated using (true);

-- Realtime: forecast refreshes in the UI the moment a new simulation lands.
do $$
begin
  begin
    alter publication supabase_realtime add table public.tournament_simulation;
  exception when duplicate_object then null;
  end;
end $$;
