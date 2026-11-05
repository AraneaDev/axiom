/**
 * A single number: how many issues the query matches.
 * @param root0
 * @param root0.total
 */
export function CountWidget({ total }: { total: number }) {
  return (
    <p data-testid="widget-count" className="text-3xl font-semibold tabular-nums text-text">
      {total}
    </p>
  );
}
