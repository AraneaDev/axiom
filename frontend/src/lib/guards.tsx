import { Navigate, Outlet } from 'react-router';

import { PageLoader } from '@/components/ui/Spinner';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 *
 */
export function GuestGuard() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
