import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, dbQuery } from './db.ts';
import { WORLD_CUP } from './config.ts';

/**
 * Resolve knockout-bracket team slots via Firecrawl (`npm run resolve:ko`).
 *
 * Once the group stage finishes, SofaScore fills each knockout fixture's placeholder slot
 * (1A / 2B / 3A3B3C3D3F / W73 …) with the real qualifier. Our piggyback proxy is the only
 * path that re-fetches the schedule, and when it's down the bracket stays stuck on
 * placeholders — the public scorecard shows "2A v 2B" instead of the actual tie.
 *
 * A rendered SofaScore tournament/match page carries a fixtures list where each upcoming tie
 * appears as `![Brazil](…/team/4748/image)-![Japan](…/team/4770/image)](…/match/japan-brazil/
 * CODE#id:12813012)`. Image order is home–away; the `#id:N` is our `match.ss_id`. An
 * already-kicked-off tie renders with a score instead of the clean image pair, so for those
 * we fall back to splitting the URL slug into two known team slugs (order is best-effort — the
 * slug is NOT a reliable home/away indicator, see below) and resolve names against our team
 * table. We re-point `home_team_id`/`away_team_id` to the resolved national teams; the
 * `wc2026_match` view derives names/flags from those joins, so the scorecard and the bracket
 * page light up immediately — no `raw` rewrite needed.
 *
 * IMPORTANT — home/away order is cosmetic, never trust it for results. SofaScore's URL slug
 * does NOT consistently encode home–away (observed both `{home}-{away}` and `{away}-{home}`
 * across WC2026 group ties), so the resolved slot order can differ from SofaScore's real
 * home/away. That's harmless for the WINNER because refresh:fc attributes each score to the
 * team it renders (matched by NAME against home_team_id/away_team_id), not to a slot position.
 * To keep it harmless we ONLY resolve ties that haven't started — once a result is in, its
 * home_score/away_score are frozen in raw order and re-pointing the slots would invert the
 * displayed winner (root cause of the BiH/USA R32 inversion, fixed 2026-07-02).
 *
 * Safety rails: only touches not-started knockout rounds, only when BOTH resolved ids are
 * national teams already in our `team` table, and only flips a slot that isn't pointing at them.
 *
 * After this, re-run predict:dc → predict:dcm → simulate → snapshot to publish.
 */

const S = WORLD_CUP.seasonId2026;
const DRY = process.env.RESOLVE_KO_DRY === '1';
const SEEDS = Number(process.env.RESOLVE_KO_SEEDS ?? 3);
// SofaScore knockout round codes (see simulate.ts): 6=R32, 5=R16, 27=QF, 28=SF, 29=Final, 50=3rd.
const KO_ROUNDS = [6, 5, 27, 28, 29, 50];

interface KoRow {
  ss_id: number;
  round: number;
  slug: string | null;
  cid: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
}

interface Parsed {
  matchId: number;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Scrape a SofaScore match page to markdown (1 credit). Returns '' on failure. */
function scrape(url: string): string {
  const out = path.join(tmpdir(), `kores-${Math.abs(hashCode(url))}.md`);
  const res = spawnSync(
    'firecrawl',
    ['scrape', url, '--format', 'markdown', '--country', 'HR', '--max-age', '0', '--wait-for', '8000', '-o', out],
    { encoding: 'utf8', timeout: 90_000 },
  );
  if (res.status !== 0) {
    console.warn(`[resolve:ko] scrape failed (${res.status}): ${String(res.stderr).slice(0, 120)}`);
    return '';
  }
  try {
    return readFileSync(out, 'utf8');
  } catch {
    return '';
  } finally {
    rmSync(out, { force: true });
  }
}

const ENTRY =
  /!\[([^\]]+)\]\(https:\/\/img\.sofascore\.com\/api\/v1\/team\/(\d+)\/image(?:\/small)?\)\s*-\s*!\[([^\]]+)\]\(https:\/\/img\.sofascore\.com\/api\/v1\/team\/(\d+)\/image(?:\/small)?\)\]\([^)]*#id:(\d+)\)/g;
