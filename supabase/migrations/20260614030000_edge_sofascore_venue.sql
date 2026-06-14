-- SofaScore as an odds venue. SofaScore's /api/v1 odds endpoint is challenge-blocked from
-- every egress we have, but Firecrawl can render the public match page and the SPA's featured
-- 1X2 odds land in the markdown (see fetcher/src/edge-sofascore-odds.ts). kind 'aggregator':
-- it relays a featured bookmaker's price rather than being a book/exchange/onchain venue.
insert into public.edge_venue (id, kind, display_name) values
  ('sofascore', 'aggregator', 'SofaScore (featured book)')
on conflict (id) do nothing;
