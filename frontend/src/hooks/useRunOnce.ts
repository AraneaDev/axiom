import { useEffect, useRef, useState } from 'react';

export type RunOnceState<T> =
  | { status: 'pending' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown };

/**
 * Runs a call once per mounted component and keeps its outcome, however many times effects run
 * (React StrictMode runs them twice in development). For single-use codes in a redirect URL: a
 * mutation would lose its result when StrictMode unsubscribes and resubscribes its observer.
 * @param run The call to make once
 * @returns The state of the call
 */
export function useRunOnce<T>(run: () => Promise<T>): RunOnceState<T> {
  const started = useRef(false);
  const [state, setState] = useState<RunOnceState<T>>({ status: 'pending' });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run().then(
      (data) => setState({ status: 'success', data }),
      (error: unknown) => setState({ status: 'error', error }),
    );
    // run is meant to be read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}
