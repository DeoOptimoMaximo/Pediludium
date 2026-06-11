import Link from 'next/link';
import { getNationalTeams } from '@/lib/data';
import { flag } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const [{ lang, t }, teams] = await Promise.all([getDict(), getNationalTeams()]);
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{t.teams.title}</h1>
      <p className="muted">{t.teams.sub(teams.length)}</p>
      <div className="teamgrid">
        {teams.map((tm) => (
          <Link key={tm.ss_id} href={`/team/${tm.ss_id}`} className="teamcard">
            <span className="flag">{flag(tm.country_alpha2)}</span>
            <span className="nm">{teamName(tm.name, tm.country_alpha2, lang) ?? tm.short_name ?? tm.ss_id}</span>
            {tm.rating != null && <span className="rt">{tm.rating}</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
