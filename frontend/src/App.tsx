import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';

import { KeyboardShortcutHelp } from '@/components/KeyboardShortcutHelp';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { PageLoader } from '@/components/ui/Spinner';
import { ToastProvider } from '@/components/ui/Toast';
import { useGlobalKeyboard } from '@/hooks/useKeyboard';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { AuthGuard, GuestGuard } from '@/lib/guards';
import { adminRoutes } from '@/routes/admin-routes';
import { projectRoutes } from '@/routes/project-routes';
import { repoRoutes } from '@/routes/repo-routes';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';

// Lazy load pages
const Login = lazy(() => import('@/pages/auth/Login'));
const Register = lazy(() => import('@/pages/auth/Register'));
const Setup2FA = lazy(() => import('@/pages/auth/Setup2FA'));
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));
const Dashboard = lazy(() => import('@/pages/dashboard/Dashboard'));
const CreateOrg = lazy(() => import('@/pages/orgs/CreateOrg'));
const TeamList = lazy(() => import('@/pages/teams/TeamList'));
const CreateTeam = lazy(() => import('@/pages/teams/CreateTeam'));
const TeamDetail = lazy(() => import('@/pages/teams/TeamDetail'));
const TeamMembers = lazy(() => import('@/pages/teams/TeamMembers'));
const MemberProfile = lazy(() => import('@/pages/teams/MemberProfile'));
const CreateProject = lazy(() => import('@/pages/projects/CreateProject'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const PublicForm = lazy(() => import('@/pages/forms/PublicForm'));
const LandingPage = lazy(() => import('@/pages/landing/LandingPage'));

function SuspenseLoader({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function ConditionalHome() {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <LandingPage />;
  return <Navigate to="/dashboard" replace />;
}

function AppWithKeyboard() {
  useGlobalKeyboard();
  useRealtimeInvalidation();
  const { shortcutHelpOpen, setShortcutHelpOpen } = useUIStore();

  return (
    <>
      <KeyboardShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      <Routes>
        {/* Public form route — no auth required */}
        <Route
          path="/f/:formSlug"
          element={
            <SuspenseLoader>
              <PublicForm />
            </SuspenseLoader>
          }
        />

        {/* Home — conditional: LandingPage or Dashboard */}
        <Route
          path="/"
          element={
            <SuspenseLoader>
              <ConditionalHome />
            </SuspenseLoader>
          }
        />

        {/* Guest routes */}
        <Route element={<GuestGuard />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
        </Route>

        {/* Authenticated routes */}
        <Route element={<AuthGuard />}>
          <Route path="/setup-2fa" element={<Setup2FA />} />
          <Route element={<AppShell />}>
            <Route
              path="/dashboard"
              element={
                <ErrorBoundary>
                  <Dashboard />
                </ErrorBoundary>
              }
            />
            <Route
              path="/orgs/new"
              element={
                <ErrorBoundary>
                  <CreateOrg />
                </ErrorBoundary>
              }
            />

            {/* Org routes */}
            <Route
              path="/:org"
              element={
                <ErrorBoundary>
                  <TeamList />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/teams"
              element={
                <ErrorBoundary>
                  <TeamList />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/teams/new"
              element={
                <ErrorBoundary>
                  <CreateTeam />
                </ErrorBoundary>
              }
            />

            {/* Team routes */}
            <Route
              path="/:org/:team"
              element={
                <ErrorBoundary>
                  <TeamDetail />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/members"
              element={
                <ErrorBoundary>
                  <TeamMembers />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/members/:username"
              element={
                <ErrorBoundary>
                  <MemberProfile />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/projects"
              element={
                <ErrorBoundary>
                  <TeamDetail />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/projects/new"
              element={
                <ErrorBoundary>
                  <CreateProject />
                </ErrorBoundary>
              }
            />

            {/* Repo routes */}
            {repoRoutes()}

            {/* Project + Wiki routes */}
            {projectRoutes()}

            {/* Admin, settings, notifications, search */}
            {adminRoutes()}

            {/* Catch-all 404 route */}
            <Route
              path="*"
              element={
                <SuspenseLoader>
                  <NotFound />
                </SuspenseLoader>
              }
            />
          </Route>
        </Route>
      </Routes>
    </>
  );
}

/**
 *
 */
export default function App() {
  const { loadUser, isLoading } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  if (isLoading) return <PageLoader />;

  return (
    <ErrorBoundary>
      <ToastProvider>
        <SuspenseLoader>
          <AppWithKeyboard />
        </SuspenseLoader>
      </ToastProvider>
    </ErrorBoundary>
  );
}
