import { useQuery } from '@tanstack/react-query';
import { Tag, Wand2, X } from 'lucide-react';
import { useState } from 'react';

import { releasesApi } from '@/api/releases.api';
import { reposApi, type BranchInfo } from '@/api/repos.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';

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
    <Modal open={true} onClose={onClose} title="New Release" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              label="Tag Name"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              required
              placeholder="v1.0.0"
              className="font-mono"
            />
          </div>
          <Select
            label="Target Branch"
            value={targetBranch}
            onChange={(v) => setTargetBranch(v as string)}
            options={
              branches.length > 0
                ? branches.map((b: BranchInfo) => ({ value: b.name, label: b.name }))
                : [{ value: defaultBranch, label: defaultBranch }]
            }
          />
        </div>

        <div>
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Release title"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-text-secondary">Release Notes</label>
            <Button type="button" variant="ghost" size="sm" onClick={handleGenerateChangelog}>
              <Wand2 className="h-3.5 w-3.5" /> Auto-generate
            </Button>
          </div>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            placeholder="Describe the changes in this release..."
          />
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} />
            Save as draft
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={isPrerelease} onChange={(e) => setIsPrerelease(e.target.checked)} />
            Pre-release
          </label>
        </div>

        {error && <p className="text-sm text-danger bg-danger-light p-3 rounded-lg">{error}</p>}

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            <Tag className="h-4 w-4" />{' '}
            {loading ? 'Creating...' : isDraft ? 'Save Draft' : 'Publish Release'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