// any fixture link, e.g. `](…/football/match/canada-south-africa/LUbscVb#id:12813000)`.
const LINK = /\/football\/match\/([a-z0-9-]+)\/([A-Za-z0-9]+)#id:(\d+)/g;

/** Fresh slug + customId per match — SofaScore re-slugs a tie when it resolves, stranding our
 *  stored placeholder URL (`2a-2b/WCPdsFlbe` → 404). Carrying these keeps refresh:fc working. */
export function parseLinkMeta(md: string): Map<number, { slug: string; code: string }> {
  const out = new Map<number, { slug: string; code: string }>();
  for (const m of md.matchAll(LINK)) {
    const id = Number(m[3]);
    if (!out.has(id)) out.set(id, { slug: m[1]!, code: m[2]! });
  }
  return out;
}

/**
 * Extract clean home–away fixtures from a rendered page. Each upcoming tie is
 * `![Home](…/team/H/image)-![Away](…/team/A/image)](…#id:N)`; image order is home–away.
 * Exported for unit testing.
 */
export function parseFixtures(md: string): Parsed[] {
  const out: Parsed[] = [];
  for (const m of md.matchAll(ENTRY)) {
    out.push({
      homeName: m[1]!.trim(),
      homeId: Number(m[2]),
      awayName: m[3]!.trim(),
      awayId: Number(m[4]),
      matchId: Number(m[5]),
    });
  }
  return out;
}

