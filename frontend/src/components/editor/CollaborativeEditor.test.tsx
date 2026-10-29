import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import type { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

// Node's own localStorage global breaks the API client's module setup; the editor never calls it
vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getAccessToken: () => null,
}));

import { CollaborativeEditor } from './CollaborativeEditor';

function setup() {
  const ydoc = new Y.Doc();
  const provider = { awareness: new Awareness(ydoc) } as unknown as WebsocketProvider;
  return { ydoc, provider };
}

const editable = () =>
  document.querySelector('.tiptap-editor')?.getAttribute('contenteditable') ?? null;

describe('CollaborativeEditor lock', () => {
  it('is read-only with a Merging overlay while locked, and editable again after', async () => {
    const { ydoc, provider } = setup();
    const { rerender } = render(
      <CollaborativeEditor ydoc={ydoc} provider={provider} fragmentName="default" />,
    );
    await waitFor(() => expect(editable()).toBe('true'));

    rerender(
      <CollaborativeEditor
        ydoc={ydoc}
        provider={provider}
        fragmentName="default"
        locked={{ byName: 'Tim' }}
      />,
    );
    // Applied in the same commit as the lock (layout effect), no waiting
    expect(editable()).toBe('false');
    expect(screen.getByText('Merging…')).toBeInTheDocument();
    expect(screen.getByText(/Tim is applying a merge/)).toBeInTheDocument();

    rerender(<CollaborativeEditor ydoc={ydoc} provider={provider} fragmentName="default" />);
    expect(editable()).toBe('true');
    expect(screen.queryByText('Merging…')).not.toBeInTheDocument();
  });

  it('is read-only for a user who cannot edit', async () => {
    const { ydoc, provider } = setup();
    render(
      <CollaborativeEditor
        ydoc={ydoc}
        provider={provider}
        fragmentName="default"
        canEdit={false}
      />,
    );
    await waitFor(() => expect(document.querySelector('.tiptap-editor')).not.toBeNull());
    expect(editable()).toBe('false');
  });
});
