import Link from 'next/link';
import type { Metadata } from 'next';
import { POSTS } from '@/lib/blog';
import { fmtDay } from '@/lib/format';
import { getDict } from '@/lib/lang';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getDict();
  const title = lang === 'hr' ? 'Blog — tehničke analize' : 'Blog — technical write-ups';
  const description =
    lang === 'hr'
      ? 'Otvorene tehničke analize modela: kako nastaju predikcije i izgledi turnira za SP 2026.'
      : 'Open technical write-ups: how the predictions and tournament odds for the 2026 World Cup are built.';
  return { title, description, alternates: { canonical: '/blog' } };
}

export default async function BlogIndex() {
  const { lang, t } = await getDict();
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{t.blog.title}</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        {t.blog.sub}
      </p>

      <div className="bloglist">
        {POSTS.map((p) => (
          <Link key={p.slug} href={`/blog/${p.slug}`} className="card blogcard">
            <div className="blogmeta">
              <span>{fmtDay(p.date, lang)}</span>
              <span className="dot">·</span>
              <span>
                {p.readMin} {t.blog.minRead}
              </span>
            </div>
            <h2>{p.title[lang]}</h2>
            <p className="muted">{p.excerpt[lang]}</p>
            <div className="blogtags">
              {p.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
