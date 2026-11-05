/** What a widget shows when its query matches nothing. */
export function NothingMatches() {
  return <p className="text-sm text-text-secondary">Nothing matches</p>;
}

/** What a widget adds when the query has more groups or items than it shows. */
export function TruncatedNote() {
  return <p className="mt-2 text-xs text-text-tertiary">There are more than shown</p>;
}
