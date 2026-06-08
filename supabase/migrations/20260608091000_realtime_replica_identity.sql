-- Filtered realtime DELETE events (e.g. team_id=eq.X) only match if the OLD record carries
-- the filtered column. Default replica identity ships just the PK on delete, so set FULL on
-- the tables that get *filtered* realtime subscriptions. Idempotent.
alter table public.match replica identity full;
alter table public.team_match replica identity full;
