import { useQuery } from '@tanstack/react-query';
import { common, createLowlight } from 'lowlight';
import { ChevronRight, Copy } from 'lucide-react';
import React from 'react';
import { Link, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';

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
  const { org, team: teamSlug, repo: repoSlug, ref, '*': filePath } = useParams();
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);

  const { data: blob, isLoading } = useQuery({
    queryKey: ['blob', currentRepo?.id, ref, filePath],
    queryFn: () => reposApi.getBlob(currentRepo!.id, ref!, filePath!),
    enabled: !!currentRepo?.id && !!ref && !!filePath,
  });

  if (isLoading) return <PageLoader />;

  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;
  const parts = filePath?.split('/') ?? [];
  const fileName = parts[parts.length - 1] ?? '';
  const isMarkdown = /\.mdx?$/i.test(fileName);
  const lines = isMarkdown ? [] : highlightLines(blob?.content ?? '', fileName);

  return (
    <div>
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
      </div>

      {/* File header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">
          {blob?.size ? `${(blob.size / 1024).toFixed(1)} KB` : ''}
          {!isMarkdown && ` · ${lines.length} lines`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigator.clipboard.writeText(blob?.content ?? '')}
        >
          <Copy className="h-4 w-4" /> Copy
        </Button>
      </div>

      {/* Content */}
      {isMarkdown ? (
        <div className="rounded-lg border border-border bg-surface p-6 prose max-w-none">
          <MarkdownRenderer content={blob?.content ?? ''} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-x-auto">
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
        </div>
      )}
    </div>
  );
}
