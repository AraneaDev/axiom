import { useQuery } from '@tanstack/react-query';
import { Activity, Users, Code, TrendingUp } from 'lucide-react';

import {
  insightsApi,
  CommitFrequencyPoint,
  CodeFrequencyPoint,
  LanguageBreakdown,
} from '@/api/insights.api';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { formatRelative } from '@/lib/utils';

// ─── Language colors ─────────────────────────────────────────

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

// ─── SVG Line Chart ──────────────────────────────────────────

function CommitFrequencyChart({ data }: { data: CommitFrequencyPoint[] }) {
  if (data.length === 0)
    return <p className="text-sm text-text-secondary">No commit data available.</p>;

  const width = 800;
  const height = 200;
  const paddingX = 40;
  const paddingY = 20;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const points = data.map((d, i) => {
    const x = paddingX + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = paddingY + chartH - (d.count / maxCount) * chartH;
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath = `M${points[0].x},${paddingY + chartH} ${points.map((p) => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1].x},${paddingY + chartH} Z`;

  // Y-axis labels
  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yTicks.map((tick) => {
        const y = paddingY + chartH - (tick / maxCount) * chartH;
        return (
          <g key={tick}>
            <line
              x1={paddingX}
              y1={y}
              x2={width - paddingX}
              y2={y}
              className="stroke-border"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <text
              x={paddingX - 8}
              y={y + 4}
              textAnchor="end"
              className="fill-text-tertiary text-[10px]"
            >
              {tick}
            </text>
          </g>
        );
      })}
      {/* Area fill */}
      <path d={areaPath} className="fill-primary" opacity="0.1" />
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Code Frequency Bar Chart ────────────────────────────────

function CodeFrequencyChart({ data }: { data: CodeFrequencyPoint[] }) {
  if (data.length === 0)
    return <p className="text-sm text-text-secondary">No code frequency data available.</p>;

  const width = 800;
  const height = 200;
  const paddingX = 50;
  const paddingY = 20;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const maxVal = Math.max(...data.map((d) => Math.max(d.additions, d.deletions)), 1);
  const barWidth = Math.max(chartW / data.length / 2.5, 2);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Baseline */}
      <line
        x1={paddingX}
        y1={paddingY + chartH}
        x2={width - paddingX}
        y2={paddingY + chartH}
        className="stroke-border"
        strokeWidth="1"
      />
      {/* Y-axis label */}
      <text
        x={paddingX - 8}
        y={paddingY + 4}
        textAnchor="end"
        className="fill-text-tertiary text-[10px]"
      >
        {maxVal}
      </text>
      <text
        x={paddingX - 8}
        y={paddingY + chartH + 4}
        textAnchor="end"
        className="fill-text-tertiary text-[10px]"
      >
        0
      </text>
      {data.map((d, i) => {
        const x = paddingX + (i / Math.max(data.length - 1, 1)) * chartW;
        const addH = (d.additions / maxVal) * chartH;
        const delH = (d.deletions / maxVal) * chartH;
        return (
          <g key={d.week}>
            {/* Additions bar */}
            <rect
              x={x - barWidth}
              y={paddingY + chartH - addH}
              width={barWidth}
              height={addH}
              className="fill-success"
              opacity="0.7"
              rx="1"
            />
            {/* Deletions bar */}
            <rect
              x={x}
              y={paddingY + chartH - delH}
              width={barWidth}
              height={delH}
              className="fill-danger"
              opacity="0.7"
              rx="1"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Language Bar ────────────────────────────────────────────

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

// ─── Main InsightsTab ────────────────────────────────────────

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
    <div className="space-y-8">
      {/* Commit Frequency */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Commit Frequency</h2>
          <span className="text-sm text-text-secondary ml-auto">Last 90 days</span>
        </div>
        {loadingCommits ? <PageLoader /> : <CommitFrequencyChart data={commitFreq ?? []} />}
      </section>

      {/* Contributors */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Contributors</h2>
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
      </section>

      {/* Language Breakdown */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Code className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Languages</h2>
        </div>
        {loadingLangs ? <PageLoader /> : <LanguageBar data={languages ?? []} />}
      </section>

      {/* Code Frequency */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Code Frequency</h2>
          <span className="text-sm text-text-secondary ml-auto">Weekly additions/deletions</span>
        </div>
        {loadingCode ? (
          <PageLoader />
        ) : (
          <>
            <CodeFrequencyChart data={codeFreq ?? []} />
            <div className="flex gap-4 mt-3 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-success" />
                Additions
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-danger" />
                Deletions
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
