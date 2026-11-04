import type { Editor } from '@tiptap/core';
import { useEffect, useRef } from 'react';

import { attachmentsApi } from '@/api/attachments.api';
import { useOptionalToast } from '@/components/ui/Toast';

/** Where an uploaded image goes. Without a parent the file is staged and binds on save. */
export interface ImageUploadTarget {
  issueId?: string;
  pageId?: string;
}

interface ImageUploadConfig {
  target?: ImageUploadTarget;
  onError: (message: string) => void;
}

const configs = new WeakMap<Editor, ImageUploadConfig>();

/**
 * Tell an editor where its uploaded images go and how to report a failed upload. Used by
 * the editors so the slash command, which only has the editor, can upload.
 * @param editor - The editor, or null before it exists.
 * @param target - The page or issue the images belong to; omit while there is none yet.
 */
export function useImageUpload(editor: Editor | null, target?: ImageUploadTarget): void {
  const toast = useOptionalToast();
  const issueId = target?.issueId;
  const pageId = target?.pageId;
  // The toast API is a new object every render; read it through a ref so the editor's
  // config is set once per editor and target, not on every render
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  useEffect(() => {
    if (!editor) return;
    configs.set(editor, {
      target: issueId || pageId ? { issueId, pageId } : undefined,
      onError: (message) => {
        if (toastRef.current) toastRef.current.error(message);
        else console.error(message);
      },
    });
    return () => {
      configs.delete(editor);
    };
  }, [editor, issueId, pageId]);
}

/**
 * The alt text for an uploaded file: its name without extension, kept free of the
 * brackets that would end the Markdown alt text early.
 * @param name - The uploaded file's name.
 * @returns The alt text.
 */
export function altTextFor(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[[\]\\]/g, '')
    .trim();
}

/**
 * Upload an image file and insert it at the cursor as `![alt](/api/attachments/<id>)`.
 * @param editor - The editor to insert into.
 * @param file - The image file.
 */
export async function uploadAndInsertImage(editor: Editor, file: File): Promise<void> {
  const config = configs.get(editor);
  try {
    const attachment = await attachmentsApi.upload(file, config?.target);
    if (editor.isDestroyed) return;
    editor
      .chain()
      .focus()
      .setImage({
        src: attachmentsApi.getDownloadUrl(attachment.id),
        alt: altTextFor(attachment.originalName),
      })
      .run();
  } catch (err) {
    config?.onError(err instanceof Error ? err.message : 'Image upload failed');
  }
}

/**
 * Open the file chooser and upload what is picked as an image.
 * @param editor - The editor to insert into.
 */
export function pickAndInsertImage(editor: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void uploadAndInsertImage(editor, file);
  });
  input.click();
}

/**
 * Ask for an image URL and insert it.
 * @param editor - The editor to insert into.
 */
export function insertImageFromUrl(editor: Editor): void {
  const url = window.prompt('Image URL:');
  if (url) editor.chain().focus().setImage({ src: url }).run();
}
