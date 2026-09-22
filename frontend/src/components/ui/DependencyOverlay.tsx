import { useCallback, useEffect, useState } from 'react';

import type { DependencyLink } from '@/api/roadmap.api';

import { DependencyArrow } from './DependencyArrow';

interface IssuePosition {
  x: number;
  y: number;
  width: number;
}

interface DependencyOverlayProps {
  links: DependencyLink[];
  issuePositions: Map<string, IssuePosition>;
  onDeleteLink?: (linkId: string) => void;
  onCreateLink?: (fromId: string, toId: string) => void;
}

/**
 * SVG overlay that renders all dependency arrows between Gantt bars.
 * Supports selecting an arrow and deleting it with the Delete/Backspace key.
 * @param props.links - Array of dependency links to render.
 * @param root0
 * @param root0.links
 * @param props.issuePositions - Map of issue ID to pixel position and width.
 * @param root0.issuePositions
 * @param props.onDeleteLink - Callback to delete a link.
 * @param props.onCreateLink - Callback to create a new link (future drag-to-link).
 * @param root0.onDeleteLink
 */
export function DependencyOverlay({ links, issuePositions, onDeleteLink }: DependencyOverlayProps) {
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  const handleArrowClick = useCallback((linkId: string) => {
    setSelectedLinkId((prev) => (prev === linkId ? null : linkId));
  }, []);

  // Delete selected link on Delete or Backspace key press
  useEffect(() => {
    if (!selectedLinkId || !onDeleteLink) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteLink(selectedLinkId);
        setSelectedLinkId(null);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedLinkId, onDeleteLink]);

  // Clear selection when clicking elsewhere
  useEffect(() => {
    if (!selectedLinkId) return;

    const handler = () => setSelectedLinkId(null);
    // Delay to avoid immediate clearing from the arrow click
    const id = setTimeout(() => {
      window.addEventListener('click', handler, { once: true });
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', handler);
    };
  }, [selectedLinkId]);

  return (
    <>
      {links.map((link) => {
        const fromPos = issuePositions.get(link.fromId);
        const toPos = issuePositions.get(link.toId);
        if (!fromPos || !toPos) return null;

        const fromX = fromPos.x + fromPos.width;
        const fromY = fromPos.y + 14; // center of bar (28/2)
        const toX = toPos.x;
        const toY = toPos.y + 14;
        const isViolation = toX < fromX;

        return (
          <DependencyArrow
            key={link.id}
            fromX={fromX}
            fromY={fromY}
            toX={toX}
            toY={toY}
            isViolation={isViolation}
            isSelected={selectedLinkId === link.id}
            onClick={() => handleArrowClick(link.id)}
          />
        );
      })}
    </>
  );
}
