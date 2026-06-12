-- Per-match enrichment from SofaScore (docs/02): team statistics (incl. xG), lineups
-- (incl. missing players), bookmaker odds, fan votes and the shotmap. One row per match,
-- raw payload always preserved; a few parsed columns for SQL convenience.
-- `status_at_fetch` records the match status when the row was last written, so the
-- enrich job can stop refetching once a match's data is final ('finished').

create table if not exists public.match_statistics (
  match_id         bigint primary key references public.match(ss_id) on delete cascade,
  status_at_fetch  text,
  xg_home          double precision,
  xg_away          double precision,
  possession_home  double precision,
  possession_away  double precision,
  shots_home       int,
  shots_away       int,
  shots_on_home    int,
  shots_on_away    int,
  raw              jsonb,
  fetched_at       timestamptz not null default now()
);

create table if not exists public.match_lineups (
  match_id         bigint primary key references public.match(ss_id) on delete cascade,
  status_at_fetch  text,
  confirmed        boolean,
  home_formation   text,
  away_formation   text,
  home_missing     jsonb,   -- missingPlayers extracted from raw (injuries/suspensions)
  away_missing     jsonb,
  raw              jsonb,
  fetched_at       timestamptz not null default now()
);

create table if not exists public.match_odds (
  match_id         bigint primary key references public.match(ss_id) on delete cascade,
  status_at_fetch  text,
  -- normalized implied probabilities from the 1X2 market (overround removed);
  -- pre-kickoff upserts mean the stored row converges to the closing odds
  imp_home         double precision,
  imp_draw         double precision,
  imp_away         double precision,
  raw              jsonb,
  fetched_at       timestamptz not null default now()
);

create table if not exists public.match_votes (
  match_id         bigint primary key references public.match(ss_id) on delete cascade,
  status_at_fetch  text,
  votes_home       bigint,
  votes_draw       bigint,
  votes_away       bigint,
  raw              jsonb,
  fetched_at       timestamptz not null default now()
);

create table if not exists public.match_shotmap (
  match_id         bigint primary key references public.match(ss_id) on delete cascade,
  status_at_fetch  text,
  raw              jsonb,   -- array of shots with coordinates + per-shot xg/xgot
  fetched_at       timestamptz not null default now()
);

-- public read like every other table (private MVP); writes via direct Postgres only
grant select on public.match_statistics, public.match_lineups, public.match_odds,
                public.match_votes, public.match_shotmap to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['match_statistics','match_lineups','match_odds','match_votes','match_shotmap']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;
