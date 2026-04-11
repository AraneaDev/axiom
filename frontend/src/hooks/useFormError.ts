import { useState, useCallback } from 'react';

/**
 * Hook for managing form error state.
 * Returns the error string, a setter, and a clear function.
 */
export function useFormError() {
  const [error, setError] = useState('');
  const clearError = useCallback(() => setError(''), []);
  return { error, setError, clearError } as const;
}
