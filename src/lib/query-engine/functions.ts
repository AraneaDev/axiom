import type { QueryContext } from './ast';

export type FunctionResolver = (
  args: unknown[],
  context: QueryContext,
) => string | number | Date | null;

const DURATION_UNITS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 *
 * @param arg
 * @param arg.type
 * @param arg.value
 * @param arg.unit
 */
export function parseDuration(arg: { type: 'duration'; value: number; unit: string }): number {
  const multiplier = DURATION_UNITS[arg.unit];
  if (!multiplier) throw new Error(`Unknown duration unit: ${arg.unit}`);
  return arg.value * multiplier;
}

export const builtinFunctions: Record<string, FunctionResolver> = {
  currentuser: (_args, context) => context.currentUserId ?? null,

  currentsprint: (_args, context) => {
    return `__currentSprint__${context.projectId}`;
  },

  now: (args) => {
    const base = Date.now();
    const first = args[0];
    if (first && typeof first === 'object' && (first as { type: string }).type === 'duration') {
      return new Date(
        base + parseDuration(first as { type: 'duration'; value: number; unit: string }),
      );
    }
    // The parser hands a duration over as a string value, such as "-7d"
    const written =
      first && typeof first === 'object' ? (first as { value?: unknown }).value : null;
    const match = typeof written === 'string' ? /^([+-]?\d+)([mhdw])$/.exec(written) : null;
    if (match) {
      return new Date(
        base + parseDuration({ type: 'duration', value: parseInt(match[1], 10), unit: match[2] }),
      );
    }
    return new Date(base);
  },

  startofday: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },

  startofweek: () => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  },

  empty: () => null,
};
