export type CheckState = 'passed' | 'failed' | 'running' | 'skipped';

const FAILED = ['failure', 'timed_out', 'startup_failure'];
const PASSED = ['success', 'neutral'];

/**
 * How a GitHub check run reads: failed, passed, still running, or skipped (cancelled, skipped,
 * and anything else that finished without a verdict).
 * @param status - GitHub's run status.
 * @param conclusion - GitHub's conclusion, null while the run is going.
 */
export function checkStateOf(status: string, conclusion: string | null): CheckState {
  if (status !== 'completed') return 'running';
  if (conclusion && FAILED.includes(conclusion)) return 'failed';
  if (conclusion && PASSED.includes(conclusion)) return 'passed';
  return 'skipped';
}
