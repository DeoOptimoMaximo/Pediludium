-- Add Kalshi (CFTC-regulated event-contract exchange, like Polymarket but not crypto) as a
-- second tradable venue. A real second venue is what makes cross-venue arbitrage possible.
insert into public.edge_venue (id, kind, display_name) values
  ('kalshi', 'exchange', 'Kalshi')
on conflict (id) do nothing;
