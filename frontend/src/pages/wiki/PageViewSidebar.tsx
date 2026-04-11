/* eslint-disable react-refresh/only-export-components */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { FileText, FolderPlus, Lock, Plus } from 'lucide-react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';

import { PageTreeNodeItem } from './sidebar/PageTreeNode';
import { TableOfContents } from './sidebar/TableOfContents';
import {
  collectAncestorIds,
  countDescendants,
  findNodeById,
  findSiblings,
  isDescendant,
  type DropTarget,
  type DropZone,
} from './sidebar/wiki-tree-utils';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import type { PageTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { TocEntry } from '@/lib/wiki-types';

// Re-export extractToc so existing consumers keep working
export { extractToc } from './sidebar/wiki-tree-utils';

interface PageViewSidebarProps {
  tree: PageTreeNode[] | undefined;
  basePath: string;
  tocEntries: TocEntry[];
  activeSlug?: string;
  onNewFolder?: (parentId?: string) => void;
  /** When true, hides the built-in header (New Page / New Folder buttons) */
  embedded?: boolean;
  className?: string;
  spaceId?: string;
  /** When true, shows a lock icon indicating the space has custom permissions */
  hasPermissions?: boolean;
}

/**
 * Sidebar showing page tree and table of contents.
 * @param root0
 * @param root0.tree
 * @param root0.basePath
 * @param root0.tocEntries
 * @param root0.activeSlug
 * @param root0.onNewFolder
 * @param root0.embedded
 * @param root0.className
 * @param root0.spaceId
 * @param root0.hasPermissions
 */
export function PageViewSidebar({
  tree,
  basePath,
  tocEntries,
  activeSlug,
  onNewFolder,
  embedded,
  className,
  spaceId,
  hasPermissions,
}: PageViewSidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<PageTreeNode | null>(null);
  const navigate = useNavigate();

  const deleteMutation = useMutationWithToast(
    () => wikiApi.deletePage(spaceId!, deleteTarget!.slug),
    {
      successMessage: null,
      invalidateKeys: [['pageTree'], ['page']],
      onSuccess: () => {
        const wasActive = deleteTarget?.slug === activeSlug;
        setDeleteTarget(null);
        if (wasActive) {
          navigate(basePath);
        }
      },
    },
  );

  const defaultExpanded = useMemo(() => {
    if (!tree || !activeSlug) return new Set<string>();
    const ids = collectAncestorIds(tree, activeSlug);
    return new Set<string>(ids ?? []);
  }, [tree, activeSlug]);

  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // DnD state
  const [activeNode, setActiveNode] = useState<PageTreeNode | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const pointerYRef = useRef(0);
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Track pointer position for zone detection
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      pointerYRef.current = e.clientY;
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  const reorderMutation = useMutationWithToast(
    (data: { pageId: string; parentId: string | null; position: number }) =>
      wikiApi.reorderPage(data.pageId, { parentId: data.parentId, position: data.position }),
    { successMessage: null, invalidateKeys: [['pageTree']] },
  );

  function handleDragStart(event: DragStartEvent) {
    const node = tree ? findNodeById(tree, event.active.id as string) : undefined;
    setActiveNode(node || null);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!event.over) {
      setDropTarget(null);
      return;
    }

    const overId = event.over.id as string;
    const overRect = event.over.rect;
    const relativeY = pointerYRef.current - overRect.top;
    const height = overRect.height;

    let zone: DropZone;
    if (relativeY < height * 0.25) zone = 'before';
    else if (relativeY > height * 0.75) zone = 'after';
    else zone = 'child';

    // Prevent dropping onto self or descendants
    if (activeNode) {
      if (overId === activeNode.id) {
        setDropTarget(null);
        return;
      }
      if (zone === 'child' && isDescendant(activeNode, overId)) {
        setDropTarget(null);
        return;
      }
    }

    // Auto-expand collapsed nodes when hovering in child zone
    if (zone === 'child' && !expanded.has(overId)) {
      if (!expandTimeoutRef.current) {
        expandTimeoutRef.current = setTimeout(() => {
          handleToggle(overId);
          expandTimeoutRef.current = undefined;
        }, 500);
      }
    } else {
      clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = undefined;
    }

    setDropTarget({ nodeId: overId, zone });
  }

  function handleDragEnd(_event: DragEndEvent) {
    clearTimeout(expandTimeoutRef.current);
    expandTimeoutRef.current = undefined;

    if (!activeNode || !dropTarget || !tree) {
      setActiveNode(null);
      setDropTarget(null);
      return;
    }

    const targetNode = findNodeById(tree, dropTarget.nodeId);
    if (!targetNode) {
      setActiveNode(null);
      setDropTarget(null);
      return;
    }

    let parentId: string | null;
    let position: number;

    if (dropTarget.zone === 'child') {
      parentId = targetNode.id;
      position = 0;
      // Auto-expand the target so moved page is visible
      if (!expanded.has(targetNode.id)) {
        handleToggle(targetNode.id);
      }
    } else {
      parentId = targetNode.parentId ?? null;
      const siblings = findSiblings(tree, targetNode);
      const targetIdx = siblings.findIndex((s) => s.id === targetNode.id);
      position = dropTarget.zone === 'before' ? targetIdx : targetIdx + 1;
      // Adjust if moving within same parent and from earlier position
      if (parentId === (activeNode.parentId ?? null)) {
        const currentIdx = siblings.findIndex((s) => s.id === activeNode.id);
        if (currentIdx !== -1 && currentIdx < position) position--;
      }
    }

    reorderMutation.mutate({ pageId: activeNode.id, parentId, position });
    setActiveNode(null);
    setDropTarget(null);
  }

  function handleDragCancel() {
    clearTimeout(expandTimeoutRef.current);
    expandTimeoutRef.current = undefined;
    setActiveNode(null);
    setDropTarget(null);
  }

  return (
    <div className={cn('', className)}>
      {!embedded && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-1.5">
            Pages
            {hasPermissions && (
              <span title="This space has custom access permissions">
                <Lock className="h-3 w-3 text-warning" />
              </span>
            )}
          </h3>
          <div className="flex gap-1">
            <Tooltip content="New Page">
              <Link to={`${basePath}/new/edit`}>
                <Button variant="ghost" size="xs">
                  <Plus className="h-3.5 w-3.5" /> New Page
                </Button>
              </Link>
            </Tooltip>
            <Tooltip content="New Folder">
              <Button variant="ghost" size="xs" onClick={() => onNewFolder?.()}>
                <FolderPlus className="h-3.5 w-3.5" /> New Folder
              </Button>
            </Tooltip>
          </div>
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="space-y-0.5 mb-6">
          {tree?.map((node) => (
            <PageTreeNodeItem
              key={node.id}
              node={node}
              basePath={basePath}
              activeSlug={activeSlug}
              expanded={expanded}
              onToggle={handleToggle}
              onNewFolder={onNewFolder}
              onDelete={setDeleteTarget}
              dropTarget={dropTarget}
            />
          ))}
        </div>
        <DragOverlay>
          {activeNode && (
            <div className="flex items-center gap-2 rounded-md bg-surface border border-border px-3 py-1.5 shadow-lg text-sm">
              <FileText className="h-3.5 w-3.5 text-text-secondary" />
              {activeNode.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate()}
        title={`Delete "${deleteTarget?.title}"?`}
        description={
          deleteTarget && countDescendants(deleteTarget) > 0
            ? `This will also delete ${countDescendants(deleteTarget)} child page${countDescendants(deleteTarget) === 1 ? '' : 's'}. This action cannot be undone.`
            : 'This action cannot be undone.'
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />

      {/* Table of contents -- only in standalone mode, not when embedded in WikiLayout */}
      {!embedded && tocEntries.length > 0 && (
        <div className="border-t border-border-light pt-4">
          <TableOfContents entries={tocEntries} />
        </div>
      )}
    </div>
  );
}
