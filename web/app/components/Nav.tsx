'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { T, type Lang } from '@/lib/i18n';

export function Nav({ lang }: { lang: Lang }) {
  const path = usePathname();
  const router = useRouter();
  const t = T[lang].nav;

  const LINKS = [
    ['/', t.overview],
    ['/fixtures', t.fixtures],
    ['/groups', t.groups],
    ['/teams', t.teams],
    ['/predictions', t.predictions],
    ['/simulation', t.forecast],
  ] as const;

  const setLang = (l: Lang) => {
    document.cookie = `lang=${l};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  };

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={24} height={24} style={{ borderRadius: 5 }} />
          Lopta je okrugla
        </Link>
        <span className="spacer" />
        {LINKS.map(([href, label]) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`link${active ? ' active' : ''}`}>
              {label}
            </Link>
          );
        })}
        <span className="langsw">
          <button className={lang === 'hr' ? 'on' : ''} onClick={() => setLang('hr')}>HR</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </span>
      </div>
    </nav>
  );
}
