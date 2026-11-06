interface ErrorAlertProps {
  error: unknown;
  fallback: string;
}

/**
 * Inline alert for a failed request: the error's message, or the fallback for anything else.
 * @param props - ErrorAlert configuration.
 * @param props.error - What a query or mutation failed with.
 * @param props.fallback - The text shown when the error carries no message.
 */
export function ErrorAlert({ error, fallback }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-md bg-danger-light border border-danger/20 px-4 py-3 text-sm text-danger"
    >
      {error instanceof Error && error.message ? error.message : fallback}
    </div>
  );
}
