-- Edge layer: cross-venue odds (Web2 HR sportsbooks + Web3 Polymarket), +EV / arbitrage
-- detection, and a DRY-RUN paper-trading experiment. Mirrors the existing convention:
-- one writer (the fetcher), raw jsonb always preserved, parsed columns for SQL convenience,
-- public read like every other table (private MVP), RLS read-only.
--
-- Model: every venue's price is normalized into edge_quote (decimal odds + implied prob),
-- keyed to our own match(ss_id) once team-matched. The engine reads quotes + our model
-- predictions and writes edge_opportunity rows; the trader consumes those into
-- edge_paper_order rows against an edge_wallet (paper bankroll by default).

-- Venue registry: onchain = Polymarket, offchain = Croatian sportsbooks (+ sharp consensus).
create table if not exists public.edge_venue (
  id            text primary key,            -- 'polymarket' | 'supersport' | 'psk' | ...
  kind          text not null,               -- 'onchain' | 'offchain' | 'consensus'
  display_name  text not null,
  active        boolean not null default true,
  raw           jsonb,
  updated_at    timestamptz not null default now()
);

insert into public.edge_venue (id, kind, display_name) values
  ('polymarket', 'onchain',   'Polymarket'),
  ('supersport', 'offchain',  'SuperSport'),
  ('psk',        'offchain',  'PSK'),
  ('favbet',     'offchain',  'Favbet'),
  ('germania',   'offchain',  'Germania'),
  ('crobet',     'offchain',  'CroBet (Hrvatska Lutrija)'),
  ('pinnacle',   'consensus', 'Pinnacle (sharp consensus)')
on conflict (id) do nothing;

-- Latest normalized quote per (venue, external event, market, selection).
-- match_id is null until the event is team-matched to one of our WC fixtures.
-- market:    '1x2' | 'ou25'
-- selection: 'home' | 'draw' | 'away' | 'over' | 'under'
create table if not exists public.edge_quote (
  venue_id          text not null references public.edge_venue(id) on delete cascade,
  external_event_id text not null,           -- PM conditionId / book event id
  market            text not null,
  selection         text not null,
  match_id          bigint references public.match(ss_id) on delete set null,
  home_name         text,                    -- as named by the venue, for auditing the match
  away_name         text,
  start_ts          timestamptz,
  decimal_odds      double precision not null,
  implied_prob      double precision not null,  -- 1/decimal_odds (raw, includes overround/vig)
  fair_prob         double precision,           -- overround-removed within (venue,event,market)
  extra             jsonb,                       -- e.g. { tokenId, bestAsk, bidSize } for PM
  raw               jsonb,
  captured_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (venue_id, external_event_id, market, selection)
);
create index if not exists edge_quote_match_idx  on public.edge_quote(match_id);
create index if not exists edge_quote_market_idx on public.edge_quote(market, selection);

-- Detected opportunities. kind='ev' uses the per-selection columns; kind='arb' uses legs[].
create table if not exists public.edge_opportunity (
  id             bigint generated always as identity primary key,
  kind           text not null,              -- 'ev' | 'arb'
  match_id       bigint references public.match(ss_id) on delete cascade,
  market         text not null,
  selection      text,                       -- ev only
  venue_id       text references public.edge_venue(id),  -- ev only
  decimal_odds   double precision,           -- ev only
  model_prob     double precision,           -- ev: our model's fair prob for the selection
  model_version  text,                       -- ev: which prediction model sourced model_prob
  edge           double precision not null,  -- ev: model_prob*odds-1 ; arb: guaranteed profit frac
  kelly_fraction double precision,           -- ev only (fractional Kelly, capped)
  legs           jsonb,                      -- arb: [{venue,selection,odds,stake_frac}]
  status         text not null default 'open', -- 'open' | 'stale'
  detected_at    timestamptz not null default now(),
  raw            jsonb
);
create index if not exists edge_opp_match_idx on public.edge_opportunity(match_id, detected_at desc);
create index if not exists edge_opp_open_idx  on public.edge_opportunity(status, detected_at desc);

-- Paper (and, later, live) trades. DRY-RUN simulates a fill against the real order book.
create table if not exists public.edge_paper_order (
  id             bigint generated always as identity primary key,
  opportunity_id bigint references public.edge_opportunity(id) on delete set null,
  venue_id       text not null references public.edge_venue(id),
  match_id       bigint references public.match(ss_id) on delete set null,
  market         text not null,
  selection      text not null,
  side           text not null default 'buy',
  requested_odds double precision not null,
  model_prob     double precision,
  stake_usd      double precision not null,
  sim_fill_odds  double precision,           -- effective odds after walking the book
  sim_slippage   double precision,           -- requested_odds - sim_fill_odds
  sim_shares     double precision,           -- contracts/stake filled
  dry_run        boolean not null default true,
  status         text not null default 'simulated', -- 'simulated' | 'settled' | 'rejected'
  pnl_usd        double precision,           -- after settlement
  placed_at      timestamptz not null default now(),
  settled_at     timestamptz,
  raw            jsonb
);
create index if not exists edge_order_match_idx  on public.edge_paper_order(match_id);
create index if not exists edge_order_status_idx on public.edge_paper_order(status, placed_at desc);

-- Wallet / bankroll tracker. The 'paper' wallet is seeded once; the order ledger is the truth.
create table if not exists public.edge_wallet (
  id           text primary key,             -- 'paper' | 'live'
  kind         text not null,                -- 'paper' | 'live'
  balance_usd  double precision not null,
  starting_usd double precision not null,
  currency     text not null default 'USDC',
  updated_at   timestamptz not null default now()
);

-- public read like every other table; writes via direct Postgres only
grant select on public.edge_venue, public.edge_quote, public.edge_opportunity,
                public.edge_paper_order, public.edge_wallet to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['edge_venue','edge_quote','edge_opportunity','edge_paper_order','edge_wallet']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;
