import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, WORLD_CUP } from './config.ts';
import { closeBrowser, getJson } from './browser.ts';
import { EventsResponseSchema, SeasonsResponseSchema, type Team } from './schemas.ts';

/**
 * Day-1 probe (docs/05): prove data flows from a residential IP.
 *  1. Verify endpoints return 200 + expected shape.
 *  2. Resolve the World Cup 2026 season id via /unique-tournament/16/seasons.
 *  3. From season events, extract the participating national-team ids.
 * Saves one raw sample JSON per endpoint into the (gitignored) sample dir.
 *
 * NOTE: must run from a residential IP. Cloud/datacenter IPs are blocked by SofaScore.
 */

interface StepReport {
  step: string;
  path: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
  note?: string;
}

async function saveSample(name: string, payload: unknown): Promise<void> {
  await mkdir(config.sampleDir, { recursive: true });
  await writeFile(join(config.sampleDir, `${name}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const report: StepReport[] = [];
  console.log(`\n=== Pediludium probe — WC tournament ${WORLD_CUP.uniqueTournamentId} ===\n`);

  // --- Step 1: seasons -> find 2026 season id -------------------------------
  let seasonId: number | undefined;
  const seasonsPath = `/unique-tournament/${WORLD_CUP.uniqueTournamentId}/seasons`;
  try {
    const { data, raw, status, durationMs } = await getJson(seasonsPath, SeasonsResponseSchema);
    await saveSample('seasons', raw);
    const match2026 = data.seasons.find((s) => s.year === '2026' || s.year.includes('2026'));
    seasonId = match2026?.id;
    report.push({
      step: 'seasons',
      path: seasonsPath,
      ok: true,
      status,
      durationMs,
      note: match2026
        ? `season 2026 -> id ${seasonId} ("${match2026.name ?? match2026.year}")`
        : `no 2026 season found among ${data.seasons.length} seasons; latest: ${data.seasons[0]?.year}`,
    });
    console.log(
      match2026
        ? `\n>>> WORLD CUP 2026 season id = ${seasonId}\n`
        : `\n>>> 2026 season not listed yet. First few: ${data.seasons.slice(0, 5).map((s) => `${s.year}#${s.id}`).join(', ')}\n`,
    );
  } catch (err) {
    report.push({ step: 'seasons', path: seasonsPath, ok: false, note: String(err) });
    console.error('[probe] seasons failed:', err);
  }

  // --- Step 2: upcoming events for that season -> participating team ids -----
  const teamIds = new Map<number, Team>();
  if (seasonId !== undefined) {
    for (const direction of ['next', 'last'] as const) {
      const eventsPath = `/unique-tournament/${WORLD_CUP.uniqueTournamentId}/season/${seasonId}/events/${direction}/0`;
      try {
        const { data, raw, status, durationMs } = await getJson(eventsPath, EventsResponseSchema);
        await saveSample(`events-${direction}-0`, raw);
        for (const ev of data.events) {
          teamIds.set(ev.homeTeam.id, ev.homeTeam);
          teamIds.set(ev.awayTeam.id, ev.awayTeam);
        }
        report.push({
          step: `events/${direction}`,
          path: eventsPath,
          ok: true,
          status,
          durationMs,
          note: `${data.events.length} events, hasNextPage=${data.hasNextPage ?? false}`,
        });
      } catch (err) {
        report.push({ step: `events/${direction}`, path: eventsPath, ok: false, note: String(err) });
        console.error(`[probe] events/${direction} failed:`, err);
      }
    }
  }

  // --- Step 3: smoke-test the live endpoint (cheap, confirms reachability) ---
  const livePath = `/sport/football/events/live`;
  try {
    const { data, raw, status, durationMs } = await getJson(livePath, EventsResponseSchema);
    await saveSample('live', raw);
    report.push({
      step: 'live',
      path: livePath,
      ok: true,
      status,
      durationMs,
      note: `${data.events.length} live football events right now`,
    });
  } catch (err) {
    report.push({ step: 'live', path: livePath, ok: false, note: String(err) });
    console.error('[probe] live failed:', err);
  }

  // --- Summary --------------------------------------------------------------
  const teams = [...teamIds.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const summary = {
    tournamentId: WORLD_CUP.uniqueTournamentId,
    seasonId2026: seasonId ?? null,
    participatingTeamCount: teams.length,
    teams: teams.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
    steps: report,
  };
  await saveSample('_summary', summary);

  console.log('\n=== Probe summary ===');
  for (const s of report) {
    console.log(`  ${s.ok ? 'OK ' : 'ERR'} ${s.step.padEnd(14)} ${s.status ?? '-'}  ${s.note ?? ''}`);
  }
  console.log(`\nseason 2026 id: ${seasonId ?? 'NOT FOUND'}`);
  console.log(`distinct teams found: ${teams.length}`);
  if (teams.length) {
    console.log(`teams: ${teams.map((t) => `${t.name}#${t.id}`).join(', ')}`);
  }
  console.log(`\nSamples written to ${config.sampleDir}/ (gitignored).`);

  if (!report.some((s) => s.ok)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[probe] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
