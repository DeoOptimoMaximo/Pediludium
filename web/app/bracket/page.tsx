import Link from 'next/link';
import { getMatches, getPredictions } from '@/lib/data';
import { flag, fmtDay, fmtTime, isLive } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { DC_MODEL, type WcMatch } from '@/lib/types';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/**
 * Knockout bracket — a left-to-right funnel (Round of 32 → 16 → quarters → semis → final),
 * with the third-place play-off shown alongside the final. SofaScore's chronological
 * match-numbering within each round (73-88 R32, 89-96 R16, … see fetcher/simulate.ts) plus
 * each tie's `W{n}` feeder placeholders reconstruct the tree, so every match sits vertically
 * between the two it draws from — the columns halve down the page into the funnel shape.
 */

const COLUMNS = [
  { round: 6, key: 'r32' as const },
  { round: 5, key: 'r16' as const },
  { round: 27, key: 'qf' as const },
  { round: 28, key: 'sf' as const },
  { round: 29, key: 'final' as const },
];
const THIRD_ROUND = 50;
// FIFA match-number start per round (mirrors fetcher/src/simulate.ts ROUND_NUM_START).
const NUM_START: Record<number, number> = { 6: 73, 5: 89, 27: 97, 28: 101, 29: 103, 50: 104 };
const FINAL_NUM = 103;

/** A real qualifier carries a 2-letter country code; placeholder slots (W73, 1A, 3A/3B…) don't. */
function isReal(m: WcMatch, side: 'home' | 'away'): boolean {
  const a2 = side === 'home' ? m.home_alpha2 : m.away_alpha2;
  return !!a2 && /^[A-Za-z]{2}$/.test(a2);
}

/** Feeder match number for a `W{n}`/`L{n}` placeholder slot, else null (a resolved/group slot). */
function feederNum(name: string | null): number | null {
  const mt = /^[WL](\d+)$/.exec((name ?? '').trim().toUpperCase());
  return mt ? Number(mt[1]) : null;
}

