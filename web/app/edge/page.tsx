import { Fragment } from 'react';
import {
  getEdgeStats,
  getMatchNames,
  getOddsBoard,
  getOpenOpportunities,
  getPaperOrders,
  getVenueLinks,
  getWallet,
  type ArbLeg,
} from '@/lib/edge';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/**
 * Edge dashboard, written for a NON-technical audience: every number is explained, every
 * row reads as a plain sentence, and external "verify" links open the actual Polymarket
 * market. Web2 (HR books) ↔ Web3 (Polymarket) odds, +EV / arbitrage, dry-run bot ledger.
 * Reads Postgres directly (lib/edge.ts) — a local-dev view, independent of the KV snapshot.
 */

const od = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);

// short symbol for compact columns
const sel = (s: string | null) =>
  s == null ? '' : ({ home: '1', draw: 'X', away: '2', over: 'Over 2.5', under: 'Under 2.5' }[s] ?? s);

// plain-Croatian meaning of a selection
const selWord = (s: string | null) =>
  s == null
    ? ''
    : ({
        home: 'pobjeda domaćina',
        draw: 'neriješeno',
        away: 'pobjeda gosta',
        over: '3+ gola u utakmici (Over 2.5)',
        under: '0–2 gola u utakmici (Under 2.5)',
      }[s] ?? s);

const venueFallback: Record<string, string> = {
  polymarket: 'https://polymarket.com',
  kalshi: 'https://kalshi.com/markets/kxwcgame',
  supersport: 'https://www.supersport.hr/sport',
};

// card label / value typography (the .card-k/.card-v classes aren't in globals.css)
const kStyle: React.CSSProperties = {
  fontSize: '.78rem',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  opacity: 0.65,
  fontWeight: 600,
  marginBottom: 6,
};
const vStyle: React.CSSProperties = { fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 };

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link" style={{ whiteSpace: 'nowrap' }}>
      {children} ↗
    </a>
  );
}

