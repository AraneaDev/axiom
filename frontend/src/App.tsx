import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { PageLoader } from '@/components/ui/Spinner';
import { ToastProvider } from '@/components/ui/Toast';
import { useGlobalKeyboard } from '@/hooks/useKeyboard';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { AuthGuard, GuestGuard } from '@/lib/guards';
import { useAuthStore } from '@/stores/auth.store';

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
const Backlog = lazy(() => import('@/pages/issues/Backlog'));
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
const NotificationSettings = lazy(() => import('@/pages/settings/NotificationSettings'));
const SearchResults = lazy(() => import('@/pages/search/SearchResults'));
const PipelineRunDetail = lazy(() => import('@/pages/repos/PipelineRunDetail'));
const CommitDetail = lazy(() => import('@/pages/repos/CommitDetail'));
const BlameView = lazy(() => import('@/pages/repos/BlameView'));
const FileHistory = lazy(() => import('@/pages/repos/FileHistory'));
const BranchCompare = lazy(() => import('@/pages/repos/BranchCompare'));
const RepoSettings = lazy(() => import('@/pages/repos/RepoSettings'));
const Roadmap = lazy(() => import('@/pages/issues/Roadmap'));
const CustomFieldSettings = lazy(() => import('@/pages/projects/CustomFieldSettings'));
const WorkflowEditor = lazy(() => import('@/pages/projects/WorkflowEditor'));
const AutomationRules = lazy(() => import('@/pages/projects/AutomationRules'));
const LabelsSettings = lazy(() => import('@/pages/projects/LabelsSettings'));
const IssueTemplates = lazy(() => import('@/pages/projects/IssueTemplates'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('@/pages/admin/UserManagement'));
const SystemSettings = lazy(() => import('@/pages/admin/SystemSettings'));
const AuditLogs = lazy(() => import('@/pages/admin/AuditLogs'));

function SuspenseLoader({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

function ProjectRedirect() {
  const { org, team, project } = useParams();
  return <Navigate to={`/${org}/${team}/${project}/issues`} replace />;
}

function AppWithKeyboard() {
  useGlobalKeyboard();
  useRealtimeInvalidation();

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
          <Route path="/:org/:team/repos/:repo/tree" element={<Navigate to=".." replace />} />
          <Route path="/:org/:team/repos/:repo/tree/:ref/*" element={<FileBrowser />} />
          <Route path="/:org/:team/repos/:repo/blob" element={<Navigate to=".." replace />} />
          <Route path="/:org/:team/repos/:repo/blob/:ref/*" element={<FileView />} />
          <Route path="/:org/:team/repos/:repo/pulls" element={<PRList />} />
          <Route path="/:org/:team/repos/:repo/pulls/:number" element={<PRDetail />} />
          <Route path="/:org/:team/repos/:repo/commits" element={<Navigate to=".." replace />} />
          <Route path="/:org/:team/repos/:repo/commits/:sha" element={<CommitDetail />} />
          <Route path="/:org/:team/repos/:repo/blame/:ref/*" element={<BlameView />} />
          <Route path="/:org/:team/repos/:repo/history/:ref/*" element={<FileHistory />} />
          <Route path="/:org/:team/repos/:repo/compare" element={<BranchCompare />} />
          <Route path="/:org/:team/repos/:repo/settings" element={<RepoSettings />} />
          <Route path="/:org/:team/repos/:repo/runs/:runId" element={<PipelineRunDetail />} />

          {/* Issue routes */}
          <Route path="/:org/:team/:project" element={<ProjectRedirect />} />
          <Route path="/:org/:team/:project/backlog" element={<Backlog />} />
          <Route path="/:org/:team/:project/board" element={<Board />} />
          <Route path="/:org/:team/:project/issues" element={<IssueList />} />
          <Route path="/:org/:team/:project/issues/new" element={<IssueCreate />} />
          <Route path="/:org/:team/:project/issues/:num" element={<IssueDetail />} />
          <Route path="/:org/:team/:project/roadmap" element={<Roadmap />} />
          <Route path="/:org/:team/:project/settings/fields" element={<CustomFieldSettings />} />
          <Route path="/:org/:team/:project/settings/workflow" element={<WorkflowEditor />} />
          <Route path="/:org/:team/:project/settings/automation" element={<AutomationRules />} />
          <Route path="/:org/:team/:project/settings/labels" element={<LabelsSettings />} />
          <Route path="/:org/:team/:project/settings/templates" element={<IssueTemplates />} />

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
          <Route path="/settings/notifications" element={<NotificationSettings />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<UserManagement />} />
          <Route path="/admin/settings" element={<SystemSettings />} />
          <Route path="/admin/audit-logs" element={<AuditLogs />} />

          {/* Search */}
          <Route path="/search" element={<SearchResults />} />
        </Route>
      </Route>
    </Routes>
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
