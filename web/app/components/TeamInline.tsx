import { flag } from '@/lib/format';

export function TeamInline({
  name,
  short,
  alpha2,
  align = 'left',
}: {
  name: string | null;
  short: string | null;
  alpha2: string | null;
  align?: 'left' | 'right';
}) {
  const fl = flag(alpha2);
  const label = name ?? short ?? 'TBD';
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
