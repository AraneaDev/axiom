import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Globe, Save } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { siteSettingsApi } from '@/api/site-settings.api';
import type { SiteSettings } from '@/api/site-settings.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

/**
 *
 */
export default function LandingPageEditor() {
  const { data: settings, isLoading } = useQuery<SiteSettings>({
    queryKey: ['site-settings'],
    queryFn: siteSettingsApi.get,
  });

  if (isLoading || !settings) return <PageLoader />;

  return <LandingPageForm settings={settings} />;
}

function LandingPageForm({ settings }: { settings: SiteSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [heroTitle, setHeroTitle] = useState(settings.heroTitle);
  const [heroSubtitle, setHeroSubtitle] = useState(settings.heroSubtitle);
  const [ctaText, setCtaText] = useState(settings.ctaText);
  const [ctaLink, setCtaLink] = useState(settings.ctaLink);
  const [bodyMarkdown, setBodyMarkdown] = useState(settings.bodyMarkdown);

  const mutation = useMutation({
    mutationFn: () =>
      siteSettingsApi.update({ heroTitle, heroSubtitle, ctaText, ctaLink, bodyMarkdown }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
      toast.success('Landing page updated');
    },
    onError: () => {
      toast.error('Failed to update landing page');
    },
  });

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </Link>
        <div>
          <h1 className="h2">Landing Page</h1>
          <p className="text-sm text-text-secondary mt-1">
            Edit the public landing page content shown to visitors
          </p>
        </div>
      </div>

      {/* Hero settings */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Hero Section</h3>
        </div>
        <div className="flex flex-col gap-4">
          <Input
            id="heroTitle"
            label="Title"
            value={heroTitle}
            onChange={(e) => setHeroTitle(e.target.value)}
            placeholder="Code. Track. Document."
          />
          <div>
            <label htmlFor="heroSubtitle" className="block text-sm font-medium text-text mb-1.5">
              Subtitle
            </label>
            <textarea
              id="heroSubtitle"
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="A short description of your instance"
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-tertiary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="ctaText"
              label="Button text"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="Get Started"
            />
            <Input
              id="ctaLink"
              label="Button link"
              value={ctaLink}
              onChange={(e) => setCtaLink(e.target.value)}
              placeholder="/register"
            />
          </div>
        </div>
      </Card>

      {/* Body content */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">Body Content</h3>
        </div>
        <div>
          <label htmlFor="bodyMarkdown" className="block text-sm font-medium text-text mb-1.5">
            HTML content (rendered below the hero)
          </label>
          <textarea
            id="bodyMarkdown"
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            placeholder="Add additional content here (HTML supported)"
            rows={12}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
          />
        </div>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <Save className="h-4 w-4" /> {mutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
