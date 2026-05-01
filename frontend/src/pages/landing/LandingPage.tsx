import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { siteSettingsApi } from '@/api/site-settings.api';
import type { SiteSettings } from '@/api/site-settings.api';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

function HeroSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 px-6">
      <Skeleton className="h-12 w-96 max-w-full" />
      <Skeleton className="h-6 w-[32rem] max-w-full" />
      <Skeleton className="h-10 w-36 mt-4 rounded-lg" />
    </div>
  );
}

const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'pre',
  'blockquote',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'span',
  'section',
]);

const ALLOWED_ATTRS = new Set([
  'href',
  'src',
  'alt',
  'title',
  'class',
  'id',
  'target',
  'rel',
  'width',
  'height',
  'colspan',
  'rowspan',
]);

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function clean(node: Node): void {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
            el.removeAttribute(attr.name);
          }
        }
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          if (href.startsWith('javascript:')) {
            el.removeAttribute('href');
          }
          el.setAttribute('rel', 'noopener noreferrer');
        }
        clean(el);
      }
    }
  }

  clean(doc.body);
  return doc.body.innerHTML;
}

function MarkdownBody({ content }: { content: string }) {
  const sanitized = useMemo(() => sanitizeHtml(content), [content]);
  if (!content.trim()) return null;

  return (
    <section className="max-w-3xl mx-auto px-6 pb-16">
      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: sanitized }} />
    </section>
  );
}

/**
 *
 */
export default function LandingPage() {
  const { data: settings, isLoading } = useQuery<SiteSettings>({
    queryKey: ['site-settings'],
    queryFn: siteSettingsApi.get,
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen flex flex-col bg-surface-secondary">
      <PublicHeader showSignIn />

      {isLoading || !settings ? (
        <HeroSkeleton />
      ) : (
        <>
          {/* Hero */}
          <section className="flex flex-col items-center text-center py-24 px-6">
            <h1 className="text-5xl sm:text-6xl font-bold text-text tracking-tight leading-tight max-w-3xl">
              {settings.heroTitle}
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-text-secondary max-w-2xl leading-relaxed">
              {settings.heroSubtitle}
            </p>
            <Link to={settings.ctaLink} className="mt-10">
              <Button size="lg">
                <ArrowRight className="h-4 w-4" /> {settings.ctaText}
              </Button>
            </Link>
          </section>

          {/* Body markdown */}
          <MarkdownBody content={settings.bodyMarkdown} />
        </>
      )}

      {/* Footer */}
      <footer className="mt-auto border-t border-border px-6 py-6 text-center">
        <p className="text-sm text-text-tertiary">Powered by Axiom</p>
      </footer>
    </div>
  );
}
