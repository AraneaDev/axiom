/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import { Route, Navigate } from 'react-router';

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
const SearchResults = lazy(() => import('@/pages/search/SearchResults'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('@/pages/admin/UserManagement'));
const SystemSettings = lazy(() => import('@/pages/admin/SystemSettings'));
const AuditLogs = lazy(() => import('@/pages/admin/AuditLogs'));
const LandingPageEditor = lazy(() => import('@/pages/admin/LandingPageEditor'));
const SecuritySettings = lazy(() => import('@/pages/admin/SecuritySettings'));
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

      {/* The base rules of an org; only its owners change them */}
      <Route
        path="/:org/settings/agent-approvals"
        element={
          <ErrorBoundary>
            <OrgAgentApprovals />
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
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<Profile />} />
        <Route path="security" element={<Security />} />
        <Route path="tokens" element={<ApiTokens />} />
        <Route path="connect-agent" element={<ConnectAgent />} />
        <Route path="notifications" element={<NotificationSettings />} />
        <Route path="agent-approvals" element={<AgentApprovalRules />} />
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
