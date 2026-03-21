/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import { Route, Navigate } from 'react-router';

import { SettingsLayout } from '@/components/layout/SettingsLayout';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

const Profile = lazy(() => import('@/pages/settings/Profile'));
const Security = lazy(() => import('@/pages/settings/Security'));
const SshKeys = lazy(() => import('@/pages/settings/SshKeys'));
const ApiTokens = lazy(() => import('@/pages/settings/ApiTokens'));
const NotificationSettings = lazy(() => import('@/pages/settings/NotificationSettings'));
const SearchResults = lazy(() => import('@/pages/search/SearchResults'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('@/pages/admin/UserManagement'));
const SystemSettings = lazy(() => import('@/pages/admin/SystemSettings'));
const AuditLogs = lazy(() => import('@/pages/admin/AuditLogs'));
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
    </>
  );
}
