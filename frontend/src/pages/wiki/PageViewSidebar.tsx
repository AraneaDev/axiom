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
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Hash,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import type { PageTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

/**
 *
 * @param markdown
 */
export function extractToc(markdown: string): TocEntry[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const entries: TocEntry[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    entries.push({ level: match[1].length, text, id });
  }
  return entries;
}

function TableOfContents({ entries }: { entries: TocEntry[] }) {
  if (!entries.length) return null;

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className="space-y-1">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        On this page
      </h3>
      {entries.map((entry, i) => (
        <Button
          key={`${entry.id}-${i}`}
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => scrollTo(entry.id)}
          className={cn(
            'w-full justify-start text-text-tertiary hover:text-primary truncate',
            entry.level === 1 && 'font-medium text-text-secondary',
            entry.level === 2 && 'pl-3',
            entry.level === 3 && 'pl-6 text-xs',
          )}
        >
          <Hash className="h-3 w-3" /> {entry.text}
        </Button>
      ))}
    </nav>
  );
}

/**
 * Collect all ancestor node IDs for a given slug so we can auto-expand the path.
 * @param nodes
 * @param targetSlug
 * @param ancestors
 * @param node
 */
function countDescendants(node: PageTreeNode): number {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}

function collectAncestorIds(
  nodes: PageTreeNode[],
  targetSlug: string,
  ancestors: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.slug === targetSlug) {
      return ancestors;
    }
    if (node.children.length > 0) {
      const found = collectAncestorIds(node.children, targetSlug, [...ancestors, node.id]);
      if (found) return found;
    }
  }
  return null;
}

type DropZone = 'before' | 'child' | 'after';

interface DropTarget {
  nodeId: string;
  zone: DropZone;
}

function findNodeById(nodes: PageTreeNode[], id: string): PageTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return undefined;
}

function findSiblings(tree: PageTreeNode[], target: PageTreeNode): PageTreeNode[] {
  if (!target.parentId) return tree;
  const parent = findNodeById(tree, target.parentId);
  return parent?.children ?? tree;
}

function isDescendant(node: PageTreeNode, targetId: string): boolean {
  for (const child of node.children) {
    if (child.id === targetId) return true;
    if (isDescendant(child, targetId)) return true;
  }
  return false;
}

function TreeNode({
  node,
  basePath,
  depth = 0,
  activeSlug,
  expanded,
  onToggle,
  onNewFolder,
  onDelete,
  dropTarget,
}: {
  node: PageTreeNode;
  basePath: string;
  depth?: number;
  activeSlug?: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNewFolder?: (parentId?: string) => void;
  onDelete?: (node: PageTreeNode) => void;
  dropTarget?: DropTarget | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isActive = node.slug === activeSlug;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: node.id,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: node.id,
  });

  return (
    <div className={cn(isDragging && 'opacity-30')}>
      {/* Row — droppable ref is on the row only, not the children wrapper */}
      <div
        ref={(el: HTMLElement | null) => {
          setDragRef(el);
          setDropRef(el);
        }}
        {...attributes}
        className={cn(
          'group relative flex items-center gap-1 py-1 px-1 rounded-md text-sm hover:bg-surface-tertiary transition-colors',
          isActive && 'bg-primary-light text-primary font-medium',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {/* Drop indicators */}
        {dropTarget?.nodeId === node.id && dropTarget.zone === 'before' && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10" />
        )}
        {dropTarget?.nodeId === node.id && dropTarget.zone === 'child' && (
          <div className="absolute inset-0 rounded-md bg-primary/10 border border-primary/30 z-0 pointer-events-none" />
        )}
        {dropTarget?.nodeId === node.id && dropTarget.zone === 'after' && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10" />
        )}
        {/* Collapse toggle */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="shrink-0 p-0.5 rounded hover:bg-surface-secondary transition-colors text-text-tertiary"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="shrink-0 w-[18px]" />
        )}

        {/* Icon */}
        {hasChildren ? (
          isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 text-text-secondary shrink-0" />
          ) : (
            <Folder className="h-3.5 w-3.5 text-text-secondary shrink-0" />
          )
        ) : (
          <FileText className="h-3.5 w-3.5 text-text-secondary shrink-0" />
        )}

        {/* Link */}
        <Link to={`${basePath}/${node.slug}`} className="truncate flex-1 py-0.5">
          {node.title}
        </Link>

        {/* Drag handle */}
        <button
          {...listeners}
          type="button"
          className="shrink-0 cursor-grab opacity-0 group-hover:opacity-100 p-0.5 text-text-tertiary"
          title="Drag to reorder"
        >
          <GripVertical className="h-3 w-3" />
        </button>

        {/* Context menu */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Dropdown
            trigger={
              <button
                type="button"
                className="p-0.5 rounded hover:bg-surface-secondary text-text-tertiary"
                title="Actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
            align="right"
          >
            <DropdownItem
              onClick={() => {
                window.location.href = `${basePath}/new/edit?parent=${node.id}`;
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New Child Page
            </DropdownItem>
            <DropdownItem onClick={() => onNewFolder?.(node.id)}>
              <FolderPlus className="h-3.5 w-3.5" /> New Folder
            </DropdownItem>
            <DropdownItem onClick={() => onDelete?.(node)} danger>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownItem>
          </Dropdown>
        </div>
      </div>

      {/* Children (collapsible) */}
      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            basePath={basePath}
            depth={depth + 1}
            activeSlug={activeSlug}
            expanded={expanded}
            onToggle={onToggle}
            onNewFolder={onNewFolder}
            onDelete={onDelete}
            dropTarget={dropTarget}
          />
        ))}
    </div>
  );
}

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
}: PageViewSidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<PageTreeNode | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const deleteMutation = useMutation({
    mutationFn: () => wikiApi.deletePage(spaceId!, deleteTarget!.slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['page'] });
      const wasActive = deleteTarget?.slug === activeSlug;
      setDeleteTarget(null);
      if (wasActive) {
        navigate(basePath);
      }
    },
  });

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

  const reorderMutation = useMutation({
    mutationFn: (data: { pageId: string; parentId: string | null; position: number }) =>
      wikiApi.reorderPage(data.pageId, { parentId: data.parentId, position: data.position }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
    },
  });

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
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Pages
          </h3>
          <div className="flex gap-1">
            <Link to={`${basePath}/new/edit`}>
              <Button variant="ghost" size="xs" title="New Page">
                <Plus className="h-3.5 w-3.5" /> New Page
              </Button>
            </Link>
            <Button variant="ghost" size="xs" title="New Folder" onClick={() => onNewFolder?.()}>
              <FolderPlus className="h-3.5 w-3.5" /> New Folder
            </Button>
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
            <TreeNode
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
