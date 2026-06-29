import { describe, expect, it } from 'vitest';
import { parseFixtures, parseLinkMeta, parseSlugFixtures, slugifyTeam } from './resolve-knockout.ts';

// Real slices of the WC2026 knockout fixtures rendered to markdown by Firecrawl. Upcoming ties
// render as a clean `![Home](…/team/H/image)-![Away](…/team/A/image)](…#id:N)` (image order is
// home–away); an already-kicked-off tie loses the image pair and is recovered from its
// `{away}-{home}` URL slug.
const CLEAN_MD = `
[19:00\\
\\
![Brazil](https://img.sofascore.com/api/v1/team/4748/image)-![Japan](https://img.sofascore.com/api/v1/team/4770/image)](https://www.sofascore.com/football/match/japan-brazil/YUbsvVb#id:12813012) [22:30\\
\\
![Germany](https://img.sofascore.com/api/v1/team/4711/image)-![Paraguay](https://img.sofascore.com/api/v1/team/4789/image)](https://www.sofascore.com/football/match/paraguay-germany/lUbsOVb#id:12813014)
`;

// A finished tie: only the slug link survives (no clean image pair).
const STARTED_MD = `
Canada\\
\\
1](https://www.sofascore.com/football/match/canada-south-africa/LUbscVb#id:12813000)
`;

describe('parseFixtures', () => {
  it('reads home–away from image order and the match id from #id', () => {
    const fx = parseFixtures(CLEAN_MD);
    expect(fx).toEqual([
      { matchId: 12813012, homeId: 4748, homeName: 'Brazil', awayId: 4770, awayName: 'Japan' },
      { matchId: 12813014, homeId: 4711, homeName: 'Germany', awayId: 4789, awayName: 'Paraguay' },
    ]);
  });

  it('tolerates the /small image variant', () => {
    const md = '![A](https://img.sofascore.com/api/v1/team/1/image/small)-![B](https://img.sofascore.com/api/v1/team/2/image/small)](https://www.sofascore.com/football/match/b-a/CODE#id:99)';
    expect(parseFixtures(md)[0]).toMatchObject({ matchId: 99, homeId: 1, awayId: 2 });
  });
});

describe('slugifyTeam', () => {
  it('matches SofaScore slug forms', () => {
    expect(slugifyTeam('South Africa')).toBe('south-africa');
    expect(slugifyTeam("Côte d'Ivoire")).toBe('cote-divoire');
    expect(slugifyTeam('Bosnia & Herzegovina')).toBe('bosnia-and-herzegovina');
    expect(slugifyTeam('DR Congo')).toBe('dr-congo');
    expect(slugifyTeam('USA')).toBe('usa');
  });
});

describe('parseSlugFixtures', () => {
  const slugToId = new Map([
    ['canada', 4752],
    ['south-africa', 4736],
  ]);
  it('splits {away}-{home} into resolved national teams (longest home suffix wins)', () => {
    const fx = parseSlugFixtures(STARTED_MD, slugToId);
    expect(fx).toEqual([
      { matchId: 12813000, homeId: 4736, homeName: 'south-africa', awayId: 4752, awayName: 'canada' },
    ]);
  });
  it('ignores a slug whose halves are not both known teams', () => {
    expect(parseSlugFixtures(STARTED_MD, new Map([['canada', 4752]]))).toEqual([]);
  });
});

describe('parseLinkMeta', () => {
  it('captures the fresh slug + customId per match', () => {
    const meta = parseLinkMeta(CLEAN_MD);
    expect(meta.get(12813012)).toEqual({ slug: 'japan-brazil', code: 'YUbsvVb' });
    expect(meta.get(12813014)).toEqual({ slug: 'paraguay-germany', code: 'lUbsOVb' });
  });
});
