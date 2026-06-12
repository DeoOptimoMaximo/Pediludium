import { z } from 'zod';

/**
 * zod schemas for the SofaScore shapes we rely on (docs/02).
 * By default zod strips unknown keys (does NOT error), so these stay tolerant
 * of the API's many extra fields — we persist the raw payload separately anyway.
 */

export const SeasonSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  year: z.string(),
});
export type Season = z.infer<typeof SeasonSchema>;

export const SeasonsResponseSchema = z.object({
  seasons: z.array(SeasonSchema),
});

export const TeamSchema = z.object({
  id: z.number(),
  slug: z.string().optional(),
  name: z.string().optional(),
  shortName: z.string().optional(),
  national: z.boolean().optional(),
});
export type Team = z.infer<typeof TeamSchema>;

export const ScoreSchema = z
  .object({
    current: z.number(),
    display: z.number(),
    period1: z.number(),
    period2: z.number(),
    normaltime: z.number(),
  })
  .partial();

export const EventSchema = z.object({
  id: z.number(),
  startTimestamp: z.number().optional(),
  winnerCode: z.number().optional(),
  status: z
    .object({ code: z.number().optional(), type: z.string().optional() })
    .partial()
    .optional(),
  homeTeam: TeamSchema,
  awayTeam: TeamSchema,
  homeScore: ScoreSchema.optional(),
  awayScore: ScoreSchema.optional(),
  tournament: z
    .object({
      id: z.number().optional(),
      slug: z.string().optional(),
      category: z.object({ id: z.number().optional(), slug: z.string().optional() }).optional(),
    })
    .optional(),
  season: z
    .object({ id: z.number().optional(), year: z.string().optional() })
    .partial()
    .optional(),
});
export type Event = z.infer<typeof EventSchema>;

export const EventsResponseSchema = z.object({
  events: z.array(EventSchema),
  hasNextPage: z.boolean().optional(),
});

// Single event detail: GET /event/{id}
export const EventResponseSchema = z.object({
  event: EventSchema,
});

// Standings: validate the envelope, read row details from raw (many extra fields).
export const StandingsResponseSchema = z.object({
  standings: z.array(
    z.object({
      name: z.string().optional(),
      rows: z.array(z.unknown()),
    }),
  ),
});

/* ── per-match enrichment (docs/02): validate envelopes only, parse details from raw —
 * these payloads are deep and shift shape between matches (periods, market types…). */

// GET /event/{id}/statistics — periods (ALL/1ST/2ND) of grouped statistic items (incl. xG)
export const EventStatisticsResponseSchema = z.object({
  statistics: z.array(z.object({ period: z.string().optional(), groups: z.array(z.unknown()) })),
});

// GET /event/{id}/lineups — formations, XI + bench, missingPlayers per side
export const EventLineupsResponseSchema = z.object({
  confirmed: z.boolean().optional(),
  home: z.unknown(),
  away: z.unknown(),
});

// GET /event/{id}/odds/1/all — bookmaker markets (1X2, O/U, …) with fractional values
export const EventOddsResponseSchema = z.object({
  markets: z.array(z.unknown()),
});

// GET /event/{id}/votes — fan "who will win" counts (vote1 / voteX / vote2)
export const EventVotesResponseSchema = z.object({
  vote: z.record(z.unknown()),
});

// GET /event/{id}/shotmap — every shot with pitch coordinates + per-shot xg/xgot
export const EventShotmapResponseSchema = z.object({
  shotmap: z.array(z.unknown()),
});
