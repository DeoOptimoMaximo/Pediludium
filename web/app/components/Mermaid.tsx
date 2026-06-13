'use client';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Client-only Mermaid renderer. Mermaid is heavy and browser-only, so it is dynamically
 * imported on mount (never in the SSR / Workers path) and themed to the DOMOVINA palette
 * via CSS variables read off <html>. Falls back to the raw diagram source until hydrated.
 */
export function Mermaid({ chart, caption }: { chart: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      const css = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        themeVariables: {
          background: 'transparent',
          primaryColor: v('--bg-soft', '#f5f7f9'),
          primaryTextColor: v('--text', '#00255a'),
          primaryBorderColor: v('--line', '#e1e5ea'),
          lineColor: dark ? '#5a6570' : '#94a3b8',
          secondaryColor: v('--card', '#fff'),
          tertiaryColor: v('--bg-soft', '#f5f7f9'),
          fontSize: '14px',
        },
      });
      try {
        const { svg } = await mermaid.render(`m${id}`, chart);
        if (!cancelled) setSvg(svg);
      } catch {
        /* leave fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <figure className="mermaid-fig">
      {svg ? (
        <div ref={ref} className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className="mermaid-src">{chart}</pre>
      )}
      {caption && <figcaption className="muted small">{caption}</figcaption>}
    </figure>
  );
}