export default async function BracketPage() {
  const [{ lang, t }, matches, preds] = await Promise.all([
    getDict(),
    getMatches(),
    getPredictions(DC_MODEL),
  ]);
  const tb = t.bracket;

  // ── number every knockout match within its round by kickoff, like the simulator does ──
  const byNum = new Map<number, WcMatch>();
  const byRound = new Map<number, WcMatch[]>();
  const ko = matches.filter((m) => m.round != null && NUM_START[m.round] != null);
  for (const round of Object.keys(NUM_START).map(Number)) {
    const ms = ko
      .filter((m) => m.round === round)
      .sort((a, b) => (a.start_ts ?? '').localeCompare(b.start_ts ?? ''));
    ms.forEach((m, i) => byNum.set(NUM_START[round]! + i, m));
    byRound.set(round, ms);
  }
  const numOf = new Map<number, number>(); // ss_id → bracket number
  for (const [num, m] of byNum) numOf.set(m.ss_id, num);

  // ── vertical position: leaves (R32) take their depth-first order; a tie sits at the mean
  //    of its two feeders, so every round stays aligned under the round that feeds it ──
  const yPos = new Map<number, number>();
  let leaf = 0;
  const layout = (num: number): void => {
    const m = byNum.get(num);
    if (!m) return;
    const fa = feederNum(m.home_name);
    const fb = feederNum(m.away_name);
    if (fa == null && fb == null) {
      yPos.set(num, leaf++);
      return;
    }
    if (fa != null) layout(fa);
    if (fb != null) layout(fb);
    const ys = [fa, fb].filter((x): x is number => x != null).map((x) => yPos.get(x) ?? 0);
    yPos.set(num, ys.reduce((s, v) => s + v, 0) / (ys.length || 1));
  };
  layout(FINAL_NUM);
  const ordered = (round: number): WcMatch[] =>
    [...(byRound.get(round) ?? [])].sort(
      (a, b) => (yPos.get(numOf.get(a.ss_id)!) ?? 0) - (yPos.get(numOf.get(b.ss_id)!) ?? 0),
    );

  // ── one team slot: resolved → flag + name; otherwise "winner of A/B" when the feeder tie
  //    is itself resolved, else a muted placeholder ──
  function Slot({ m, side }: { m: WcMatch; side: 'home' | 'away' }) {
    const name = side === 'home' ? m.home_name : m.away_name;
    const short = side === 'home' ? m.home_short : m.away_short;
    const a2 = side === 'home' ? m.home_alpha2 : m.away_alpha2;
    const finished = m.status_type === 'finished';
    const won = finished && m.winner_code === (side === 'home' ? 1 : 2);
    const lost = finished && m.winner_code === (side === 'home' ? 2 : 1);
    const score = side === 'home' ? m.home_score : m.away_score;

    if (isReal(m, side)) {
      return (
        <span className={`br-slot${won ? ' win' : ''}${lost ? ' lost' : ''}`}>
          <span className="flag">{flag(a2)}</span>
          <span className="br-team">{teamName(name, a2, lang) ?? short ?? '—'}</span>
          {finished ? <span className="br-sc">{score ?? 0}</span> : null}
        </span>
      );
    }
    // unresolved: try to name the source tie (winner of X / Y) when that tie is known
    const fn = feederNum(name);
    const feeder = fn != null ? byNum.get(fn) : undefined;
    let label = tb.tbd;
    if (feeder && isReal(feeder, 'home') && isReal(feeder, 'away')) {
      const h = teamName(feeder.home_name, feeder.home_alpha2, lang) ?? feeder.home_short ?? '?';
      const a = teamName(feeder.away_name, feeder.away_alpha2, lang) ?? feeder.away_short ?? '?';
      label = tb.winnerOf(h, a);
    }
    return (
      <span className="br-slot tbd">
        <span className="br-team muted">{label}</span>
      </span>
    );
  }

  function Match({ m }: { m: WcMatch }) {
    const live = isLive(m.status_type);
    const finished = m.status_type === 'finished';
    const pr = preds.get(m.ss_id);
    const fav =
      !finished && pr && pr.p_home != null && pr.p_away != null
        ? pr.p_home >= pr.p_away
          ? { side: 'home' as const, p: pr.p_home }
          : { side: 'away' as const, p: pr.p_away }
        : null;
    return (
      <Link className="br-match" href={`/match/${m.ss_id}`}>
        <span className="br-meta">
          {live ? (
            <span className="chip live">{t.common.live}</span>
          ) : finished ? (
            <span className="br-ft">{tb.ft}</span>
          ) : (
            <span className="muted">
              {fmtDay(m.start_ts, lang)} · {fmtTime(m.start_ts)}
            </span>
          )}
          {fav ? <span className="br-fav">{Math.round(fav.p * 100)}%</span> : null}
        </span>
        <Slot m={m} side="home" />
        <Slot m={m} side="away" />
      </Link>
    );
  }

  const third = (byRound.get(THIRD_ROUND) ?? [])[0];
  const playedR32 = (byRound.get(6) ?? []).filter((m) => m.status_type === 'finished').length;

  return (
    <>
      <RealtimeRefresh table="match" />
      <h1 style={{ marginTop: 28 }}>{tb.title}</h1>
      <p className="muted">{tb.sub}</p>
      <p className="muted small">{tb.progress(playedR32, byRound.get(6)?.length ?? 16)}</p>

      <div className="br-scroll">
        <div className="bracket">
          {COLUMNS.map((c) => (
            <div className={`br-col br-${c.key}`} key={c.key}>
              <div className="br-col-hd">{tb.rounds[c.key]}</div>
              <div className="br-col-body">
                {ordered(c.round).map((m) => (
                  <Match key={m.ss_id} m={m} />
                ))}
                {c.key === 'final' && third ? (
                  <div className="br-third">
                    <div className="br-col-hd third">{tb.rounds.third}</div>
                    <Match m={third} />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="note" style={{ marginTop: 18 }}>
        {tb.note}
      </div>
    </>
  );
}
