import { Fragment } from 'react';
import {
  getEdgeStats,
  getMatchNames,
  getOddsBoard,
  getOpenOpportunities,
  getPaperOrders,
  getWallet,
  type ArbLeg,
} from '@/lib/edge';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/**
 * Edge dashboard — Web2 (HR books) ↔ Web3 (Polymarket) odds comparison, the live +EV /
 * arbitrage stream, dry-run bot status and the paper-trade ledger. Reads Postgres directly
 * (lib/edge.ts), so it's a local-dev view independent of the public KV snapshot.
 */

const od = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const sel = (s: string | null) =>
  s == null
    ? ''
    : ({ home: '1', draw: 'X', away: '2', over: 'Over 2.5', under: 'Under 2.5' }[s] ?? s);

export default async function EdgePage() {
  const [stats, wallet, opps, orders, board, names] = await Promise.all([
    getEdgeStats().catch(() => ({ quotes: 0, venues: 0 })),
    getWallet().catch(() => null),
    getOpenOpportunities().catch(() => []),
    getPaperOrders().catch(() => []),
    getOddsBoard().catch(() => []),
    getMatchNames().catch(() => new Map<number, { home: string; away: string }>()),
  ]);

  const ev = opps.filter((o) => o.kind === 'ev');
  const arb = opps.filter((o) => o.kind === 'arb');
  const fx = (id: number) => {
    const n = names.get(id);
    return n ? `${n.home} – ${n.away}` : `#${id}`;
  };
  const settled = orders.filter((o) => o.status === 'settled');
  const pnl = settled.reduce((s, o) => s + (o.pnl_usd ?? 0), 0);
  const venues = Object.keys(board[0]?.venues ?? { polymarket: 1 });

  return (
    <main className="container">
      <RealtimeRefresh table="edge_paper_order" />
      <h1>Edge — Web2 ↔ Web3</h1>
      <p className="muted">
        Usporedba hrvatskih kladionica (offchain) i Polymarketa (onchain), +EV / arbitraža
        protiv našeg <code>dixon-coles-v1</code> modela, te eksperiment automatiziranog
        otvaranja pozicija u <strong>dry-run</strong> načinu.
      </p>

      {/* status cards */}
      <div className="cards">
        <div className="card">
          <div className="card-k">Paper wallet</div>
          <div className="card-v">{usd(wallet?.balance_usd ?? null)}</div>
          <div className="muted">start {usd(wallet?.starting_usd ?? null)} · realiz. P&amp;L {usd(pnl)}</div>
        </div>
        <div className="card">
          <div className="card-k">Prilike (open)</div>
          <div className="card-v">{ev.length} +EV · {arb.length} arb</div>
          <div className="muted">{stats.quotes} quotes · {stats.venues} venue(a)</div>
        </div>
        <div className="card">
          <div className="card-k">Bot</div>
          <div className="card-v">DRY-RUN</div>
          <div className="muted">{orders.length} simuliranih pozicija</div>
        </div>
      </div>

      {/* arbitrage — locked-profit positions across venues */}
      <h2>Arbitraža (zajamčen profit)</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Utakmice gdje najbolji koeficijenti po ishodu daju Σ(1/odds) &lt; 1 — pokriješ sve
        ishode i profitiraš bez obzira na rezultat. Traži ≥2 venue-a; dok je samo Polymarket
        live, ovih je 0 (pojavit će se kad prorade HR kladionice).
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              <th>Tržište</th>
              <th>Profit</th>
              <th style={{ textAlign: 'left' }}>Noge (venue · izbor · odds · ulog%)</th>
            </tr>
          </thead>
          <tbody>
            {arb.map((o) => {
              const legs = (Array.isArray(o.legs) ? o.legs : []) as ArbLeg[];
              return (
                <tr key={o.id}>
                  <td style={{ textAlign: 'left' }}>{fx(o.match_id)}</td>
                  <td>{o.market}</td>
                  <td className="delta up">+{(o.edge * 100).toFixed(2)}%</td>
                  <td style={{ textAlign: 'left' }} className="muted">
                    {legs
                      .map((l) => `${l.venue}·${sel(l.selection)}·${od(l.odds)}·${(l.stake_frac * 100).toFixed(0)}%`)
                      .join('   |   ')}
                  </td>
                </tr>
              );
            })}
            {arb.length === 0 && (
              <tr><td colSpan={4} className="muted">Trenutno nema arbitražnih prilika.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* opportunities */}
      <h2>+EV prilike (model vs tržište)</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Edge = model_prob × odds − 1. Napomena: veliki edge ≈ neslaganje modela i tržišta;
        DC model je trenutno overconfident, zato je dry-run pravi test.
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              <th>Tržište</th>
              <th>Izbor</th>
              <th>Odds</th>
              <th>Model</th>
              <th>Edge</th>
              <th>Kelly</th>
            </tr>
          </thead>
          <tbody>
            {ev.slice(0, 20).map((o) => (
              <tr key={o.id}>
                <td style={{ textAlign: 'left' }}>{fx(o.match_id)}</td>
                <td>{o.market}</td>
                <td>{sel(o.selection)}</td>
                <td>{od(o.decimal_odds)}</td>
                <td>{o.model_prob == null ? '—' : `${(o.model_prob * 100).toFixed(0)}%`}</td>
                <td className="delta up">+{(o.edge * 100).toFixed(0)}%</td>
                <td className="muted">{o.kelly_fraction == null ? '—' : `${(o.kelly_fraction * 100).toFixed(1)}%`}</td>
              </tr>
            ))}
            {ev.length === 0 && (
              <tr><td colSpan={7} className="muted">Nema otvorenih +EV prilika.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* cross-venue 1x2 board */}
      <h2>1X2 odds po venue-u</h2>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              {venues.map((v) => (
                <th key={v} colSpan={3}>{v}</th>
              ))}
            </tr>
            <tr>
              <th></th>
              {venues.map((v) => (
                <Fragment key={v}>
                  <th>1</th>
                  <th>X</th>
                  <th>2</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.slice(0, 30).map((b) => (
              <tr key={b.match_id}>
                <td style={{ textAlign: 'left' }}>{b.home_name} – {b.away_name}</td>
                {venues.map((v) => (
                  <Fragment key={v}>
                    <td>{od(b.venues[v]?.home)}</td>
                    <td>{od(b.venues[v]?.draw)}</td>
                    <td>{od(b.venues[v]?.away)}</td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* paper-trade ledger */}
      <h2>Dnevnik simuliranih trgovina</h2>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Vrijeme</th>
              <th>Venue</th>
              <th>Tržište</th>
              <th>Izbor</th>
              <th>Ulog</th>
              <th>Req → Fill</th>
              <th>Status</th>
              <th>P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td style={{ textAlign: 'left' }} className="muted">
                  {new Date(o.placed_at).toLocaleString('hr-HR')}
                </td>
                <td>{o.venue_id}</td>
                <td>{o.market}</td>
                <td>{sel(o.selection)}</td>
                <td>{usd(o.stake_usd)}</td>
                <td>{od(o.requested_odds)} → {od(o.sim_fill_odds)}</td>
                <td className="muted">{o.status}</td>
                <td className={o.pnl_usd == null ? 'muted' : o.pnl_usd >= 0 ? 'delta up' : 'delta down'}>
                  {o.pnl_usd == null ? '—' : usd(o.pnl_usd)}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={8} className="muted">Još nema simuliranih trgovina.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
