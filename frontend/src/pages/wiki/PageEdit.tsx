import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Paperclip, Save, X, FileText, Wifi, WifiOff } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { useWikiContext } from './WikiLayout';

import { attachmentsApi } from '@/api/attachments.api';
import { wikiApi } from '@/api/wiki.api';
import { CollaborativeEditor } from '@/components/editor/CollaborativeEditor';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem, Select } from '@/components/ui/Dropdown';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { PresenceIndicators } from '@/components/wiki/PresenceIndicators';
import { useCollaboration } from '@/hooks/useCollaboration';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function PageEdit() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [searchParams] = useSearchParams();
  const { currentSpace } = useWikiContext();

  const { data: templates = [] } = useQuery({
    queryKey: ['wikiTemplates', currentSpace?.id],
    queryFn: () => wikiApi.listTemplates(currentSpace!.id),
    enabled: !!currentSpace?.id,
  });

  const { data: pageTree = [] } = useQuery({
    queryKey: ['wikiPageTree', currentSpace?.id],
    queryFn: () => wikiApi.getPageTree(currentSpace!.id),
    enabled: !!currentSpace?.id,
  });

  const isNew = !pageSlug || pageSlug === 'new';
  const draftKey = `wiki-draft-${spaceSlug}-${pageSlug ?? 'new'}`;

  const { data: existingPage, isLoading } = useQuery({
    queryKey: ['page', currentSpace?.id, pageSlug],
    queryFn: () => wikiApi.getPage(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !isNew,
  });

  const { data: pageAttachments = [] } = useQuery({
    queryKey: ['attachments', existingPage?.id],
    queryFn: () => attachmentsApi.list({ pageId: existingPage!.id }),
    enabled: !!existingPage?.id,
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', existingPage?.id] }),
  });

  // Real-time collaboration (only for existing pages, not new ones)
  const collabEnabled = !isNew && !!existingPage?.id && !!currentSpace;
  const collab = useCollaboration({
    pageId: existingPage?.id,
    enabled: collabEnabled,
  });
  const useCollab =
    collabEnabled && collab.isConnected && collab.isSynced && collab.ydoc && collab.provider;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [body, setBody] = useState('');
  const [parentId, setParentId] = useState<string>(searchParams.get('parent') ?? '');
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Flatten the page tree into select options with indentation
  function flattenTree(nodes: typeof pageTree, depth = 0): { value: string; label: string }[] {
    const result: { value: string; label: string }[] = [];
    for (const node of nodes) {
      result.push({
        value: node.id,
        label: `${'--'.repeat(depth)}${depth > 0 ? ' ' : ''}${node.title}`,
      });
      if (node.children?.length) {
        result.push(...flattenTree(node.children, depth + 1));
      }
    }
    return result;
  }
  const parentOptions = [{ value: '', label: 'None (top level)' }, ...flattenTree(pageTree)];
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
        return wikiApi.createPage(currentSpace.id, {
          title,
          slug,
          body,
          ...(parentId ? { parentId } : {}),
        });
      } else {
        return wikiApi.updatePage(currentSpace.id, pageSlug!, {
          title,
          body,
          ...(parentId ? { parentId } : { parentId: null }),
        });
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

  if (!currentSpace || (!isNew && isLoading)) return <PageLoader />;

  return (
    <div>
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
        <div className="flex items-center gap-3">
          {/* Collaboration presence indicators */}
          {!isNew && collab.presenceUsers.length > 0 && (
            <PresenceIndicators users={collab.presenceUsers} />
          )}
          {!isNew && existingPage?.id && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs',
                collab.isConnected ? 'text-success' : 'text-text-tertiary',
              )}
              title={collab.isConnected ? 'Real-time sync active' : 'Editing offline'}
            >
              {collab.isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            </span>
          )}
          {isNew && templates.length > 0 && (
            <Dropdown
              align="right"
              trigger={
                <Button variant="ghost" size="sm">
                  <FileText className="h-4 w-4" /> From template
                </Button>
              }
            >
              {templates.map((tpl) => (
                <DropdownItem
                  key={tpl.id}
                  onClick={() => {
                    setBody(tpl.body);
                    if (!title.trim()) {
                      handleTitleChange(tpl.name);
                    }
                  }}
                >
                  <FileText className="h-4 w-4" /> {tpl.name}
                </DropdownItem>
              ))}
            </Dropdown>
          )}
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
              <Spinner size="sm" />
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
        {isNew && pageTree.length > 0 && (
          <Select
            label="Parent Page"
            id="parentId"
            value={parentId}
            onChange={(v) => setParentId(v as string)}
            options={parentOptions}
            placeholder="None (top level)"
          />
        )}

        <div className={cn('gap-4', showPreview ? 'grid grid-cols-2' : '')}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text">Content</label>
            {useCollab && collab.ydoc && collab.provider ? (
              <CollaborativeEditor
                ydoc={collab.ydoc}
                provider={collab.provider}
                fragmentName={collab.fragmentName}
                onChange={setBody}
                placeholder="Write your content..."
              />
            ) : (
              <MarkdownEditor value={body} onChange={setBody} placeholder="Write your content..." />
            )}
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

        {/* Attachments (existing pages only) */}
        {!isNew && existingPage?.id && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-3 flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5" />
              Attachments
              {pageAttachments.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary normal-case tracking-normal">
                  {pageAttachments.length}
                </span>
              )}
            </h2>
            <AttachmentList
              attachments={pageAttachments}
              currentUserId={user?.id}
              onDelete={(id) => deleteAttachmentMutation.mutate(id)}
            />
            <FileUpload
              className="mt-3"
              uploadFn={(file) => attachmentsApi.upload(file, { pageId: existingPage.id })}
              onUpload={() =>
                queryClient.invalidateQueries({ queryKey: ['attachments', existingPage.id] })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
