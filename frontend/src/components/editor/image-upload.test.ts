import { renderHook } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpload = vi.fn();
vi.mock('@/api/attachments.api', () => ({
  attachmentsApi: {
    upload: (...args: unknown[]) => mockUpload(...args),
    getDownloadUrl: (id: string) => `/api/attachments/${id}`,
  },
}));
const toastError = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useOptionalToast: () => ({ error: toastError }),
}));

import { altTextFor, uploadAndInsertImage, useImageUpload } from './image-upload';

function fakeEditor() {
  const run = vi.fn();
  const setImage = vi.fn(() => ({ run }));
  const editor = {
    isDestroyed: false,
    chain: () => ({ focus: () => ({ setImage }) }),
  } as unknown as Editor;
  return { editor, setImage, run };
}

describe('altTextFor', () => {
  it('drops the extension and the characters that end Markdown alt text', () => {
    expect(altTextFor('chart.final.png')).toBe('chart.final');
    expect(altTextFor('a [b] \\c.png')).toBe('a b c');
    expect(altTextFor('noext')).toBe('noext');
  });
});

describe('uploadAndInsertImage', () => {
  beforeEach(() => {
    mockUpload.mockReset();
    toastError.mockReset();
  });

  it('inserts the attachment path with the alt text and uploads to the target', async () => {
    const { editor, setImage } = fakeEditor();
    const { unmount } = renderHook(() => useImageUpload(editor, { pageId: 'p1' }));
    mockUpload.mockResolvedValue({ id: 'abc', originalName: 'pixel.png' });
    const file = new File(['x'], 'pixel.png');
    await uploadAndInsertImage(editor, file);
    expect(mockUpload).toHaveBeenCalledWith(file, { issueId: undefined, pageId: 'p1' });
    expect(setImage).toHaveBeenCalledWith({ src: '/api/attachments/abc', alt: 'pixel' });
    unmount();
  });

  it('reports a failed upload and inserts nothing', async () => {
    const { editor, setImage } = fakeEditor();
    const { unmount } = renderHook(() => useImageUpload(editor));
    mockUpload.mockRejectedValue(new Error('File too large'));
    await uploadAndInsertImage(editor, new File(['x'], 'big.png'));
    expect(toastError).toHaveBeenCalledWith('File too large');
    expect(setImage).not.toHaveBeenCalled();
    unmount();
  });
});
