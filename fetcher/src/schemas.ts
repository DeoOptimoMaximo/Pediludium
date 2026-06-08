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
