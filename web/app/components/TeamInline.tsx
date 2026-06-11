import { flag } from '@/lib/format';
import { teamName, type Lang } from '@/lib/i18n';

export function TeamInline({
  name,
  short,
  alpha2,
  lang,
  align = 'left',
}: {
  name: string | null;
  short: string | null;
  alpha2: string | null;
  lang: Lang;
  align?: 'left' | 'right';
}) {
  const fl = flag(alpha2);
  const label = teamName(name, alpha2, lang) ?? short ?? 'TBD';
  return (
    <div className="team" style={align === 'right' ? { justifyContent: 'flex-end' } : undefined}>
      {align === 'right' ? (
        <>
          <span className="nm">{label}</span>
          {fl ? <span className="flag">{fl}</span> : null}
        </>
      ) : (
        <>
          {fl ? <span className="flag">{fl}</span> : null}
          <span className="nm">{label}</span>
        </>
      )}
    </div>
  );
}
