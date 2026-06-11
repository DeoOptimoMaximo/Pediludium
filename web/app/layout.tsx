import './globals.css';
import type { Metadata } from 'next';
import { getLang, getUiPrefs } from '@/lib/lang';
import { Nav } from './components/Nav';

const SITE_URL = 'https://nogomet.domovina.ai';
const SITE_NAME = 'Lopta je okrugla';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const title = 'Lopta je okrugla — Svjetsko prvenstvo 2026';
  const description =
    lang === 'hr'
      ? 'Otvorena nogometna analitika: Dixon-Coles predikcije i Monte-Carlo izgledi turnira za Svjetsko prvenstvo 2026.'
      : 'Open football analytics: Dixon-Coles predictions and Monte-Carlo tournament odds for the 2026 World Cup.';
  const ogImage = {
    url: '/og.png',
    width: 1200,
    height: 630,
    alt: title,
    type: 'image/png',
  };
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    applicationName: SITE_NAME,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: '/',
      siteName: SITE_NAME,
      title,
      description,
      locale: lang === 'hr' ? 'hr_HR' : 'en_US',
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, { theme, layout }] = await Promise.all([getLang(), getUiPrefs()]);
  return (
    <html lang={lang} data-theme={theme} data-layout={layout}>
      <body>
        <Nav lang={lang} theme={theme} layout={layout} />
        <main className="container">{children}</main>
        <script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "84ead45314724f59905c5a5ccbd19bd1"}'
        />
      </body>
    </html>
  );
}
