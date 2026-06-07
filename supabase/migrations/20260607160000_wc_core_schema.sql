-- Pediludium core schema — generic, SofaScore-compatible, extensible.
-- Tables are league-agnostic; World Cup 2026 is applied as a SCOPE FILTER (season_id),
-- never hardcoded into the schema. Idempotent (safe to re-run / db reset).

create extension if not exists "pgcrypto";

-- ── Reference: tournament / season / team ────────────────────────────
create table if not exists public.tournament (
  ss_id          bigint primary key,            -- SofaScore unique-tournament id
  slug           text,
  name           text,
  category_id    bigint,
  category_slug  text,
  raw            jsonb,
  fetched_at     timestamptz not null default now()
);

create table if not exists public.season (
  ss_id          bigint primary key,            -- SofaScore season id
  tournament_id  bigint not null references public.tournament(ss_id) on delete cascade,
  year           text,
  name           text,
  raw            jsonb,
  fetched_at     timestamptz not null default now()
);
create index if not exists season_tournament_idx on public.season(tournament_id);

create table if not exists public.team (
  ss_id          bigint primary key,            -- SofaScore team id
  slug           text,
  name           text,
  short_name     text,
  country_alpha2 text,
  is_national    boolean default false,
  raw            jsonb,
  fetched_at     timestamptz not null default now()
);

-- ── Match (event) ────────────────────────────────────────────────────
create table if not exists public.match (
  ss_id          bigint primary key,            -- SofaScore event id
  tournament_id  bigint references public.tournament(ss_id) on delete set null,
  season_id      bigint references public.season(ss_id) on delete set null,
  home_team_id   bigint references public.team(ss_id) on delete set null,
  away_team_id   bigint references public.team(ss_id) on delete set null,
  start_ts       timestamptz,
  status_type    text,                          -- notstarted | inprogress | finished
  status_code    int,
  winner_code    int,                           -- 1 home, 2 away, 3 draw
  home_score     int,
  away_score     int,
  home_score_ht  int,
  away_score_ht  int,
  round          int,
  round_name     text,
  group_name     text,
  raw            jsonb,
  fetched_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists match_season_idx on public.match(season_id);
create index if not exists match_start_idx  on public.match(start_ts);
create index if not exists match_status_idx on public.match(status_type);
create index if not exists match_home_idx   on public.match(home_team_id);
create index if not exists match_away_idx   on public.match(away_team_id);

-- ── Standings (group tables) ─────────────────────────────────────────
create table if not exists public.standing (
  id             bigint generated always as identity primary key,
  season_id      bigint not null references public.season(ss_id) on delete cascade,
  group_name     text,
  team_id        bigint references public.team(ss_id) on delete set null,
  position       int,
  played         int,
  wins           int,
  draws          int,
  losses         int,
  goals_for      int,
  goals_against  int,
  points         int,
  raw            jsonb,
  fetched_at     timestamptz not null default now(),
  unique (season_id, group_name, team_id)
);
create index if not exists standing_season_idx on public.standing(season_id);

-- ── Team ratings (Elo etc.) ──────────────────────────────────────────
create table if not exists public.team_rating (
  id          bigint generated always as identity primary key,
  team_id     bigint not null references public.team(ss_id) on delete cascade,
  model       text not null default 'elo',
  rating      double precision not null,
  as_of       timestamptz not null default now(),
  unique (team_id, model, as_of)
);

-- ── Predictions ──────────────────────────────────────────────────────
create table if not exists public.prediction (
  id              bigint generated always as identity primary key,
  match_id        bigint not null references public.match(ss_id) on delete cascade,
  model_version   text not null,
  p_home          double precision,
  p_draw          double precision,
  p_away          double precision,
  exp_home_goals  double precision,
  exp_away_goals  double precision,
  -- TODO(advanced): add fields for richer models — e.g. xg-based lambdas,
  -- form/rest/travel features, market-odds-implied probs, model confidence/interval.
  created_at      timestamptz not null default now(),
  unique (match_id, model_version)
);
create index if not exists prediction_match_idx on public.prediction(match_id);

-- ── updated_at trigger for match ─────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists match_touch on public.match;
create trigger match_touch before update on public.match
  for each row execute function public.touch_updated_at();

-- ── Grants + RLS: public read (private MVP app); writes via service_role ─
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tournament','season','team','match','standing','team_rating','prediction']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- ── Realtime: stream live match + prediction updates ─────────────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  begin alter publication supabase_realtime add table public.match;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.prediction; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.standing;   exception when duplicate_object then null; end;
end $$;

-- ── Convenience view: WC2026 lens (scope filter, schema stays generic) ─
create or replace view public.wc2026_match as
  select m.*,
         ht.name as home_name, ht.short_name as home_short, ht.country_alpha2 as home_alpha2,
         at.name as away_name, at.short_name as away_short, at.country_alpha2 as away_alpha2
  from public.match m
  left join public.team ht on ht.ss_id = m.home_team_id
  left join public.team at on at.ss_id = m.away_team_id
  where m.season_id = 58210;   -- WC2026 season id (resolved live 2026-06-07)
