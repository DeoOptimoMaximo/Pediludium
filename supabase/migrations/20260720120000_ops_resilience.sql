-- Operational resilience (docs/21 §2).
--
-- The 2026-06-18 → 2026-07-18 forensics found EIGHTEEN separate Postgres outages (the longest
-- ~6 days, from 2026-07-09) during which every launchd tick still exited 0: the gates treat an
-- unreachable DB as "skip" (a deliberate fail-safe so a dead DB can't burn Firecrawl credits),
-- so nothing anywhere went red. Two tables close the two holes that made it invisible and
-- unrecoverable:
--
--   ops_heartbeat       — when each pipeline stage last SUCCEEDED. Without it "is the system
--                         healthy?" had no answer that survived the DB being down and back up:
--                         match.fetched_at only tells us about matches that changed.
--   match_sync_attempt  — per-match check bookkeeping. The old sync window was wall-clock
--                         ([now-18h, now+15m]), so matches played during an outage fell out of
--                         the window before the DB returned and were never re-checked (the
--                         2× R16 + 3× QF holes). Catch-up needs to ask "which matches are still
--                         unresolved?", and then needs a backoff so a permanently stranded match
--                         doesn't scrape Firecrawl every 15 minutes forever.

create table if not exists public.ops_heartbeat (
  key         text primary key,           -- 'refresh:fc', 'snapshot', 'health', …
  at          timestamptz not null default now(),
  ok          boolean not null default true,
  detail      jsonb
);

comment on table public.ops_heartbeat is
  'Last successful (or failed) run per pipeline stage — read by src/health.ts (docs/21 §2A).';

create table if not exists public.match_sync_attempt (
  match_id        bigint primary key references public.match(ss_id) on delete cascade,
  attempts        int not null default 0, -- consecutive checks that did NOT resolve the match
  last_attempt_at timestamptz,
  last_status     text,                   -- what the scrape reported: notstarted/inprogress/error
  next_check_at   timestamptz             -- backoff: not eligible again before this
);

comment on table public.match_sync_attempt is
  'Per-match Firecrawl check bookkeeping driving the escalating backoff in src/ops.ts (docs/21 §2B).';

-- The catch-up query filters on next_check_at for the handful of unfinished matches; the PK
-- covers lookups, this covers the "who is due?" scan.
create index if not exists match_sync_attempt_next_check_idx
  on public.match_sync_attempt (next_check_at);