/** SofaScore team-slug form of a name: ascii-fold, &→and, drop apostrophes, dash-join. */
export function slugifyTeam(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve an already-started fixture from its `{away}-{home}` URL slug by splitting it into
 * two known team slugs (longest valid home suffix wins). Returns {matchId, homeId, awayId} or
 * null when the slug isn't a clean pair of national teams. Exported for unit testing.
 */
export function parseSlugFixtures(md: string, slugToId: Map<string, number>): Parsed[] {
  const seen = new Set<number>();
  const out: Parsed[] = [];
  for (const m of md.matchAll(LINK)) {
    const slug = m[1]!;
    const matchId = Number(m[3]);
    if (seen.has(matchId)) continue;
    const parts = slug.split('-');
    for (let i = 1; i < parts.length; i++) {
      const awaySlug = parts.slice(0, i).join('-');
      const homeSlug = parts.slice(i).join('-');
      const awayId = slugToId.get(awaySlug);
      const homeId = slugToId.get(homeSlug);
      if (awayId != null && homeId != null && awayId !== homeId) {
        out.push({ matchId, homeId, homeName: homeSlug, awayId, awayName: awaySlug });
        seen.add(matchId);
        break;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const ko = (
    await dbQuery<Omit<KoRow, 'ss_id' | 'home_team_id' | 'away_team_id'> & {
      ss_id: string;
      home_team_id: string | null;
      away_team_id: string | null;
    }>(
      // Only pre-match ties: once a knockout match has kicked off/finished its slots are
      // settled, and its home_score/away_score are already stored in the raw home/away order.
      // Re-pointing home_team_id/away_team_id afterwards (the rendered page's home/away order is
      // not reliably derivable — the URL slug order is inconsistent) would silently INVERT the
      // displayed winner. So resolve placeholders only while the tie hasn't started.
      `select m.ss_id, m.round, m.raw->>'slug' as slug, m.raw->>'customId' as cid,
              m.home_team_id, m.away_team_id
         from public.match m
        where m.season_id = $1 and m.round = any($2::int[])
          and coalesce(m.status_type, 'notstarted') = 'notstarted'
        order by m.round, m.start_ts`,
      [S, KO_ROUNDS],
    )
  ).map((r) => ({
    ss_id: Number(r.ss_id),
    round: r.round,
    slug: r.slug,
    cid: r.cid,
    home_team_id: r.home_team_id == null ? null : Number(r.home_team_id),
    away_team_id: r.away_team_id == null ? null : Number(r.away_team_id),
  }));
  if (ko.length === 0) {
    console.log('[resolve:ko] no knockout matches found');
    return;
  }

  const teamRows = await dbQuery<{ ss_id: string; name: string }>(
    `select ss_id, name from public.team where is_national`,
  );
  const nationalIds = new Set(teamRows.map((r) => Number(r.ss_id)));
  const slugToId = new Map<string, number>();
  for (const t of teamRows) slugToId.set(slugifyTeam(t.name), Number(t.ss_id));
  const koById = new Map(ko.map((m) => [m.ss_id, m]));
  // a slot is "resolved" once it points at a national team; placeholders are pseudo-teams.
  const resolved = (id: number | null) => id != null && nationalIds.has(id);
  const unresolved = ko.filter((m) => !resolved(m.home_team_id) || !resolved(m.away_team_id));
  console.log(
    `[resolve:ko] ${ko.length} knockout matches, ${unresolved.length} with unresolved slots${DRY ? ' (DRY RUN)' : ''}`,
  );
  if (unresolved.length === 0) {
    console.log('[resolve:ko] bracket already fully resolved — nothing to do');
    return;
  }

  // Pages to scrape: the tournament page lists the whole current round in one shot; a few
  // unresolved match pages backfill anything the tournament view paginates away. Clean
  // image-pair entries win; slug fallback fills already-started ties that render with a score.
  const urls: string[] = [
    `https://www.sofascore.com/football/tournament/world/${WORLD_CUP.slug}/${WORLD_CUP.uniqueTournamentId}`,
    ...unresolved
      .filter((m) => m.slug && m.cid)
      .slice(0, SEEDS)
      .map((s) => `https://www.sofascore.com/football/match/${s.slug}/${s.cid}`),
  ];
  const merged = new Map<number, Parsed>();
  const linkMeta = new Map<number, { slug: string; code: string }>();
  for (const url of urls) {
    const md = scrape(url);
    if (!md) continue;
    const clean = parseFixtures(md);
    for (const f of clean) merged.set(f.matchId, f); // clean pair is authoritative
    for (const f of parseSlugFixtures(md, slugToId)) if (!merged.has(f.matchId)) merged.set(f.matchId, f);
    for (const [id, meta] of parseLinkMeta(md)) if (!linkMeta.has(id)) linkMeta.set(id, meta);
    console.log(`[resolve:ko] ${url.replace('https://www.sofascore.com', '')}: +${clean.length} clean (union ${merged.size})`);
  }
  if (merged.size === 0) {
    console.warn('[resolve:ko] no fixtures parsed from any page — aborting');
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const f of merged.values()) {
    const m = koById.get(f.matchId);
    if (!m) continue; // not one of our knockout matches
    if (!nationalIds.has(f.homeId) || !nationalIds.has(f.awayId)) {
      // a still-unresolved tie elsewhere, or a team we don't carry — leave it
      skipped++;
      continue;
    }
    const meta = linkMeta.get(f.matchId);
    const teamsChanged = m.home_team_id !== f.homeId || m.away_team_id !== f.awayId;
    const urlChanged = meta != null && (m.slug !== meta.slug || m.cid !== meta.code);
    if (!teamsChanged && !urlChanged) continue; // already correct
    console.log(
      `[resolve:ko] ${f.matchId}: → ${f.homeName} (${f.homeId}) v ${f.awayName} (${f.awayId})` +
        (meta ? ` [${meta.slug}/${meta.code}]` : '') +
        (DRY ? ' [DRY]' : ''),
    );
    if (!DRY) {
      // Re-point teams; refresh raw.slug/customId from the resolved URL so refresh:fc (which
      // scrapes by slug/customId) stops 404ing on the re-slugged tie.
      await dbQuery(
        `update public.match
            set home_team_id = $2, away_team_id = $3,
                raw = case when $4::text is not null
                           then jsonb_set(jsonb_set(raw, '{slug}', to_jsonb($4::text)),
                                          '{customId}', to_jsonb($5::text))
                           else raw end,
                fetched_at = now()
          where ss_id = $1`,
        [f.matchId, f.homeId, f.awayId, meta?.slug ?? null, meta?.code ?? null],
      );
    }
    updated++;
  }
  console.log(
    `[resolve:ko] ${DRY ? 'would resolve' : 'resolved'} ${updated} fixture${updated === 1 ? '' : 's'}` +
      (skipped ? `, skipped ${skipped} non-national/unresolved` : ''),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[resolve:ko] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
