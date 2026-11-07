import { CheckCircle2, CircleDashed, MinusCircle, XCircle } from 'lucide-react';

import { checkStateOf } from '@/lib/github-checks';

const icons = {
  passed: { Icon: CheckCircle2, color: 'text-success' },
  failed: { Icon: XCircle, color: 'text-danger' },
  running: { Icon: CircleDashed, color: 'text-warning' },
  skipped: { Icon: MinusCircle, color: 'text-text-tertiary' },
};

/**
 * The icon of a check run's state.
 * @param props - CheckStatusIcon props.
 * @param props.status - GitHub's run status.
 * @param props.conclusion - GitHub's conclusion, null while the run is going.
 */
export function CheckStatusIcon({
  status,
  conclusion,
}: {
  status: string;
  conclusion: string | null;
}) {
  const state = checkStateOf(status, conclusion);
  const { Icon, color } = icons[state];
  return <Icon aria-label={state} role="img" className={`h-4 w-4 shrink-0 ${color}`} />;
}
