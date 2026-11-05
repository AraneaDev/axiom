import type { GroupsResult } from '@/api/dashboards.api';
import { BarChart } from '@/components/ui/charts';

import { groupLabel, groupValue } from './widget-data';
import { NothingMatches, TruncatedNote } from './WidgetNotes';

/**
 * A bar per group, on the shared bar chart.
 * @param root0
 * @param root0.result
 */
export function BarWidget({ result }: { result: GroupsResult }) {
  if (result.groups.length === 0) return <NothingMatches />;
  return (
    <>
      <BarChart
        data={result.groups.map((group) => ({
          label: groupLabel(group),
          value: groupValue(group),
        }))}
      />
      {result.truncated && <TruncatedNote />}
    </>
  );
}
