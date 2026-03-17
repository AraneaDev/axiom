import { useEffect } from 'react';
import { Routes, Route } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';
import { AuthGuard, GuestGuard } from '@/lib/guards';
import { AppShell } from '@/components/layout/AppShell';
import { PageLoader } from '@/components/ui/Spinner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import { useGlobalKeyboard } from '@/hooks/useKeyboard';
import { lazy, Suspense } from 'react';

// Lazy load pages
const Login = lazy(() => import('@/pages/auth/Login'));
const Register = lazy(() => import('@/pages/auth/Register'));
const Setup2FA = lazy(() => import('@/pages/auth/Setup2FA'));
const Dashboard = lazy(() => import('@/pages/dashboard/Dashboard'));
const CreateOrg = lazy(() => import('@/pages/orgs/CreateOrg'));
const TeamList = lazy(() => import('@/pages/teams/TeamList'));
const CreateTeam = lazy(() => import('@/pages/teams/CreateTeam'));
const TeamDetail = lazy(() => import('@/pages/teams/TeamDetail'));
const TeamMembers = lazy(() => import('@/pages/teams/TeamMembers'));
const CreateProject = lazy(() => import('@/pages/projects/CreateProject'));
const Board = lazy(() => import('@/pages/issues/Board'));
const IssueList = lazy(() => import('@/pages/issues/IssueList'));
const IssueCreate = lazy(() => import('@/pages/issues/IssueCreate'));
const IssueDetail = lazy(() => import('@/pages/issues/IssueDetail'));
const WikiHome = lazy(() => import('@/pages/wiki/WikiHome'));
const CreateWikiSpace = lazy(() => import('@/pages/wiki/CreateWikiSpace'));
const PageView = lazy(() => import('@/pages/wiki/PageView'));
const PageEdit = lazy(() => import('@/pages/wiki/PageEdit'));
const PageHistory = lazy(() => import('@/pages/wiki/PageHistory'));
const RepoList = lazy(() => import('@/pages/repos/RepoList'));
const CreateRepo = lazy(() => import('@/pages/repos/CreateRepo'));
const RepoDetail = lazy(() => import('@/pages/repos/RepoDetail'));
const FileBrowser = lazy(() => import('@/pages/repos/FileBrowser'));
const FileView = lazy(() => import('@/pages/repos/FileView'));
const PRList = lazy(() => import('@/pages/repos/PRList'));
const PRDetail = lazy(() => import('@/pages/repos/PRDetail'));
const Profile = lazy(() => import('@/pages/settings/Profile'));
const Security = lazy(() => import('@/pages/settings/Security'));
const SshKeys = lazy(() => import('@/pages/settings/SshKeys'));
const ApiTokens = lazy(() => import('@/pages/settings/ApiTokens'));
const SearchResults = lazy(() => import('@/pages/search/SearchResults'));
const PipelineRunDetail = lazy(() => import('@/pages/repos/PipelineRunDetail'));

function SuspenseLoader({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

function AppWithKeyboard() {
  useGlobalKeyboard();

  return (
    <Routes>
      {/* Guest routes */}
      <Route element={<GuestGuard />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Authenticated routes */}
      <Route element={<AuthGuard />}>
        <Route path="/setup-2fa" element={<Setup2FA />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orgs/new" element={<CreateOrg />} />

          {/* Org routes */}
          <Route path="/:org" element={<TeamList />} />
          <Route path="/:org/teams" element={<TeamList />} />
          <Route path="/:org/teams/new" element={<CreateTeam />} />

          {/* Team routes */}
          <Route path="/:org/:team" element={<TeamDetail />} />
          <Route path="/:org/:team/members" element={<TeamMembers />} />
          <Route path="/:org/:team/projects" element={<TeamDetail />} />
          <Route path="/:org/:team/projects/new" element={<CreateProject />} />

          {/* Repo routes */}
          <Route path="/:org/:team/repos" element={<RepoList />} />
          <Route path="/:org/:team/repos/new" element={<CreateRepo />} />
          <Route path="/:org/:team/repos/:repo" element={<RepoDetail />} />
          <Route path="/:org/:team/repos/:repo/tree/:ref/*" element={<FileBrowser />} />
          <Route path="/:org/:team/repos/:repo/blob/:ref/*" element={<FileView />} />
          <Route path="/:org/:team/repos/:repo/pulls" element={<PRList />} />
          <Route path="/:org/:team/repos/:repo/pulls/:number" element={<PRDetail />} />
          <Route path="/:org/:team/repos/:repo/runs/:runId" element={<PipelineRunDetail />} />

          {/* Issue routes */}
          <Route path="/:org/:team/:project/board" element={<Board />} />
          <Route path="/:org/:team/:project/issues" element={<IssueList />} />
          <Route path="/:org/:team/:project/issues/new" element={<IssueCreate />} />
          <Route path="/:org/:team/:project/issues/:num" element={<IssueDetail />} />

          {/* Wiki routes */}
          <Route path="/:org/:team/wiki" element={<WikiHome />} />
          <Route path="/:org/:team/wiki/new" element={<CreateWikiSpace />} />
          <Route path="/:org/:team/wiki/:space" element={<PageView />} />
          <Route path="/:org/:team/wiki/:space/new" element={<PageEdit />} />
          <Route path="/:org/:team/wiki/:space/:page" element={<PageView />} />
          <Route path="/:org/:team/wiki/:space/:page/edit" element={<PageEdit />} />
          <Route path="/:org/:team/wiki/:space/:page/history" element={<PageHistory />} />

          {/* Settings */}
          <Route path="/settings/profile" element={<Profile />} />
          <Route path="/settings/security" element={<Security />} />
          <Route path="/settings/ssh-keys" element={<SshKeys />} />
          <Route path="/settings/tokens" element={<ApiTokens />} />

          {/* Search */}
          <Route path="/search" element={<SearchResults />} />
        </Route>
      </Route>
    </Routes>
  );
}

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
