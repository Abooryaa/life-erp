import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, type MouseEvent } from 'react';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders user Markdown safely: HTML is sanitised with DOMPurify (no scripts, no event handlers,
 * no javascript: URLs). [[Wiki links]] become in-app links handled by `onWikiLink`.
 */
export function Markdown({ source, onWikiLink }: { source: string; onWikiLink?: (title: string) => void }) {
  const html = useMemo(() => {
    const withWiki = source.replace(/\[\[([^\[\]\n]{1,300})\]\]/g, (_m, title: string) => `[${title}](#wiki:${encodeURIComponent(title.trim())})`);
    const raw = marked.parse(withWiki, { async: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'iframe'], FORBID_ATTR: ['style'] });
  }, [source]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#wiki:')) {
      e.preventDefault();
      onWikiLink?.(decodeURIComponent(href.slice(6)));
    } else if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  };

  return (
    <div
      className="prose-lerp"
      onClick={onClick}
      // Safe: sanitised by DOMPurify above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
