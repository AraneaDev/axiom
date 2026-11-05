import type { GroupsResult } from '@/api/dashboards.api';

import { groupLabel, groupValue } from './widget-data';
import { NothingMatches, TruncatedNote } from './WidgetNotes';

const WIDTH = 400;
const HEIGHT = 180;
const PADDING_X = 24;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 24;
const BAR_GAP = 8;
const MAX_BAR_WIDTH = 64;
/** About what one character of a label takes in the chart's units */
const CHAR_WIDTH = 5;

/**
 * Cut a label to what fits under its bar; the bar's title has the whole text.
 * @param label - The label
 * @param room - The width it has
 */
function fitLabel(label: string, room: number): string {
  const fits = Math.floor(room / CHAR_WIDTH);
  if (label.length <= fits) return label;
  return fits > 2 ? `${label.slice(0, fits - 2)}..` : '';
}

/**
 * A bar per group: plain SVG scaled to the largest value, as the velocity chart draws its sprints.
 * @param root0
 * @param root0.result
 */
export function BarWidget({ result }: { result: GroupsResult }) {
  if (result.groups.length === 0) return <NothingMatches />;

  const bars = result.groups.map((group) => ({
    id: JSON.stringify(group.key),
    label: groupLabel(group),
    value: groupValue(group),
  }));
  const largest = Math.max(...bars.map((bar) => bar.value), 1);
  const chartW = WIDTH - PADDING_X * 2;
  const chartH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const slot = chartW / bars.length;
  const barWidth = Math.min(Math.max(slot - BAR_GAP, 2), MAX_BAR_WIDTH);

  return (
    <>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <line
          x1={PADDING_X}
          y1={PADDING_TOP + chartH}
          x2={WIDTH - PADDING_X}
          y2={PADDING_TOP + chartH}
          className="stroke-border"
          strokeWidth="1"
        />
        {bars.map((bar, index) => {
          const center = PADDING_X + slot * index + slot / 2;
          const barH = (bar.value / largest) * chartH;
          return (
            <g key={bar.id}>
              <title>{`${bar.label}: ${bar.value}`}</title>
              <rect
                x={center - barWidth / 2}
                y={PADDING_TOP + chartH - barH}
                width={barWidth}
                height={Math.max(barH, 1)}
                className="fill-primary"
                opacity="0.8"
                rx="2"
              />
              <text
                x={center}
                y={PADDING_TOP + chartH - barH - 4}
                textAnchor="middle"
                className="fill-text-secondary text-[10px]"
              >
                {bar.value}
              </text>
              <text
                x={center}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-text-tertiary text-[9px]"
              >
                {fitLabel(bar.label, slot)}
              </text>
            </g>
          );
        })}
      </svg>
      {result.truncated && <TruncatedNote />}
    </>
  );
}
