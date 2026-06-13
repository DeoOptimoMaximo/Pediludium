import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { POSTS, postBySlug } from '@/lib/blog';
import { fmtDay } from '@/lib/format';
import { getDict } from '@/lib/lang';
import { DrawParadox } from '../posts/draw-paradox';

export const dynamic = 'force-dynamic';

// one renderer per slug — keeps post bodies as real components (live diagrams), not strings
const RENDERERS: Record<string, (props: { lang: 'hr' | 'en' }) => React.ReactNode> = {
  'zasto-nijedna-predikcija-nije-remi': DrawParadox,
};

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) return {};
  const { lang } = await getDict();
  return {
    title: post.title[lang],
    description: post.excerpt[lang],
    alternates: { canonical: `/blog/${slug}` },
    openGraph: { type: 'article', title: post.title[lang], description: post.excerpt[lang] },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = postBySlug(slug);
  const Body = RENDERERS[slug];
  if (!post || !Body) notFound();
  const { lang, t } = await getDict();

  return (
    <article className="post">
      <Link href="/blog" className="backlink">
        ← {t.blog.back}
      </Link>
      <div className="blogmeta" style={{ marginTop: 14 }}>
        <span>{fmtDay(post.date, lang)}</span>
        <span className="dot">·</span>
        <span>
          {post.readMin} {t.blog.minRead}
        </span>
      </div>
      <h1 className="posttitle">{post.title[lang]}</h1>
      <div className="blogtags" style={{ marginBottom: 18 }}>
        {post.tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>
      <Body lang={lang} />
    </article>
  );
}
