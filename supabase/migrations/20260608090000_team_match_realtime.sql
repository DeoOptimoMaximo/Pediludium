-- Add team_match to the realtime publication so the team history view updates live
-- when the fetcher upserts new results. Idempotent.
do $$
begin
  begin
    alter publication supabase_realtime add table public.team_match;
  exception when duplicate_object then null;
  end;
end $$;
