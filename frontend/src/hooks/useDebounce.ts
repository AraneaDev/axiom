import { useEffect, useState } from 'react';

/**
 * Returns a debounced version of the given value.
 * The debounced value updates only after the specified delay
 * has passed since the last change.
 * @param value
 * @param delay
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
