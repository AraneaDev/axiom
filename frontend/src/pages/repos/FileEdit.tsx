import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useParams, useNavigate } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { useRepoContext } from '@/hooks/useRepoContext';

/**
 *
 */
export default function FileEdit() {
  const { ref, '*': filePath } = useParams();
  const { currentRepo, basePath, repoSlug } = useRepoContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const parts = filePath?.split('/') ?? [];
  const fileName = parts[parts.length - 1] ?? '';
  const isMarkdown = /\.mdx?$/i.test(fileName);

  const {
    data: blob,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['blob', currentRepo?.id, ref, filePath],
    queryFn: () => reposApi.getBlob(currentRepo!.id, ref!, filePath!),
    enabled: !!currentRepo?.id && !!ref && !!filePath,
  });

  const [content, setContent] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState(`Update ${fileName}`);

  // Once blob loads, initialize content state (only once)
  const effectiveContent = content ?? blob?.content ?? '';

  const blobUrl = `${basePath}/blob/${ref}/${filePath}`;

  const mutation = useMutation({
    mutationFn: () =>
      reposApi.updateFile(currentRepo!.id, ref!, filePath!, {
        content: effectiveContent,
        message: commitMessage,
        branch: ref!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blob', currentRepo?.id, ref, filePath] });
      toast.success('File saved successfully');
      navigate(blobUrl);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save file');
    },
  });

  if (!ref || !filePath) {
    return <Navigate to={basePath} replace />;
  }

  if (isLoading) return <PageLoader />;

  if (isError) {
    return (
      <div className="p-6 text-danger">
        Failed to load file.{' '}
        <Link to={blobUrl} className="text-primary underline">
          Go back
        </Link>
      </div>
    );
  }

  const handleContentChange = (val: string) => {
    setContent(val);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm flex-wrap">
        <Link to={basePath} className="text-primary hover:underline">
          {repoSlug}
        </Link>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-secondary" />
            {i < parts.length - 1 ? (
              <Link
                to={`${basePath}/tree/${ref}/${parts.slice(0, i + 1).join('/')}`}
                className="text-primary hover:underline"
              >
                {p}
              </Link>
            ) : (
              <span className="font-medium">{p}</span>
            )}
          </span>
        ))}
        <ChevronRight className="h-3 w-3 text-text-secondary" />
        <span className="text-text-secondary">Edit</span>
      </div>

      {/* Editor */}
      {isMarkdown ? (
        <div className="rounded-lg border border-border bg-surface min-h-96">
          <MarkdownEditor value={effectiveContent} onChange={handleContentChange} />
        </div>
      ) : (
        <Textarea
          className="min-h-96 font-mono resize-y"
          value={effectiveContent}
          onChange={(e) => handleContentChange(e.target.value)}
          spellCheck={false}
        />
      )}

      {/* Commit panel */}
      <div className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-3">
        <div className="text-sm font-medium text-text">Commit changes</div>
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span className="font-medium">Branch:</span>
          <span className="font-mono text-text">{ref}</span>
        </div>
        <Input
          label="Commit message"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Describe your changes"
        />
        <div className="flex items-center gap-2 justify-end">
          <Link to={blobUrl}>
            <Button variant="ghost" size="sm">
              <X className="h-4 w-4" /> Cancel
            </Button>
          </Link>
          <Button
            variant="primary"
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !commitMessage.trim()}
          >
            <Save className="h-4 w-4" /> {mutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
