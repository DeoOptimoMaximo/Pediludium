import './globals.css';
import type { Metadata } from 'next';
import { Nav } from './components/Nav';

export const metadata: Metadata = {
  title: 'Pediludium — World Cup 2026',
  description: 'Private realtime tracking + baseline analytics for the FIFA World Cup 2026.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
