/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import { Route, Navigate } from 'react-router';

import { OrgSettingsLayout } from '@/components/layout/OrgSettingsLayout';
import { SettingsLayout } from '@/components/layout/SettingsLayout';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

const Profile = lazy(() => import('@/pages/settings/Profile'));
const Security = lazy(() => import('@/pages/settings/Security'));
const ConnectAgent = lazy(() => import('@/pages/settings/ConnectAgent'));
const ApiTokens = lazy(() => import('@/pages/settings/ApiTokens'));
const NotificationSettings = lazy(() => import('@/pages/settings/NotificationSettings'));
const AgentApprovals = lazy(() => import('@/pages/approvals/AgentApprovals'));
const AgentApprovalDetail = lazy(() => import('@/pages/approvals/AgentApprovalDetail'));
const AgentApprovalRules = lazy(() => import('@/pages/settings/AgentApprovalRules'));
const OrgAgentApprovals = lazy(() => import('@/pages/orgs/OrgAgentApprovals'));
const ServiceAccounts = lazy(() => import('@/pages/orgs/ServiceAccounts'));
const ServiceAccountDetail = lazy(() => import('@/pages/orgs/ServiceAccountDetail'));
const SearchResults = lazy(() => import('@/pages/search/SearchResults'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('@/pages/admin/UserManagement'));
const SystemSettings = lazy(() => import('@/pages/admin/SystemSettings'));
const AuditLogs = lazy(() => import('@/pages/admin/AuditLogs'));
const LandingPageEditor = lazy(() => import('@/pages/admin/LandingPageEditor'));
const SecuritySettings = lazy(() => import('@/pages/admin/SecuritySettings'));
const GithubAccount = lazy(() => import('@/pages/settings/GithubAccount'));
const GithubAccountCallback = lazy(() =>
  import('@/pages/settings/GithubAccount').then((m) => ({ default: m.GithubAccountCallback })),
);
const GithubAppSettings = lazy(() => import('@/pages/admin/GithubAppSettings'));
const GithubAppCreated = lazy(() =>
  import('@/pages/admin/GithubAppSettings').then((m) => ({ default: m.GithubAppCreated })),
);
const GithubAppInstalled = lazy(() =>
  import('@/pages/admin/GithubAppSettings').then((m) => ({ default: m.GithubAppInstalled })),
);
const NotificationInbox = lazy(() => import('@/pages/notifications/NotificationInbox'));

/**
 *
 */
export function adminRoutes() {
  return (
    <>
      {/* Notifications */}
      <Route
        path="/notifications"
        element={
          <ErrorBoundary>
            <NotificationInbox />
          </ErrorBoundary>
        }
      />

      {/* Requests from agents that wait for the user */}
      <Route
        path="/approvals/agent"
        element={
          <ErrorBoundary>
            <AgentApprovals />
          </ErrorBoundary>
        }
      />
      <Route
        path="/approvals/agent/:id"
        element={
          <ErrorBoundary>
            <AgentApprovalDetail />
          </ErrorBoundary>
        }
      />

      {/* An org's settings: its bots, and the base rules only its owners change */}
      <Route
        path="/:org/settings"
        element={
          <ErrorBoundary>
            <OrgSettingsLayout />
          </ErrorBoundary>
        }
      >
        <Route index element={<Navigate to="service-accounts" replace />} />
        <Route path="service-accounts" element={<ServiceAccounts />} />
        <Route path="service-accounts/:id" element={<ServiceAccountDetail />} />
        <Route path="agent-approvals" element={<OrgAgentApprovals />} />
      </Route>

      {/* Settings */}
      <Route
        path="/settings"
        element={
          <ErrorBoundary>
            <SettingsLayout />
          </ErrorBoundary>
        }
      >
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<Profile />} />
        <Route path="security" element={<Security />} />
        <Route path="tokens" element={<ApiTokens />} />
        <Route path="connect-agent" element={<ConnectAgent />} />
        <Route path="notifications" element={<NotificationSettings />} />
        <Route path="agent-approvals" element={<AgentApprovalRules />} />
        <Route path="github" element={<GithubAccount />} />
        <Route path="github/callback" element={<GithubAccountCallback />} />
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
      <Route
        path="/admin/landing"
        element={
          <ErrorBoundary>
            <LandingPageEditor />
          </ErrorBoundary>
        }
      />
      <Route
        path="/admin/security"
        element={
          <ErrorBoundary>
            <SecuritySettings />
          </ErrorBoundary>
        }
      />

      <Route
        path="/admin/github"
        element={
          <ErrorBoundary>
            <GithubAppSettings />
          </ErrorBoundary>
        }
      />
      <Route
        path="/admin/github/created"
        element={
          <ErrorBoundary>
            <GithubAppCreated />
          </ErrorBoundary>
        }
      />
      <Route
        path="/admin/github/installed"
        element={
          <ErrorBoundary>
            <GithubAppInstalled />
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
    </>
  );
}
