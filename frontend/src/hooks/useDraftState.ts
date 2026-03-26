import { useState } from 'react';

/**
 * Manages draft text state for inline editing patterns.
 * @param initialValue - The default value to reset to on cancel
 */
export function useDraftState(initialValue: string = '') {
  const [draft, setDraft] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);

  const startEditing = (value?: string) => {
    if (value !== undefined) setDraft(value);
    setIsEditing(true);
  };

  const cancel = () => {
    setDraft(initialValue);
    setIsEditing(false);
  };

  const reset = () => {
    setDraft('');
    setIsEditing(false);
  };

  return { draft, setDraft, isEditing, startEditing, cancel, reset };
}
