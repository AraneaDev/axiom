import { useQuery } from '@tanstack/react-query';
import { Tag, Wand2, X } from 'lucide-react';
import { useState } from 'react';

import { releasesApi } from '@/api/releases.api';
import { reposApi, type BranchInfo } from '@/api/repos.api';
import { Button } from '@/components/ui/Button';

interface Props {
  repoId: string;
  defaultBranch: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.defaultBranch
 * @param root0.onClose
 * @param root0.onCreated
 */
export default function CreateReleaseModal({ repoId, defaultBranch, onClose, onCreated }: Props) {
  const [tagName, setTagName] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetBranch, setTargetBranch] = useState(defaultBranch);
  const [isDraft, setIsDraft] = useState(false);
  const [isPrerelease, setIsPrerelease] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => reposApi.listBranches(repoId),
  });

  const handleGenerateChangelog = async () => {
    if (!tagName || !targetBranch) return;
    try {
      const tags = await releasesApi.list(repoId);
      const lastTag = tags.filter((t) => !t.isDraft)[0]?.tagName;
      if (!lastTag) {
        setBody('No previous release found to compare against.');
        return;
      }
      const { changelog } = await releasesApi.compare(repoId, lastTag, targetBranch);
      const lines: string[] = [];
      for (const section of changelog) {
        lines.push(`## ${section.label}\n`);
        for (const c of section.commits) {
          lines.push(`- ${c.message} (${c.shortSha})`);
        }
        lines.push('');
      }
      setBody(lines.join('\n'));
    } catch {
      setBody('Could not generate changelog.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await releasesApi.create(repoId, {
        tagName,
        title,
        body,
        isDraft,
        isPrerelease,
        targetBranch,
      });
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create release');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-elevated rounded-xl border border-border shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Tag className="h-5 w-5" /> New Release
          </h2>
          <Button variant="ghost" size="xs" onClick={onClose} title="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-text-secondary mb-1.5 block">
                Tag Name
              </label>
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                required
                placeholder="v1.0.0"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary mb-1.5 block">
                Target Branch
              </label>
              <select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
              >
                {branches.length > 0 ? (
                  branches.map((b: BranchInfo) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))
                ) : (
                  <option value={defaultBranch}>{defaultBranch}</option>
                )}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary mb-1.5 block">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Release title"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-text-secondary">Release Notes</label>
              <Button type="button" variant="ghost" size="sm" onClick={handleGenerateChangelog}>
                <Wand2 className="h-3.5 w-3.5" /> Auto-generate
              </Button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Describe the changes in this release..."
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors font-mono resize-y"
            />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isDraft}
                onChange={(e) => setIsDraft(e.target.checked)}
                className="rounded"
              />
              Save as draft
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isPrerelease}
                onChange={(e) => setIsPrerelease(e.target.checked)}
                className="rounded"
              />
              Pre-release
            </label>
          </div>

          {error && <p className="text-sm text-danger bg-danger-light p-3 rounded-lg">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              <Tag className="h-4 w-4" />{' '}
              {loading ? 'Creating...' : isDraft ? 'Save Draft' : 'Publish Release'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
