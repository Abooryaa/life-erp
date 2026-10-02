import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, type MouseEvent } from 'react';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders user Markdown safely: HTML is sanitised with DOMPurify (no scripts, no event handlers,
 * no javascript: URLs). [[Wiki links]] become in-app links handled by `onWikiLink`.
 */
export function Markdown({ source, onWikiLink, untrusted }: { source: string; onWikiLink?: (title: string) => void; untrusted?: boolean }) {
  const html = useMemo(() => {
    const withWiki = untrusted ? source : source.replace(/\[\[([^\[\]\n]{1,300})\]\]/g, (_m, title: string) => `[${title}](#wiki:${encodeURIComponent(title.trim())})`);
    const raw = marked.parse(withWiki, { async: false }) as string;
    // Untrusted text (AI answers) may not load images or carry links: either could leak data to a remote server.
    const extra = untrusted ? ['img', 'a', 'picture', 'source', 'video', 'audio'] : [];
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'iframe', ...extra], FORBID_ATTR: ['style', ...(untrusted ? ['src', 'srcset', 'href'] : [])] });
  }, [source, untrusted]);

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
