import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Tooltip } from '@/components/ui/Tooltip';
import type { PageTreeNode as PageTreeNodeType } from '@/lib/types';
import { cn } from '@/lib/utils';

import type { DropTarget } from './wiki-tree-utils';

/**
 *
 * @param root0
 * @param root0.node
 * @param root0.basePath
 * @param root0.depth
 * @param root0.activeSlug
 * @param root0.expanded
 * @param root0.onToggle
 * @param root0.onNewFolder
 * @param root0.onDelete
 * @param root0.dropTarget
 */
/**
 *
 * @param root0
 * @param root0.node
 * @param root0.basePath
 * @param root0.depth
 * @param root0.activeSlug
 * @param root0.expanded
 * @param root0.onToggle
 * @param root0.onNewFolder
 * @param root0.onDelete
 * @param root0.dropTarget
 */
export function PageTreeNodeItem({
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
  node: PageTreeNodeType;
  basePath: string;
  depth?: number;
  activeSlug?: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNewFolder?: (parentId?: string) => void;
  onDelete?: (node: PageTreeNodeType) => void;
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
      {/* Row -- droppable ref is on the row only, not the children wrapper */}
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
          <Tooltip content={isExpanded ? 'Collapse' : 'Expand'}>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={() => onToggle(node.id)}
              className="shrink-0 !p-0.5 text-text-tertiary"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          </Tooltip>
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
        <Tooltip content="Drag to reorder">
          <Button
            {...listeners}
            variant="ghost"
            size="xs"
            type="button"
            className="shrink-0 cursor-grab opacity-0 group-hover:opacity-100 !p-0.5 text-text-tertiary"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-3 w-3" />
          </Button>
        </Tooltip>

        {/* Context menu */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Dropdown
            trigger={
              <Button
                variant="ghost"
                size="xs"
                type="button"
                className="!p-0.5 text-text-tertiary"
                aria-label="Actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
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
          <PageTreeNodeItem
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
