import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';
import { PageLoader } from '@/components/ui/Spinner';

export function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function GuestGuard() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}
