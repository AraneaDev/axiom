import { useQuery, useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Save, X } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { wikiApi } from '@/api/wiki.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

/**
 *
 */
export default function PageEdit() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const navigate = useNavigate();

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams2 } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams2?.find((t) => t.slug === team);
  const { data: spaces } = useQuery({
    queryKey: ['wikiSpaces', currentTeam?.id],
    queryFn: () => wikiApi.listSpaces(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentSpace = spaces?.find((s) => s.slug === spaceSlug);

  const isNew = pageSlug === 'new';
  const draftKey = `wiki-draft-${spaceSlug}-${pageSlug ?? 'new'}`;

  const { data: existingPage, isLoading } = useQuery({
    queryKey: ['page', currentSpace?.id, pageSlug],
    queryFn: () => wikiApi.getPage(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !isNew,
  });

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* eslint-disable react-hooks/set-state-in-effect -- populate form from existing page and draft */
  // Load existing page data
  useEffect(() => {
    if (existingPage) {
      setTitle(existingPage.title);
      setSlug(existingPage.slug);
      setBody(existingPage.body);
    }
  }, [existingPage]);

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const draft = localStorage.getItem(draftKey);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (isNew || (existingPage && parsed.updatedAt > (existingPage.updatedAt ?? 0))) {
          if (parsed.title) setTitle(parsed.title);
          if (parsed.body) setBody(parsed.body);
          if (parsed.slug && isNew) setSlug(parsed.slug);
        }
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, [draftKey, isNew, existingPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-save draft with debounce
  const saveDraft = useCallback(() => {
    setDraftStatus('saving');
    try {
      localStorage.setItem(draftKey, JSON.stringify({ title, slug, body, updatedAt: Date.now() }));
    } catch {
      /* ignore storage errors */
    }
    setTimeout(() => setDraftStatus('saved'), 300);
    setTimeout(() => setDraftStatus('idle'), 2000);
  }, [draftKey, title, slug, body]);

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(saveDraft, 1000);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, slug, body, saveDraft]);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (isNew) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      );
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentSpace) throw new Error('Space not found');
      if (isNew) {
        return wikiApi.createPage(currentSpace.id, { title, slug, body });
      } else {
        return wikiApi.updatePage(currentSpace.id, pageSlug!, { title, body });
      }
    },
    onSuccess: () => {
      // Clear draft on successful save
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore storage errors */
      }
      navigate(`/${org}/${team}/wiki/${spaceSlug}/${isNew ? slug : pageSlug}`);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  if (!isNew && isLoading) return <PageLoader />;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{isNew ? 'New Page' : 'Edit Page'}</h1>
          {draftStatus === 'saving' && (
            <span className="text-xs text-text-tertiary flex items-center gap-1">
              <Save className="h-3 w-3 animate-pulse" /> Saving draft...
            </span>
          )}
          {draftStatus === 'saved' && (
            <span className="text-xs text-success flex items-center gap-1">
              <Save className="h-3 w-3" /> Draft saved
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !title.trim()}
          >
            {saveMutation.isPending ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <>
                <Save className="h-4 w-4" /> Save
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <Input
          id="title"
          label="Title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Page title"
          required
        />
        {isNew && (
          <Input
            id="slug"
            label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="page-slug"
            required
          />
        )}

        <div className={cn('gap-4', showPreview ? 'grid grid-cols-2' : '')}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text">Content</label>
            <MarkdownEditor value={body} onChange={setBody} placeholder="Write your content..." />
          </div>
          {showPreview && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-text">Preview</label>
              <div className="rounded-lg border border-border bg-surface p-4 min-h-[300px] overflow-auto">
                {body ? (
                  <MarkdownRenderer content={body} />
                ) : (
                  <p className="text-text-tertiary italic text-sm">
                    Start typing to see a preview...
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
