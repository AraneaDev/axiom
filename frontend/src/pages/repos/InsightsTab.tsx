import { useQuery } from '@tanstack/react-query';
import { Activity, Users, Code, TrendingUp } from 'lucide-react';

import {
  insightsApi,
  CommitFrequencyPoint,
  CodeFrequencyPoint,
  LanguageBreakdown,
} from '@/api/insights.api';
import { Card } from '@/components/ui/Card';
import { LineChart } from '@/components/ui/charts';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { formatRelative } from '@/lib/utils';

// --- Language colors ---

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Ruby: '#701516',
  Java: '#b07219',
  CSS: '#563d7c',
  HTML: '#e34c26',
  JSON: '#292929',
  Markdown: '#083fa1',
  YAML: '#cb171e',
  SQL: '#e38c00',
  Shell: '#89e051',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  PHP: '#4f5d95',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Docker: '#384d54',
  Prisma: '#2d3748',
  GraphQL: '#e10098',
};

function getLangColor(lang: string): string {
  return LANG_COLORS[lang] || '#6b7280';
}

// --- Commit Frequency Chart ---

function CommitFrequencyChart({ data }: { data: CommitFrequencyPoint[] }) {
  if (data.length === 0)
    return <p className="text-sm text-text-secondary">No commit data available.</p>;

  return (
    <LineChart
      series={[
        {
          label: 'Commits',
          data: data.map((d) => ({ x: d.date, y: d.count })),
        },
      ]}
      area
      height={200}
    />
  );
}

// --- Code Frequency Chart ---

function CodeFrequencyChart({ data }: { data: CodeFrequencyPoint[] }) {
  if (data.length === 0)
    return <p className="text-sm text-text-secondary">No code frequency data available.</p>;

  return (
    <LineChart
      series={[
        {
          label: 'Additions',
          data: data.map((d) => ({ x: d.week, y: d.additions })),
          color: 'var(--color-success)',
        },
        {
          label: 'Deletions',
          data: data.map((d) => ({ x: d.week, y: d.deletions })),
          color: 'var(--color-danger)',
        },
      ]}
      area
      height={200}
    />
  );
}

// --- Language Bar ---

function LanguageBar({ data }: { data: LanguageBreakdown[] }) {
  if (data.length === 0)
    return <p className="text-sm text-text-secondary">No language data available.</p>;

  return (
    <div>
      {/* Stacked bar */}
      <div className="flex h-4 rounded-full overflow-hidden mb-4">
        {data.map((lang) => (
          <div
            key={lang.language}
            style={{ width: `${lang.percentage}%`, backgroundColor: getLangColor(lang.language) }}
            title={`${lang.language}: ${lang.percentage}%`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {data.map((lang) => (
          <div key={lang.language} className="flex items-center gap-1.5 text-sm">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: getLangColor(lang.language) }}
            />
            <span className="font-medium">{lang.language}</span>
            <span className="text-text-secondary">{lang.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main InsightsTab ---

interface InsightsTabProps {
  repoId: string;
}

/**
 * Repository insights tab showing commit frequency, contributors,
 * language breakdown, and code frequency charts.
 * @param props
 * @param props.repoId
 */
export default function InsightsTab({ repoId }: InsightsTabProps) {
  const { data: commitFreq, isLoading: loadingCommits } = useQuery({
    queryKey: ['insights', 'commit-frequency', repoId],
    queryFn: () => insightsApi.getCommitFrequency(repoId),
  });

  const { data: contributors, isLoading: loadingContribs } = useQuery({
    queryKey: ['insights', 'contributors', repoId],
    queryFn: () => insightsApi.getContributors(repoId),
  });

  const { data: languages, isLoading: loadingLangs } = useQuery({
    queryKey: ['insights', 'languages', repoId],
    queryFn: () => insightsApi.getLanguages(repoId),
  });

  const { data: codeFreq, isLoading: loadingCode } = useQuery({
    queryKey: ['insights', 'code-frequency', repoId],
    queryFn: () => insightsApi.getCodeFrequency(repoId),
  });

  if (loadingCommits && loadingContribs && loadingLangs && loadingCode) {
    return <PageLoader />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Commit Frequency */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="h3">Commit Frequency</h2>
          <span className="text-sm text-text-secondary ml-auto">Last 90 days</span>
        </div>
        {loadingCommits ? <PageLoader /> : <CommitFrequencyChart data={commitFreq ?? []} />}
      </Card>

      {/* Contributors */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="h3">Contributors</h2>
          <span className="text-sm text-text-secondary ml-auto">
            {contributors?.length ?? 0} total
          </span>
        </div>
        {loadingContribs ? (
          <PageLoader />
        ) : contributors && contributors.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <TrHead>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th className="text-right">Commits</Th>
                  <Th className="text-right">Last Commit</Th>
                </TrHead>
              </Thead>
              <Tbody>
                {contributors.map((c) => (
                  <tr key={c.email}>
                    <Td className="font-medium">{c.name}</Td>
                    <Td className="text-text-secondary">{c.email}</Td>
                    <Td className="text-right tabular-nums">{c.commits}</Td>
                    <Td className="text-right text-text-secondary">
                      {c.lastCommitDate ? formatRelative(c.lastCommitDate) : '--'}
                    </Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">No contributor data available.</p>
        )}
      </Card>

      {/* Language Breakdown */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Code className="h-5 w-5 text-primary" />
          <h2 className="h3">Languages</h2>
        </div>
        {loadingLangs ? <PageLoader /> : <LanguageBar data={languages ?? []} />}
      </Card>

      {/* Code Frequency */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="h3">Code Frequency</h2>
          <span className="text-sm text-text-secondary ml-auto">Weekly additions/deletions</span>
        </div>
        {loadingCode ? <PageLoader /> : <CodeFrequencyChart data={codeFreq ?? []} />}
      </Card>
    </div>
  );
}
