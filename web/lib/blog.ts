import type { Lang } from './i18n';

/**
 * Blog post registry. Content lives in React components (app/blog/posts/*) because the
 * technical posts carry live diagrams (Mermaid, SVG score matrices) that don't fit in a
 * string dictionary. Each entry is bilingual metadata + a `slug` that maps to a renderer
 * in app/blog/[slug]/page.tsx. Newest first.
 */
export interface BlogMeta {
  slug: string;
  date: string; // ISO yyyy-mm-dd
  readMin: number;
  tags: string[];
  title: Record<Lang, string>;
  excerpt: Record<Lang, string>;
}

export const POSTS: BlogMeta[] = [
  {
    slug: 'zasto-nijedna-predikcija-nije-remi',
    date: '2026-06-13',
    readMin: 6,
    tags: ['Dixon-Coles', 'kalibracija', 'matematika'],
    title: {
      hr: 'Paradoks neriješenog: zašto nijedna predikcija nije remi',
      en: 'The draw paradox: why no prediction ever favours a draw',
    },
    excerpt: {
      hr: 'Niti jedna od 104 predikcije ne stavlja remi kao najvjerojatniji ishod. Nije bug — izvodimo iz matrice rezultata zašto je dijagonala uvijek u manjini, i zašto je pravi test kalibracija, a ne argmax.',
      en: 'Not one of 104 predictions makes a draw the most likely outcome. It is not a bug — we derive from the scoreline matrix why the diagonal is always outnumbered, and why the real test is calibration, not argmax.',
    },
  },
];

export const postBySlug = (slug: string): BlogMeta | undefined => POSTS.find((p) => p.slug === slug);
