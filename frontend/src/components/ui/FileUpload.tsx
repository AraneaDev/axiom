import { Upload, X, AlertCircle } from 'lucide-react';
import { forwardRef, useCallback, useRef, useState, type DragEvent } from 'react';

import { Button } from './Button';
import { Spinner } from './Spinner';

import { cn } from '@/lib/utils';

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
];

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileUploadProps {
  onUpload: (attachment: unknown) => void;
  uploadFn: (file: File) => Promise<unknown>;
  className?: string;
  accept?: string;
}

export const FileUpload = forwardRef<HTMLDivElement, FileUploadProps>(
  ({ onUpload, uploadFn, className, accept }, ref) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const validateFile = useCallback((file: File): string | null => {
      if (file.size > MAX_SIZE) {
        return `File too large. Maximum size is ${formatSize(MAX_SIZE)}.`;
      }
      if (!ALLOWED_TYPES.includes(file.type) && file.type !== '') {
        return 'File type not allowed. Supported: images, documents, archives.';
      }
      return null;
    }, []);

    const handleFile = useCallback(
      async (file: File) => {
        const validationError = validateFile(file);
        if (validationError) {
          setError(validationError);
          return;
        }

        setError(null);
        setIsUploading(true);
        try {
          const result = await uploadFn(file);
          onUpload(result);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setIsUploading(false);
        }
      },
      [uploadFn, onUpload, validateFile],
    );

    const handleDragOver = useCallback((e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
      (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      },
      [handleFile],
    );

    const handleClick = useCallback(() => {
      inputRef.current?.click();
    }, []);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        // Reset so the same file can be re-selected
        e.target.value = '';
      },
      [handleFile],
    );

    return (
      <div ref={ref} className={cn('space-y-2', className)}>
        <div
          role="button"
          tabIndex={0}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleClick();
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors',
            'border-border bg-surface hover:bg-surface-secondary',
            isDragging && 'border-primary bg-primary-light',
            isUploading && 'pointer-events-none opacity-60',
          )}
        >
          {isUploading ? (
            <Spinner className="h-6 w-6" />
          ) : (
            <Upload className="h-6 w-6 text-text-secondary" />
          )}
          <div className="text-sm text-text-secondary text-center">
            {isUploading ? (
              'Uploading...'
            ) : (
              <>
                <span className="font-medium text-text">Drop a file here</span> or click to browse
              </>
            )}
          </div>
          <div className="text-xs text-text-tertiary">Max {formatSize(MAX_SIZE)}</div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={accept}
            onChange={handleInputChange}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
            <Button variant="ghost" size="xs" onClick={() => setError(null)} title="Dismiss error">
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    );
  },
);
FileUpload.displayName = 'FileUpload';
