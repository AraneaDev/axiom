/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import { Route, Navigate } from 'react-router';

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

const RepoList = lazy(() => import('@/pages/repos/RepoList'));
const CreateRepo = lazy(() => import('@/pages/repos/CreateRepo'));
const RepoDetail = lazy(() => import('@/pages/repos/RepoDetail'));
const FileBrowser = lazy(() => import('@/pages/repos/FileBrowser'));
const FileView = lazy(() => import('@/pages/repos/FileView'));
const PRList = lazy(() => import('@/pages/repos/PRList'));
const PRCreate = lazy(() => import('@/pages/repos/PRCreate'));
const PRDetail = lazy(() => import('@/pages/repos/PRDetail'));
const CommitDetail = lazy(() => import('@/pages/repos/CommitDetail'));
const BlameView = lazy(() => import('@/pages/repos/BlameView'));
const FileHistory = lazy(() => import('@/pages/repos/FileHistory'));
const BranchCompare = lazy(() => import('@/pages/repos/BranchCompare'));
const RepoSettings = lazy(() => import('@/pages/repos/RepoSettings'));
const PipelineRunDetail = lazy(() => import('@/pages/repos/PipelineRunDetail'));

/**
 *
 */
export function repoRoutes() {
  return (
    <>
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
      <Route
        path="/:org/:team/repos/:repo/branches"
        element={
          <ErrorBoundary>
            <RepoDetail />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/repos/:repo/commits"
        element={
          <ErrorBoundary>
            <RepoDetail />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/repos/:repo/releases"
        element={
          <ErrorBoundary>
            <RepoDetail />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/repos/:repo/pipelines"
        element={
          <ErrorBoundary>
            <RepoDetail />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/repos/:repo/environments"
        element={
          <ErrorBoundary>
            <RepoDetail />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/repos/:repo/insights"
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
        path="/:org/:team/repos/:repo/pulls/new"
        element={
          <ErrorBoundary>
            <PRCreate />
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
    </>
  );
}
