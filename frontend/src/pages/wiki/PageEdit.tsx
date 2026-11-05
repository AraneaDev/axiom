import { useQuery } from '@tanstack/react-query';
import { Eye, Paperclip } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { attachmentsApi } from '@/api/attachments.api';
import { wikiApi } from '@/api/wiki.api';
import { QueryBlockScope } from '@/components/dashboards/query-block-scope';
import { CollaborativeEditor } from '@/components/editor/CollaborativeEditor';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Dropdown';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { ConflictView } from '@/components/wiki/ConflictView';
import { ExternalChangeBanner } from '@/components/wiki/ExternalChangeBanner';
import { TemplateVariablePanel } from '@/components/wiki/TemplateVariablePanel';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useFormError } from '@/hooks/useFormError';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { usePendingMerge } from '@/hooks/usePendingMerge';
import { useWikiInvalidation } from '@/hooks/useWikiInvalidation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

import { PageEditHeader } from './PageEditHeader';
import { TemplatePicker } from './TemplatePicker';
import { useWikiContext } from './WikiLayout';

/** How long the page waits for its live session before editing without one. */
export const COLLAB_SYNC_TIMEOUT_MS = 10_000;

/**
 *
 */
export default function PageEdit() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [searchParams] = useSearchParams();
  const { currentSpace, currentTeam } = useWikiContext();
  const { invalidateAttachments } = useWikiInvalidation(currentSpace?.id ?? '', pageSlug);

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

  const deleteAttachmentMutation = useMutationWithToast((id: string) => attachmentsApi.remove(id), {
    successMessage: null,
    invalidateKeys: [['attachments', existingPage?.id]],
  });

  // Real-time collaboration (only for existing pages, not new ones)
  const [collabGaveUp, setCollabGaveUp] = useState(false);
  const collabEnabled = !isNew && !!existingPage?.id && !!currentSpace && !collabGaveUp;
  const collab = useCollaboration({
    pageId: existingPage?.id,
    enabled: collabEnabled,
  });
  // Never swap one editor for the other with text in it: the collaborative editor starts from the
  // session and the plain one from the saved page, so the swap would drop what was typed. Once
  // synced the session stays through a lost connection, as the Yjs document keeps what is typed
  // and hands it over on reconnecting. Before that nothing is editable, until it is clear no
  // session is coming, and then the plain editor stays.
  const useCollab = collabEnabled && collab.hasSynced && collab.ydoc && collab.provider;
  const waitingForSession = collabEnabled && !collab.hasSynced;
  useEffect(() => {
    if (!waitingForSession) return;
    const timer = setTimeout(() => setCollabGaveUp(true), COLLAB_SYNC_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waitingForSession]);
  // The server holds the body only while connected; offline the local text is what can be saved
  const sessionHoldsBody = useCollab && collab.isConnected && collab.isSynced;

  // The page says whether this user may edit it; a 403 from the merge endpoints is the fallback
  const pendingChange = useCollab ? collab.pendingChange : null;
  const pageAllowsEdit = isNew || existingPage?.canEdit !== false;
  const { forbidden: cannotMerge } = usePendingMerge(
    currentSpace?.id,
    pageSlug,
    pendingChange?.externalVersionId,
    pageAllowsEdit,
  );
  // The live session can also take editing away (a permission change mid-session)
  const sessionReadOnly = useCollab ? collab.readOnly : false;
  const canEdit = pageAllowsEdit && !cannotMerge && !sessionReadOnly;
  const [showConflicts, setShowConflicts] = useState(false);
  const closeConflicts = () => setShowConflicts(false);
  // Once the change is merged (here or by someone else) the conflict view has nothing left to show
  const [shownPending, setShownPending] = useState(pendingChange);
  if (shownPending !== pendingChange) {
    setShownPending(pendingChange);
    if (!pendingChange) setShowConflicts(false);
  }
  const conflictsOpen = showConflicts && !!pendingChange && canEdit;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [body, setBody] = useState('');
  const [parentId, setParentId] = useState<string>(searchParams.get('parent') ?? '');
  const [changeDescription, setChangeDescription] = useState('');
  const { error, setError } = useFormError();

  // Text typed while disconnected. A reconnect to the same session syncs it by itself. When that
  // session has ended, its document can't join the new one, so this goes to the new session as a
  // change to merge: sent while that session is live, so it can't overwrite anything silently.
  const typedOffline = useRef<string | null>(null);
  const toHandOver = useRef<string | null>(null);
  const { sessionEnded, rejoin } = collab;
  useEffect(() => {
    if (!sessionEnded) return;
    toHandOver.current = typedOffline.current;
    typedOffline.current = null;
    rejoin();
  }, [sessionEnded, rejoin]);
  const spaceId = currentSpace?.id;
  useEffect(() => {
    if (!sessionHoldsBody) return;
    typedOffline.current = null;
    const text = toHandOver.current;
    if (text === null || !spaceId) return;
    toHandOver.current = null;
    wikiApi.updatePage(spaceId, pageSlug!, { body: text }).catch((err: Error) => {
      setError(`Text typed offline could not be saved: ${err.message}`);
    });
  }, [sessionHoldsBody, spaceId, pageSlug, setError]);
  const [showPreview, setShowPreview] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(isNew);
  const [showVariablePanel, setShowVariablePanel] = useState(false);

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

  const saveMutation = useMutationWithToast(
    async () => {
      if (!currentSpace) throw new Error('Space not found');
      if (isNew) {
        return wikiApi.createPage(currentSpace.id, {
          title,
          slug,
          body,
          ...(parentId ? { parentId } : {}),
        });
      } else {
        // In a collaborative session the server holds the body: save the live document first,
        // with the change description on the version it creates, then send only the metadata so
        // a stale local copy can never overwrite it.
        const description = changeDescription.trim();
        let flushed = false;
        if (sessionHoldsBody) {
          try {
            flushed = (
              await wikiApi.flushCollab(currentSpace.id, pageSlug!, description || undefined)
            ).flushed;
          } catch (err) {
            // The room may have just closed (and saved itself): the metadata save still goes ahead
            console.warn('Collab flush failed', err);
          }
        }
        return wikiApi.updatePage(currentSpace.id, pageSlug!, {
          title,
          ...(sessionHoldsBody ? {} : { body }),
          // No parent here: the form has no parent picker for an existing page, so sending one
          // would move it (null means the top level). Moving is the sidebar's job.
          // The flush already stored the description; without a live room the PATCH carries it
          ...(description && !flushed ? { changeDescription: description } : {}),
        });
      }
    },
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['page'], ['page-tree']],
      onSuccess: () => {
        // Clear draft on successful save
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore storage errors */
        }
        navigate(`/${org}/${team}/wiki/${spaceSlug}/${isNew ? slug : pageSlug}`);
      },
      onError: (err) => setError(err.message || 'Failed to save'),
    },
  );

  async function applyTemplate(tpl: { name: string; body: string }) {
    let resolvedBody = tpl.body;
    if (currentSpace && currentTeam) {
      try {
        const result = await wikiApi.resolveTemplate(tpl.body, {
          teamId: currentTeam.id,
          spaceId: currentSpace.id,
        });
        resolvedBody = result.body;
      } catch {
        // Fall back to raw template body if resolution fails
      }
    }
    setBody(resolvedBody);
    if (!title.trim()) handleTitleChange(tpl.name);
    setShowTemplatePicker(false);
  }

  if (!currentSpace || (!isNew && isLoading)) return <PageLoader />;

  return (
    <div>
      <PageEditHeader
        isNew={isNew}
        hasExistingPage={!!existingPage?.id}
        draftStatus={draftStatus}
        showTemplatePicker={showTemplatePicker}
        onToggleTemplatePicker={() => setShowTemplatePicker(!showTemplatePicker)}
        hasTemplates={templates.length > 0}
        showVariablePanel={showVariablePanel}
        onToggleVariablePanel={() => setShowVariablePanel(!showVariablePanel)}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview(!showPreview)}
        onCancel={() => navigate(-1)}
        onSave={() => saveMutation.mutate()}
        isSaving={saveMutation.isPending}
        canSave={!!title.trim() && canEdit}
        readOnly={!canEdit}
        isConnected={collab.isConnected}
        presenceUsers={collab.presenceUsers}
      />

      {error && (
        <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Template Picker */}
      {isNew && showTemplatePicker && templates.length > 0 && (
        <TemplatePicker
          templates={templates}
          onSelect={applyTemplate}
          onBlank={() => {
            setBody('');
            setTitle('');
            setSlug('');
            setShowTemplatePicker(false);
          }}
        />
      )}

      {useCollab && currentSpace && pageSlug && (
        <ExternalChangeBanner
          spaceId={currentSpace.id}
          pageSlug={pageSlug}
          pendingChange={pendingChange}
          resolvedBy={collab.resolvedBy}
          canEdit={canEdit}
          locked={collab.locked}
          onOpenConflicts={() => setShowConflicts(true)}
          onDismissResolved={collab.dismissResolved}
        />
      )}

      {conflictsOpen && currentSpace && pageSlug && pendingChange && (
        <ConflictView
          spaceId={currentSpace.id}
          pageSlug={pageSlug}
          externalVersionId={pendingChange.externalVersionId}
          locked={collab.locked}
          onClose={closeConflicts}
        />
      )}

      {!isNew && !canEdit && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-surface-secondary px-3 py-2 text-[13px] text-text-secondary"
        >
          <Eye className="h-4 w-4" />
          You can view this page but not edit it.
        </div>
      )}

      <div className="space-y-4">
        <Input
          id="title"
          label="Title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Page title"
          readOnly={!canEdit}
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

        {/* Hidden, not unmounted, while resolving conflicts: the merge replaces this content */}
        <QueryBlockScope value={{ pageId: existingPage?.id, editing: true }}>
          <div className="flex gap-0" hidden={conflictsOpen}>
            <div className={cn('flex-1 gap-4', showPreview ? 'grid grid-cols-2' : '')}>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text">Content</label>
                {useCollab && collab.ydoc && collab.provider ? (
                  <CollaborativeEditor
                    ydoc={collab.ydoc}
                    provider={collab.provider}
                    key={collab.ydoc.guid}
                    fragmentName={collab.fragmentName}
                    onChange={(markdown) => {
                      setBody(markdown);
                      if (!collab.isConnected) typedOffline.current = markdown;
                    }}
                    placeholder="Write your content..."
                    uploadTarget={existingPage?.id ? { pageId: existingPage.id } : undefined}
                    liveBlocks
                    locked={collab.locked}
                    canEdit={canEdit}
                  />
                ) : canEdit && waitingForSession ? (
                  <Card className="min-h-[300px] p-4">
                    <p
                      role="status"
                      className="mb-3 flex items-center gap-2 text-xs text-text-secondary"
                    >
                      <Spinner size="sm" />
                      Joining the live session. You can type as soon as it is ready.
                    </p>
                    <MarkdownRenderer content={body} />
                  </Card>
                ) : canEdit ? (
                  <MarkdownEditor
                    value={body}
                    onChange={setBody}
                    placeholder="Write your content..."
                    uploadTarget={existingPage?.id ? { pageId: existingPage.id } : undefined}
                    liveBlocks
                  />
                ) : (
                  <Card className="min-h-[300px] p-4">
                    <MarkdownRenderer content={body} />
                  </Card>
                )}
              </div>
              {showPreview && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-text">Preview</label>
                  <Card className="p-4 min-h-[300px] overflow-auto">
                    {body ? (
                      <MarkdownRenderer content={body} />
                    ) : (
                      <p className="text-text-tertiary italic text-sm">
                        Start typing to see a preview...
                      </p>
                    )}
                  </Card>
                </div>
              )}
            </div>
            {showVariablePanel && (
              <TemplateVariablePanel onInsert={(variable) => setBody((b) => b + variable)} />
            )}
          </div>
        </QueryBlockScope>

        {/* Change description (existing pages only) */}
        {!isNew && (
          <Input
            id="changeDescription"
            label="Change description (optional)"
            value={changeDescription}
            onChange={(e) => setChangeDescription(e.target.value)}
            placeholder="Briefly describe what you changed"
          />
        )}

        {/* Attachments (existing pages only) */}
        {!isNew && existingPage?.id && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-3 flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5" />
              Attachments
              {pageAttachments.length > 0 && <Badge size="sm">{pageAttachments.length}</Badge>}
            </h2>
            <AttachmentList
              attachments={pageAttachments}
              currentUserId={user?.id}
              onDelete={(id) => deleteAttachmentMutation.mutate(id)}
            />
            <FileUpload
              className="mt-3"
              uploadFn={(file) => attachmentsApi.upload(file, { pageId: existingPage.id })}
              onUpload={() => invalidateAttachments(existingPage.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
