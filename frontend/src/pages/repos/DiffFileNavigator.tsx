import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  FileText,
  PanelLeft,
  PanelLeftClose,
  Rows3,
} from 'lucide-react';

import type { FileStat } from './diff-utils';
import { getChangeType, getFileIcon } from './diff-utils';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface DiffFileNavigatorProps {
  stats: FileStat[];
  activeFileIndex: number;
  onFileSelect: (index: number) => void;
  fileListOpen: boolean;
  onFileListToggle: () => void;
  diffView: 'unified' | 'split';
  onDiffViewChange: (view: 'unified' | 'split') => void;
}

/**
 *
 * @param root0
 * @param root0.stats
 * @param root0.activeFileIndex
 * @param root0.onFileSelect
 * @param root0.fileListOpen
 * @param root0.onFileListToggle
 * @param root0.diffView
 * @param root0.onDiffViewChange
 */
export function DiffFileNavigator({
  stats,
  activeFileIndex,
  onFileSelect,
  fileListOpen,
  onFileListToggle,
  diffView,
  onDiffViewChange,
}: DiffFileNavigatorProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary border-b border-border">
        <Button
          variant="ghost"
          size="xs"
          onClick={onFileListToggle}
          title={fileListOpen ? 'Collapse file list' : 'Expand file list'}
        >
          {fileListOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>
        <FileText className="h-4 w-4 text-text-tertiary" />
        <span className="text-sm font-medium text-text-secondary">
          File {activeFileIndex + 1} of {stats.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Card className="flex items-center overflow-hidden">
            <Button
              size="sm"
              variant={diffView === 'unified' ? 'primary' : 'ghost'}
              className="rounded-none border-0"
              onClick={() => onDiffViewChange('unified')}
            >
              <Rows3 className="h-3.5 w-3.5" /> Unified
            </Button>
            <Button
              size="sm"
              variant={diffView === 'split' ? 'primary' : 'ghost'}
              className="rounded-none border-0"
              onClick={() => onDiffViewChange('split')}
            >
              <Columns2 className="h-3.5 w-3.5" /> Split
            </Button>
          </Card>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onFileSelect(Math.max(0, activeFileIndex - 1))}
              disabled={activeFileIndex === 0}
              title="Previous file (k)"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onFileSelect(Math.min(stats.length - 1, activeFileIndex + 1))}
              disabled={activeFileIndex === stats.length - 1}
              title="Next file (j)"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      {fileListOpen && (
        <div className="max-h-64 overflow-y-auto divide-y divide-border">
          {stats.map((s, i) => (
            <Button
              key={s.file}
              variant="ghost"
              size="sm"
              onClick={() => onFileSelect(i)}
              className={cn(
                'w-full justify-start rounded-none px-4 py-1.5',
                i === activeFileIndex ? 'bg-primary-light' : '',
              )}
            >
              {i === activeFileIndex && <ChevronRight className="h-3 w-3 text-primary shrink-0" />}
              {getFileIcon(s)}
              <span className="font-mono text-xs truncate">{s.file}</span>
              <Badge
                className="ml-auto"
                variant={
                  getChangeType(s) === 'Added'
                    ? 'success'
                    : getChangeType(s) === 'Deleted'
                      ? 'danger'
                      : 'warning'
                }
                size="sm"
              >
                {getChangeType(s)}
              </Badge>
              <span className="text-success text-xs">+{s.additions}</span>
              <span className="text-danger text-xs">-{s.deletions}</span>
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
