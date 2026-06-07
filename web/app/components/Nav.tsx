'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'Overview'],
  ['/fixtures', 'Fixtures'],
  ['/groups', 'Groups'],
  ['/teams', 'Teams'],
  ['/predictions', 'Predictions'],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="dot" />
          Pediludium
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
      </div>
    </nav>
  );
}
