interface LogTailProps {
  /** The end of a log. Plain text from GitHub: it is shown as it is, never as markup. */
  text: string | null;
  truncated?: boolean;
  unavailable?: boolean;
}

/**
 * The end of a CI log in a monospace, scrollable block, with a note when it was cut or could not
 * be had.
 * @param props - LogTail props.
 * @param props.text - The log text.
 * @param props.truncated - The log was cut to its end.
 * @param props.unavailable - The log could not be fetched.
 */
export function LogTail({ text, truncated, unavailable }: LogTailProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {text && (
        <pre
          aria-label="Log tail"
          className="max-h-64 overflow-auto rounded-md border border-border bg-surface-secondary p-3 font-mono text-xs leading-relaxed text-text whitespace-pre"
        >
          {text}
        </pre>
      )}
      {truncated && (
        <p className="text-xs text-text-tertiary">This log is truncated: you see the end of it.</p>
      )}
      {unavailable && <p className="text-xs text-text-tertiary">Log unavailable.</p>}
    </div>
  );
}
