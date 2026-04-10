import type { ZoomLevel } from './TimelineZoom';

const MS_PER_DAY = 86_400_000;

interface GanttTimeAxisProps {
  startDate: Date;
  totalDays: number;
  dayWidth: number;
  zoom: ZoomLevel;
}

function formatQuarter(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatWeek(weekNum: number): string {
  return `Week ${weekNum}`;
}

interface Division {
  label: string;
  offsetDays: number;
  spanDays: number;
}

function computeDivisions(startDate: Date, totalDays: number, zoom: ZoomLevel): Division[] {
  const divisions: Division[] = [];
  const endTime = startDate.getTime() + totalDays * MS_PER_DAY;

  if (zoom === 'weeks') {
    // Each division is 7 days
    let weekNum = 1;
    for (let d = 0; d < totalDays; d += 7) {
      const span = Math.min(7, totalDays - d);
      divisions.push({ label: formatWeek(weekNum), offsetDays: d, spanDays: span });
      weekNum++;
    }
  } else if (zoom === 'months') {
    const cursor = new Date(startDate);
    cursor.setUTCDate(1);
    if (cursor.getTime() < startDate.getTime()) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    // First partial month
    const firstBoundary = Math.min(
      (cursor.getTime() - startDate.getTime()) / MS_PER_DAY,
      totalDays,
    );
    if (firstBoundary > 0) {
      divisions.push({
        label: formatMonth(startDate),
        offsetDays: 0,
        spanDays: firstBoundary,
      });
    }

    while (cursor.getTime() < endTime) {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const offsetDays = (cursor.getTime() - startDate.getTime()) / MS_PER_DAY;
      const spanDays = Math.min(
        (next.getTime() - cursor.getTime()) / MS_PER_DAY,
        totalDays - offsetDays,
      );
      if (spanDays > 0) {
        divisions.push({ label: formatMonth(cursor), offsetDays, spanDays });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    // quarters
    const cursor = new Date(startDate);
    const qMonth = Math.floor(cursor.getUTCMonth() / 3) * 3;
    cursor.setUTCMonth(qMonth, 1);
    cursor.setUTCHours(0, 0, 0, 0);
    if (cursor.getTime() < startDate.getTime()) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 3);
    }

    // First partial quarter
    const firstBoundary = Math.min(
      (cursor.getTime() - startDate.getTime()) / MS_PER_DAY,
      totalDays,
    );
    if (firstBoundary > 0) {
      divisions.push({
        label: formatQuarter(startDate),
        offsetDays: 0,
        spanDays: firstBoundary,
      });
    }

    while (cursor.getTime() < endTime) {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 3);
      const offsetDays = (cursor.getTime() - startDate.getTime()) / MS_PER_DAY;
      const spanDays = Math.min(
        (next.getTime() - cursor.getTime()) / MS_PER_DAY,
        totalDays - offsetDays,
      );
      if (spanDays > 0) {
        divisions.push({ label: formatQuarter(cursor), offsetDays, spanDays });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 3);
    }
  }

  return divisions;
}

/**
 * Time header with division labels and vertical gridlines for the Gantt chart.
 * @param props.startDate - The start date of the visible timeline range.
 * @param root0
 * @param root0.startDate
 * @param props.totalDays - Total number of days in the visible range.
 * @param root0.totalDays
 * @param props.dayWidth - Pixels per day based on zoom level.
 * @param root0.dayWidth
 * @param props.zoom - Current zoom level (weeks, months, quarters).
 * @param root0.zoom
 */
export function GanttTimeAxis({ startDate, totalDays, dayWidth, zoom }: GanttTimeAxisProps) {
  const divisions = computeDivisions(startDate, totalDays, zoom);
  const totalWidth = totalDays * dayWidth;

  return (
    <div
      className="sticky top-0 z-10 bg-surface border-b border-border"
      style={{ width: totalWidth, height: 32 }}
    >
      {divisions.map((div, i) => {
        const left = div.offsetDays * dayWidth;
        const width = div.spanDays * dayWidth;
        return (
          <div
            key={`${div.label}-${i}`}
            className="absolute top-0 h-full flex items-center border-r border-border"
            style={{ left, width }}
          >
            <span className="px-2 text-xs font-medium text-text-tertiary truncate">
              {div.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
