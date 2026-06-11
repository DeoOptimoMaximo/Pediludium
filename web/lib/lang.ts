import { cookies } from 'next/headers';
import { DEFAULT_LANG, T, type Dict, type Lang } from './i18n';

/** Server-side: language from the `lang` cookie (hr default). */
export async function getLang(): Promise<Lang> {
  const c = (await cookies()).get('lang')?.value;
  return c === 'en' ? 'en' : DEFAULT_LANG;
}

export async function getDict(): Promise<{ lang: Lang; t: Dict }> {
  const lang = await getLang();
  return { lang, t: T[lang] };
}

export type Theme = 'light' | 'dark';
export type LayoutMode = 'boxed' | 'wide';

/** UI preferences from cookies (set by the Nav toggles): theme (light default,
 * like the rest of the DOMOVINA family) and page width (boxed container default).
 * Read server-side and rendered as <html data-*> attributes, so there is no FOUC. */
export async function getUiPrefs(): Promise<{ theme: Theme; layout: LayoutMode }> {
  const c = await cookies();
  return {
    theme: c.get('theme')?.value === 'dark' ? 'dark' : 'light',
    layout: c.get('layout')?.value === 'wide' ? 'wide' : 'boxed',
  };
}
