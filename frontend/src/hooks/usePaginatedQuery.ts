import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { useState } from 'react';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

interface UsePaginatedQueryOptions<T> extends Omit<
  UseQueryOptions<PaginatedResponse<T>>,
  'queryKey' | 'queryFn'
> {
  queryKey: QueryKey;
  queryFn: (params: { limit: number; offset: number }) => Promise<PaginatedResponse<T>>;
  pageSize?: number;
}

interface UsePaginatedQueryResult<T> {
  data: T[];
  total: number;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  isLoading: boolean;
  offset: number;
  limit: number;
}

/**
 * Wraps useQuery with built-in pagination state management.
 * Eliminates manual page/offset/limit wiring in list pages.
 * @param root0
 * @param root0.queryKey
 * @param root0.queryFn
 * @param root0.pageSize
 */
export function usePaginatedQuery<T>({
  queryKey,
  queryFn,
  pageSize = 25,
  ...opts
}: UsePaginatedQueryOptions<T>): UsePaginatedQueryResult<T> {
  const [page, setPage] = useState(0);
  const offset = page * pageSize;

  const { data, isLoading } = useQuery({
    queryKey: [...queryKey, page, pageSize],
    queryFn: () => queryFn({ limit: pageSize, offset }),
    ...opts,
  });

  return {
    data: data?.data ?? [],
    total: data?.total ?? 0,
    page,
    setPage,
    totalPages: Math.ceil((data?.total ?? 0) / pageSize),
    isLoading,
    offset,
    limit: pageSize,
  };
}
