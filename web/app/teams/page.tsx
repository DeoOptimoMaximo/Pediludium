import Link from 'next/link';
import { getNationalTeams } from '@/lib/data';
import { flag } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const teams = await getNationalTeams();
  return (
    <>
      <h1 style={{ marginTop: 28 }}>Teams</h1>
      <p className="muted">{teams.length} national teams · Elo rated · click for 10-year history</p>
      <div className="teamgrid">
        {teams.map((t) => (
          <Link key={t.ss_id} href={`/team/${t.ss_id}`} className="teamcard">
            <span className="flag">{flag(t.country_alpha2)}</span>
            <span className="nm">{t.name ?? t.short_name ?? t.ss_id}</span>
            {t.rating != null && <span className="rt">{t.rating}</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
