import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LogIn, Moon, Sun } from 'lucide-react';
import { Link } from 'react-router';

import { siteSettingsApi } from '@/api/site-settings.api';
import type { SiteSettings } from '@/api/site-settings.api';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDarkMode } from '@/hooks/useDarkMode';
import { cn } from '@/lib/utils';

function LandingHeader() {
  const { isDark, toggle } = useDarkMode();

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border">
      <Link to="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-text-inverse text-sm font-bold">A</span>
        </div>
        <span className="text-xl font-bold text-text">Axiom</span>
      </Link>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="p-2 rounded-md text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <Link to="/login">
          <Button variant="outline" size="sm">
            <LogIn className="h-4 w-4" /> Sign in
          </Button>
        </Link>
      </div>
    </header>
  );
}

function HeroSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 px-6">
      <Skeleton className="h-12 w-96 max-w-full" />
      <Skeleton className="h-6 w-[32rem] max-w-full" />
      <Skeleton className="h-10 w-36 mt-4 rounded-lg" />
    </div>
  );
}

function MarkdownBody({ content }: { content: string }) {
  if (!content.trim()) return null;

  return (
    <section className="max-w-3xl mx-auto px-6 pb-16">
      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: content }} />
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
    <div className={cn('min-h-screen flex flex-col bg-surface-secondary')}>
      <LandingHeader />

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
