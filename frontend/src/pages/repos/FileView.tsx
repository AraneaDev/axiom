import { useQuery } from '@tanstack/react-query';
import { common, createLowlight } from 'lowlight';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Clock,
  FileWarning,
  GitBranch,
  Pencil,
} from 'lucide-react';
import React from 'react';
import { Link, Navigate, useParams, useNavigate } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { useRepoContext } from '@/hooks/useRepoContext';

const lowlight = createLowlight(common);

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  graphql: 'graphql',
  makefile: 'makefile',
};

let nodeKeyCounter = 0;

function highlightLines(code: string, filename: string): React.ReactNode[][] {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const lang = EXT_LANG[ext];
  nodeKeyCounter = 0;
  try {
    const tree = lang ? lowlight.highlight(lang, code) : lowlight.highlightAuto(code);
    // Convert HAST nodes to React elements, then split by newlines in text nodes
    const flatNodes = flattenToLineNodes(tree.children ?? []);
    return flatNodes;
  } catch {
    return code.split('\n').map((l) => [l]);
  }
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function flattenToLineNodes(children: HastNode[]): React.ReactNode[][] {
  const lines: React.ReactNode[][] = [[]];
  function walk(nodes: HastNode[], wrappers: Array<{ className?: string }>) {
    for (const node of nodes) {
      if (node.type === 'text') {
        const parts = (node.value as string).split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) lines.push([]);
          const text = parts[i];
          if (text) {
            let wrapped: React.ReactNode = text;
            for (let w = wrappers.length - 1; w >= 0; w--) {
              wrapped = React.createElement(
                'span',
                { className: wrappers[w].className, key: nodeKeyCounter++ },
                wrapped,
              );
            }
            lines[lines.length - 1].push(wrapped);
          }
        }
      } else if (node.type === 'element') {
        const cls = (node.properties?.className ?? []).join(' ');
        walk(node.children ?? [], [...wrappers, { className: cls || undefined }]);
      }
    }
  }
  walk(children, []);
  return lines;
}

/**
 *
 */
export default function FileView() {
  const { ref, '*': filePath } = useParams();
  const { currentRepo, basePath, repoSlug } = useRepoContext();
  const navigate = useNavigate();

  const { data: branches } = useQuery({
    queryKey: ['branches', currentRepo?.id],
    queryFn: () => reposApi.listBranches(currentRepo!.id),
    enabled: !!currentRepo?.id,
  });

  const {
    data: blob,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['blob', currentRepo?.id, ref, filePath],
    queryFn: () => reposApi.getBlob(currentRepo!.id, ref!, filePath!),
    enabled: !!currentRepo?.id && !!ref && !!filePath,
  });

  // Guard missing params — redirect to repo page (after all hooks)
  if (!ref || !filePath) {
    return <Navigate to={basePath} replace />;
  }

  if (isLoading) return <PageLoader />;

  if (isError || (!isLoading && !blob && currentRepo)) {
    return (
      <EmptyState
        icon={<FileWarning className="h-10 w-10" />}
        title="File not found"
        description={`Could not load ${filePath} at ref ${ref}.`}
        action={
          <Link to={basePath}>
            <Button variant="secondary">
              <GitBranch className="h-4 w-4" /> Back to repository
            </Button>
          </Link>
        }
      />
    );
  }

  const parts = filePath?.split('/') ?? [];
  const fileName = parts[parts.length - 1] ?? '';
  const isMarkdown = /\.mdx?$/i.test(fileName);
  const lines = isMarkdown ? [] : highlightLines(blob?.content ?? '', fileName);

  return (
    <div>
      {/* Branch switcher */}
      <div className="flex items-center gap-3 mb-4">
        <Dropdown
          trigger={
            <Button variant="secondary" size="sm">
              <GitBranch className="h-4 w-4" /> {ref} <ChevronDown className="h-3 w-3" />
            </Button>
          }
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {branches?.map((branch) => (
              <DropdownItem
                key={branch.name}
                onClick={() => navigate(`${basePath}/blob/${branch.name}/${filePath}`)}
                className={branch.name === ref ? 'bg-surface-tertiary font-medium' : ''}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{branch.name}</span>
                {branch.name === currentRepo?.defaultBranch && (
                  <Badge variant="primary" size="sm" className="ml-auto">
                    default
                  </Badge>
                )}
              </DropdownItem>
            ))}
          </div>
        </Dropdown>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm flex-wrap">
        <Link to={basePath} className="text-primary hover:underline">
          {repoSlug}
        </Link>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-secondary" />
            {i < parts.length - 1 ? (
              <Link
                to={`${basePath}/tree/${encodeURIComponent(ref!)}/${parts.slice(0, i + 1).join('/')}`}
                className="text-primary hover:underline"
              >
                {p}
              </Link>
            ) : (
              <span className="font-medium">{p}</span>
            )}
          </span>
        ))}
      </div>

      {/* File header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">
          {blob?.size ? `${(blob.size / 1024).toFixed(1)} KB` : ''}
          {!isMarkdown && ` · ${lines.length} lines`}
        </span>
        <div className="flex items-center gap-2">
          <Link to={`${basePath}/edit/${encodeURIComponent(ref!)}/${filePath}`}>
            <Button variant="ghost" size="sm">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </Link>
          <Link to={`${basePath}/blame/${encodeURIComponent(ref!)}/${filePath}`}>
            <Button variant="ghost" size="sm">
              <GitBranch className="h-4 w-4" /> Blame
            </Button>
          </Link>
          <Link to={`${basePath}/history/${encodeURIComponent(ref!)}/${filePath}`}>
            <Button variant="ghost" size="sm">
              <Clock className="h-4 w-4" /> History
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigator.clipboard.writeText(blob?.content ?? '')}
          >
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </div>
      </div>

      {/* Content */}
      {isMarkdown ? (
        <Card className="p-6 prose max-w-none">
          <MarkdownRenderer content={blob?.content ?? ''} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <pre className="text-sm font-mono m-0 p-0">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="hover:bg-surface-secondary">
                    <td className="text-right pr-4 pl-3 py-0 text-text-tertiary select-none w-12 align-top border-r border-border text-xs leading-6">
                      {i + 1}
                    </td>
                    <td className="pl-4 whitespace-pre leading-6">
                      {line.length > 0 ? line : ' '}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </pre>
        </Card>
      )}
    </div>
  );
}
