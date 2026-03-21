import {
  useMutation,
  useQueryClient,
  type MutationFunction,
  type QueryKey,
} from '@tanstack/react-query';

import { useToast } from '@/components/ui/Toast';

interface UseMutationWithToastOptions<TData, TVariables> {
  /** Toast message on success. Pass null to skip. */
  successMessage?: string | null;
  /** Toast message on error. Pass null to skip. */
  errorMessage?: string | null;
  /** Query keys to invalidate on success. */
  invalidateKeys?: QueryKey[];
  /** Additional callback on success. */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Additional callback on error. */
  onError?: (error: Error, variables: TVariables) => void;
}

/**
 * Wraps useMutation with automatic toast notifications and query invalidation.
 * Reduces the common pattern of useMutation + useQueryClient + useToast.
 * @param mutationFn
 * @param root0
 * @param root0.successMessage
 * @param root0.errorMessage
 * @param root0.invalidateKeys
 * @param root0.onSuccess
 * @param root0.onError
 */
export function useMutationWithToast<TData = unknown, TVariables = void>(
  mutationFn: MutationFunction<TData, TVariables>,
  {
    successMessage = 'Done',
    errorMessage = 'Something went wrong',
    invalidateKeys = [],
    onSuccess,
    onError,
  }: UseMutationWithToastOptions<TData, TVariables> = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: async (data, variables) => {
      for (const key of invalidateKeys) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      if (successMessage) toast.success(successMessage);
      onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      if (errorMessage) toast.error(errorMessage);
      onError?.(error, variables);
    },
  });
}
