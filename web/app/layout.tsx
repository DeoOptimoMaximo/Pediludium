import './globals.css';
import type { Metadata } from 'next';
import { getLang } from '@/lib/lang';
import { Nav } from './components/Nav';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return {
    title: 'Lopta je okrugla — Svjetsko prvenstvo 2026',
    description:
      lang === 'hr'
        ? 'Otvorena nogometna analitika: Dixon-Coles predikcije i Monte-Carlo izgledi turnira za Svjetsko prvenstvo 2026.'
        : 'Open football analytics: Dixon-Coles predictions and Monte-Carlo tournament odds for the 2026 World Cup.',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body>
        <Nav lang={lang} />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