export default async function EdgePage() {
  const [stats, wallet, opps, orders, board, names, links] = await Promise.all([
    getEdgeStats().catch(() => ({ quotes: 0, venues: 0 })),
    getWallet().catch(() => null),
    getOpenOpportunities().catch(() => []),
    getPaperOrders().catch(() => []),
    getOddsBoard().catch(() => []),
    getMatchNames().catch(() => new Map<number, { home: string; away: string }>()),
    getVenueLinks().catch(() => new Map<string, string>()),
  ]);

  const ev = opps.filter((o) => o.kind === 'ev');
  const arb = opps.filter((o) => o.kind === 'arb');
  const settled = orders.filter((o) => o.status === 'settled');
  const pnl = settled.reduce((s, o) => s + (o.pnl_usd ?? 0), 0);

  // venue columns: known venues first (stable order), then any others actually present
  const present = new Set(board.flatMap((b) => Object.keys(b.venues)));
  const known = ['polymarket', 'kalshi', 'supersport'];
  const venues = known
    .filter((v) => present.has(v))
    .concat([...present].filter((v) => !known.includes(v)));
  if (venues.length === 0) venues.push('polymarket');

  const fx = (id: number) => {
    const n = names.get(id);
    return n ? `${n.home} – ${n.away}` : `#${id}`;
  };
  const venueUrl = (venue: string, matchId: number) =>
    links.get(`${venue}:${matchId}`) ?? venueFallback[venue] ?? '#';

  return (
    <main className="container">
      <RealtimeRefresh table="edge_paper_order" />
      <h1>Edge — gdje se naša procjena razlikuje od tržišta</h1>
      <p className="muted">
        Uspoređujemo <strong>vlastiti model</strong> (Dixon-Coles, kao na stranici Prognoze) s
        time kako utakmice cijene <strong>tržišta predikcija</strong>: <strong>Polymarket</strong>{' '}
        (kripto/Web3) i <strong>Kalshi</strong> (regulirana američka burza). Kad se procjene jako
        razilaze, to je potencijalna prilika; kad se dva tržišta razilaze međusobno, moguća je
        arbitraža. <strong>Bot trguje lažnim novcem (dry-run)</strong> — ništa pravo se ne ulaže;
        ovo je eksperiment da vidimo je li model stvarno dobar prije nego išta riskiramo.
        (Hrvatske kladionice — SuperSport, PSK, Favbet, Germania, CroBet — priključujemo uskoro.)
      </p>

      {/* ── plain-language legend ───────────────────────────────────────────── */}
      <h2>Kako čitati ovu stranicu</h2>
      <div className="grid cols-2">
        <div className="card">
          <div style={kStyle}>Koeficijent (odds)</div>
          <div className="muted">
            Koliko platiš za 1€ uloga ako pogodiš. Koef. <strong>2.00</strong> = uloži 1€, dobiješ
            2€ (čista zarada 1€). Veći koef. = tržište smatra ishod manje vjerojatnim.
          </div>
        </div>
        <div className="card">
          <div style={kStyle}>Vjerojatnost</div>
          <div className="muted">
            Koeficijent pretvoren u postotak: <strong>1 ÷ koef.</strong> Koef. 2.00 → 50% šanse. Tako
            uspoređujemo „što misli model" i „što misli tržište" u istim jedinicama.
          </div>
        </div>
        <div className="card">
          <div style={kStyle}>Value / „+EV"</div>
          <div className="muted">
            Kad <strong>naš model daje veću šansu</strong> nego što tržište naplaćuje. Teoretski
            isplativo — ali samo ako je model u pravu. Veliki postotak = veliko neslaganje (oprez,
            model još uči).
          </div>
        </div>
        <div className="card">
          <div style={kStyle}>Arbitraža</div>
          <div className="muted">
            <strong>Zajamčen profit</strong> bez obzira na rezultat: kad su koeficijenti na raznim
            kladionicama takvi da, ako pokriješ sve ishode, sigurno zaradiš. Rijetko i kratko traje.
          </div>
        </div>
      </div>

      {/* ── status cards ────────────────────────────────────────────────────── */}
      <h2>Status bota</h2>
      <div className="grid cols-3">
        <div className="card">
          <div style={kStyle}>Lažni novčanik (dry-run)</div>
          <div style={vStyle}>{usd(wallet?.balance_usd ?? null)}</div>
          <div className="muted">
            početak {usd(wallet?.starting_usd ?? null)} · ostvareni rezultat{' '}
            <span className={pnl >= 0 ? 'delta up' : 'delta down'}>{usd(pnl)}</span>
          </div>
        </div>
        <div className="card">
          <div style={kStyle}>Otvorene prilike</div>
          <div style={vStyle}>
            {ev.length} value · {arb.length} arbitraža
          </div>
          <div className="muted">
            iz {stats.quotes} koeficijenata · {stats.venues} kladionica/tržišta
          </div>
        </div>
        <div className="card">
          <div style={kStyle}>Način rada</div>
          <div style={vStyle}>DRY-RUN</div>
          <div className="muted">{orders.length} simuliranih oklada — bez pravog novca</div>
        </div>
      </div>

      {/* ── arbitrage ───────────────────────────────────────────────────────── */}
      <h2>Arbitraža — zajamčen profit</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Utakmice gdje najbolji koeficijenti po ishodu (preko Polymarketa i Kalshija) daju zajamčenu
        zaradu ako pokriješ sve ishode. Klikni nogu za provjeru na tržištu.{' '}
        <strong>Oprez:</strong> Kalshi WC marketi su često tanki (cijena iz zadnje transakcije, ne
        live ponude) pa izvršivost zna varirati — detekcija je točna, ali provjeri likvidnost.
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              <th>Tržište</th>
              <th title="Zajamčena zarada ako se ulozi rasporede po nogama">Profit</th>
              <th style={{ textAlign: 'left' }}>Gdje i kako (klikni za provjeru)</th>
            </tr>
          </thead>
          <tbody>
            {arb.map((o) => {
              const legs = (Array.isArray(o.legs) ? o.legs : []) as ArbLeg[];
              return (
                <tr key={o.id}>
                  <td style={{ textAlign: 'left' }}>{fx(o.match_id)}</td>
                  <td>{o.market === '1x2' ? 'Pobjednik' : 'Golovi (2.5)'}</td>
                  <td className="delta up">+{(o.edge * 100).toFixed(2)}%</td>
                  <td style={{ textAlign: 'left' }}>
                    {legs.map((l, i) => {
                      const label = `${l.venue}: ${selWord(l.selection)} @ ${od(l.odds)} (uloži ${(l.stake_frac * 100).toFixed(0)}%)`;
                      return (
                        <span key={i}>
                          {i > 0 && <span className="muted"> · </span>}
                          <Ext href={venueUrl(l.venue, o.match_id)}>{label}</Ext>
                        </span>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
            {arb.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Trenutno nema arbitražnih prilika (treba ≥2 tržišta).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── value / +EV ─────────────────────────────────────────────────────── */}
      <h2>Value oklade — gdje model vidi priliku</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Redci gdje naš model daje veću šansu nego tržište. Svaki redak je objašnjen rečenicom.{' '}
        <strong>Oprez:</strong> jako veliki postotak znači da se model i tržište jako ne slažu — a
        tržište je obično u pravu na velikim koeficijentima, pa to češće znači da model još uči nego
        da je prilika stvarna. Zato i postoji dry-run.
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              <th style={{ textAlign: 'left' }}>Objašnjenje</th>
              <th title="Koliko Polymarket plaća za ovaj ishod">Koef.</th>
              <th title="Naš model: šansa za ovaj ishod">Model</th>
              <th title="Tržište: šansa za ovaj ishod (1 ÷ koeficijent)">Tržište</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ev.slice(0, 20).map((o) => {
              const marketP = o.decimal_odds ? 1 / o.decimal_odds : null;
              return (
                <tr key={o.id}>
                  <td style={{ textAlign: 'left' }}>{fx(o.match_id)}</td>
                  <td style={{ textAlign: 'left' }}>
                    Model daje <strong>{pct(o.model_prob)}</strong> za <em>{selWord(o.selection)}</em>, a{' '}
                    {o.venue_id ?? 'tržište'} ga cijeni na <strong>{pct(marketP)}</strong> (koef.{' '}
                    {od(o.decimal_odds)}).
                  </td>
                  <td>{od(o.decimal_odds)}</td>
                  <td className="delta up">{pct(o.model_prob)}</td>
                  <td className="muted">{pct(marketP)}</td>
                  <td>
                    <Ext href={venueUrl(o.venue_id ?? 'polymarket', o.match_id)}>Provjeri</Ext>
                  </td>
                </tr>
              );
            })}
            {ev.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nema otvorenih value prilika.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── cross-venue 1x2 board ───────────────────────────────────────────── */}
      <h2>Koeficijenti za pobjednika, po tržištu</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        <strong>1</strong> = domaćin, <strong>X</strong> = neriješeno, <strong>2</strong> = gost. Niži
        broj = veća šansa po tom tržištu.
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              {venues.map((v) => (
                <th key={v} colSpan={3}>
                  {v}
                </th>
              ))}
            </tr>
            <tr>
              <th></th>
              {venues.map((v) => (
                <Fragment key={v}>
                  <th title="domaćin">1</th>
                  <th title="neriješeno">X</th>
                  <th title="gost">2</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.slice(0, 30).map((b) => (
              <tr key={b.match_id}>
                <td style={{ textAlign: 'left' }}>
                  {links.get(`polymarket:${b.match_id}`) ?? links.get(`kalshi:${b.match_id}`) ? (
                    <Ext
                      href={
                        links.get(`polymarket:${b.match_id}`) ??
                        links.get(`kalshi:${b.match_id}`) ??
                        '#'
                      }
                    >
                      {b.home_name} – {b.away_name}
                    </Ext>
                  ) : (
                    <>
                      {b.home_name} – {b.away_name}
                    </>
                  )}
                </td>
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

      {/* ── paper-trade ledger ──────────────────────────────────────────────── */}
      <h2>Dnevnik simuliranih oklada (lažni novac)</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Svaka oklada koju je bot „odigrao" u dry-run načinu. <strong>Ulog</strong> = koliko bi se
        uložilo · <strong>Traženo → Stvarno</strong> = koeficijent koji smo htjeli i koji bismo
        realno dobili (razlika je trošak likvidnosti) · <strong>Rezultat</strong> = zarada/gubitak
        nakon što utakmica završi.
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Vrijeme</th>
              <th style={{ textAlign: 'left' }}>Utakmica</th>
              <th>Tržište</th>
              <th>Izbor</th>
              <th>Ulog</th>
              <th title="Koeficijent koji smo htjeli vs koji bismo realno dobili">Traženo → Stvarno</th>
              <th>Status</th>
              <th>Rezultat</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td style={{ textAlign: 'left' }} className="muted">
                  {new Date(o.placed_at).toLocaleString('hr-HR')}
                </td>
                <td style={{ textAlign: 'left' }}>{o.match_id ? fx(o.match_id) : '—'}</td>
                <td>{o.market === '1x2' ? 'Pobjednik' : 'Golovi'}</td>
                <td title={selWord(o.selection)}>{sel(o.selection)}</td>
                <td>{usd(o.stake_usd)}</td>
                <td>
                  {od(o.requested_odds)} → {od(o.sim_fill_odds)}
                </td>
                <td className="muted">{o.status === 'settled' ? 'završeno' : 'čeka rezultat'}</td>
                <td className={o.pnl_usd == null ? 'muted' : o.pnl_usd >= 0 ? 'delta up' : 'delta down'}>
                  {o.pnl_usd == null ? '—' : usd(o.pnl_usd)}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Još nema simuliranih oklada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 24, fontSize: '0.85em' }}>
        Eksperiment · lažni novac · podaci s Polymarketa (Gamma/CLOB). Vanjske poveznice otvaraju
        stvarno tržište radi provjere. Hrvatske kladionice se priključuju uskoro.
      </p>
    </main>
  );
}
