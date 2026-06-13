'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { T, type Lang } from '@/lib/i18n';
import type { LayoutMode, Theme } from '@/lib/lang';

const setPref = (name: 'theme' | 'layout', value: string) => {
  document.documentElement.setAttribute(`data-${name}`, value);
  document.cookie = `${name}=${value};path=/;max-age=31536000;samesite=lax`;
};

export function Nav({ lang, theme, layout }: { lang: Lang; theme: Theme; layout: LayoutMode }) {
  const path = usePathname();
  const router = useRouter();
  const t = T[lang].nav;
  const ui = T[lang].ui;
  // initial values come from cookies via SSR (no FOUC); toggles flip the <html>
  // attribute instantly — the cookie only persists the choice for the next visit
  const [th, setTh] = useState<Theme>(theme);
  const [ly, setLy] = useState<LayoutMode>(layout);

  const LINKS = [
    ['/', t.overview],
    ['/fixtures', t.fixtures],
    ['/groups', t.groups],
    ['/teams', t.teams],
    ['/predictions', t.predictions],
    ['/simulation', t.forecast],
    ['/movers', t.movers],
    ['/scorecard', t.scorecard],
    ['/accuracy', t.accuracy],
    ['/blog', t.blog],
    ['/edge', 'Edge'],
  ] as const;

  const setLang = (l: Lang) => {
    document.cookie = `lang=${l};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  };

  const toggleTheme = () => {
    const v: Theme = th === 'dark' ? 'light' : 'dark';
    setTh(v);
    setPref('theme', v);
  };

  const toggleLayout = () => {
    const v: LayoutMode = ly === 'wide' ? 'boxed' : 'wide';
    setLy(v);
    setPref('layout', v);
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
        <button
          className="iconbtn"
          onClick={toggleTheme}
          title={th === 'dark' ? ui.toLight : ui.toDark}
          aria-label={th === 'dark' ? ui.toLight : ui.toDark}
        >
          {th === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className="iconbtn"
          onClick={toggleLayout}
          title={ly === 'wide' ? ui.toBoxed : ui.toWide}
          aria-label={ly === 'wide' ? ui.toBoxed : ui.toWide}
        >
          {ly === 'wide' ? '⊟' : '⛶'}
        </button>
        <span className="langsw">
          <button className={lang === 'hr' ? 'on' : ''} onClick={() => setLang('hr')}>HR</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </span>
      </div>
    </nav>
  );
}
