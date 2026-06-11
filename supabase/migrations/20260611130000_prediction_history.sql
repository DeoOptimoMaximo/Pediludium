-- Append-only time series of model outputs. `prediction` and `tournament_simulation`
-- are "latest" tables (upserted, history overwritten); these capture every hourly
-- pipeline tick so we can chart how probabilities evolve and backtest calibration
-- (Brier / log-loss) once results are in. Rows are only ever inserted — captured_at
-- is part of the unique key, so re-running record/backfill is idempotent.

create table if not exists public.prediction_history (
  id              bigint generated always as identity primary key,
  match_id        bigint not null references public.match(ss_id) on delete cascade,
  model_version   text not null,
  captured_at     timestamptz not null,
  p_home          double precision,
  p_draw          double precision,
  p_away          double precision,
  exp_home_goals  double precision,
  exp_away_goals  double precision,
  unique (match_id, model_version, captured_at)
);
create index if not exists prediction_history_match_idx
  on public.prediction_history(match_id, model_version, captured_at);

create table if not exists public.simulation_history (
  id                bigint generated always as identity primary key,
  season_id         bigint not null,
  team_id           bigint not null references public.team(ss_id) on delete cascade,
  model_version     text not null,
  captured_at       timestamptz not null,
  exp_group_points  double precision,
  p_win_group       double precision,
  p_advance         double precision,
  p_sf              double precision,
  p_final           double precision,
  p_win_cup         double precision,
  unique (team_id, model_version, captured_at)
);
create index if not exists simulation_history_team_idx
  on public.simulation_history(team_id, model_version, captured_at);

-- public read like every other table (private MVP); writes via direct Postgres only
grant select on public.prediction_history, public.simulation_history to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['prediction_history','simulation_history']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;
