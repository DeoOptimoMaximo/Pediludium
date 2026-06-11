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
