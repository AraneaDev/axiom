import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router';

import { KeyboardShortcutHelp } from '@/components/KeyboardShortcutHelp';
import { AppShell } from '@/components/layout/AppShell';
import { ProjectSettingsLayout } from '@/components/layout/ProjectSettingsLayout';
import { SettingsLayout } from '@/components/layout/SettingsLayout';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { PageLoader } from '@/components/ui/Spinner';
import { ToastProvider } from '@/components/ui/Toast';
import { useGlobalKeyboard } from '@/hooks/useKeyboard';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { AuthGuard, GuestGuard } from '@/lib/guards';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';

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
const MemberProfile = lazy(() => import('@/pages/teams/MemberProfile'));
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
const ProjectAnalytics = lazy(() => import('@/pages/projects/ProjectAnalytics'));
const TimeReport = lazy(() => import('@/pages/projects/TimeReport'));
const CustomFieldSettings = lazy(() => import('@/pages/projects/CustomFieldSettings'));
const WorkflowEditor = lazy(() => import('@/pages/projects/WorkflowEditor'));
const AutomationRules = lazy(() => import('@/pages/projects/AutomationRules'));
const LabelsSettings = lazy(() => import('@/pages/projects/LabelsSettings'));
const IssueTemplates = lazy(() => import('@/pages/projects/IssueTemplates'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('@/pages/admin/UserManagement'));
const SystemSettings = lazy(() => import('@/pages/admin/SystemSettings'));
const AuditLogs = lazy(() => import('@/pages/admin/AuditLogs'));
const NotificationInbox = lazy(() => import('@/pages/notifications/NotificationInbox'));

function SuspenseLoader({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function ProjectRedirect() {
  const { org, team, project } = useParams();
  return <Navigate to={`/${org}/${team}/${project}/issues`} replace />;
}

function AppWithKeyboard() {
  useGlobalKeyboard();
  useRealtimeInvalidation();
  const { shortcutHelpOpen, setShortcutHelpOpen } = useUIStore();

  return (
    <>
      <KeyboardShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
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
            <Route
              path="/"
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
            <Route
              path="/:org/:team/repos"
              element={
                <ErrorBoundary>
                  <RepoList />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/new"
              element={
                <ErrorBoundary>
                  <CreateRepo />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo"
              element={
                <ErrorBoundary>
                  <RepoDetail />
                </ErrorBoundary>
              }
            />
            <Route path="/:org/:team/repos/:repo/tree" element={<Navigate to=".." replace />} />
            <Route
              path="/:org/:team/repos/:repo/tree/:ref/*"
              element={
                <ErrorBoundary>
                  <FileBrowser />
                </ErrorBoundary>
              }
            />
            <Route path="/:org/:team/repos/:repo/blob" element={<Navigate to=".." replace />} />
            <Route
              path="/:org/:team/repos/:repo/blob/:ref/*"
              element={
                <ErrorBoundary>
                  <FileView />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/pulls"
              element={
                <ErrorBoundary>
                  <PRList />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/pulls/:number"
              element={
                <ErrorBoundary>
                  <PRDetail />
                </ErrorBoundary>
              }
            />
            <Route path="/:org/:team/repos/:repo/commits" element={<Navigate to=".." replace />} />
            <Route
              path="/:org/:team/repos/:repo/commits/:sha"
              element={
                <ErrorBoundary>
                  <CommitDetail />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/blame/:ref/*"
              element={
                <ErrorBoundary>
                  <BlameView />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/history/:ref/*"
              element={
                <ErrorBoundary>
                  <FileHistory />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/compare"
              element={
                <ErrorBoundary>
                  <BranchCompare />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/settings"
              element={
                <ErrorBoundary>
                  <RepoSettings />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/repos/:repo/runs/:runId"
              element={
                <ErrorBoundary>
                  <PipelineRunDetail />
                </ErrorBoundary>
              }
            />

            {/* Issue routes */}
            <Route path="/:org/:team/:project" element={<ProjectRedirect />} />
            <Route
              path="/:org/:team/:project/backlog"
              element={
                <ErrorBoundary>
                  <Backlog />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/board"
              element={
                <ErrorBoundary>
                  <Board />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/issues"
              element={
                <ErrorBoundary>
                  <IssueList />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/issues/new"
              element={
                <ErrorBoundary>
                  <IssueCreate />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/issues/:num"
              element={
                <ErrorBoundary>
                  <IssueDetail />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/roadmap"
              element={
                <ErrorBoundary>
                  <Roadmap />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/analytics"
              element={
                <ErrorBoundary>
                  <ProjectAnalytics />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/time-report"
              element={
                <ErrorBoundary>
                  <TimeReport />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/:project/settings"
              element={
                <ErrorBoundary>
                  <ProjectSettingsLayout />
                </ErrorBoundary>
              }
            >
              <Route path="labels" element={<LabelsSettings />} />
              <Route path="fields" element={<CustomFieldSettings />} />
              <Route path="templates" element={<IssueTemplates />} />
              <Route path="automation" element={<AutomationRules />} />
              <Route path="workflow" element={<WorkflowEditor />} />
            </Route>

            {/* Wiki routes */}
            <Route
              path="/:org/:team/wiki"
              element={
                <ErrorBoundary>
                  <WikiHome />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/wiki/new"
              element={
                <ErrorBoundary>
                  <CreateWikiSpace />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/wiki/:space"
              element={
                <ErrorBoundary>
                  <PageView />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/wiki/:space/new"
              element={
                <ErrorBoundary>
                  <PageEdit />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/wiki/:space/:page"
              element={
                <ErrorBoundary>
                  <PageView />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/wiki/:space/:page/edit"
              element={
                <ErrorBoundary>
                  <PageEdit />
                </ErrorBoundary>
              }
            />
            <Route
              path="/:org/:team/wiki/:space/:page/history"
              element={
                <ErrorBoundary>
                  <PageHistory />
                </ErrorBoundary>
              }
            />

            {/* Notifications */}
            <Route
              path="/notifications"
              element={
                <ErrorBoundary>
                  <NotificationInbox />
                </ErrorBoundary>
              }
            />

            {/* Settings */}
            <Route
              path="/settings"
              element={
                <ErrorBoundary>
                  <SettingsLayout />
                </ErrorBoundary>
              }
            >
              <Route path="profile" element={<Profile />} />
              <Route path="security" element={<Security />} />
              <Route path="ssh-keys" element={<SshKeys />} />
              <Route path="tokens" element={<ApiTokens />} />
              <Route path="notifications" element={<NotificationSettings />} />
            </Route>

            {/* Admin */}
            <Route
              path="/admin"
              element={
                <ErrorBoundary>
                  <AdminDashboard />
                </ErrorBoundary>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ErrorBoundary>
                  <UserManagement />
                </ErrorBoundary>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <ErrorBoundary>
                  <SystemSettings />
                </ErrorBoundary>
              }
            />
            <Route
              path="/admin/audit-logs"
              element={
                <ErrorBoundary>
                  <AuditLogs />
                </ErrorBoundary>
              }
            />

            {/* Search */}
            <Route
              path="/search"
              element={
                <ErrorBoundary>
                  <SearchResults />
                </ErrorBoundary>
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
