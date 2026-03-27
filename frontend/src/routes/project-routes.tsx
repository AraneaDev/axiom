/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import { Route, Navigate, useParams } from 'react-router';

import { ProjectLayout } from '@/components/layout/ProjectLayout';
import { ProjectSettingsLayout } from '@/components/layout/ProjectSettingsLayout';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

const Backlog = lazy(() => import('@/pages/issues/Backlog'));
const Board = lazy(() => import('@/pages/issues/Board'));
const IssueList = lazy(() => import('@/pages/issues/IssueList'));
const IssueCreate = lazy(() => import('@/pages/issues/IssueCreate'));
const IssueDetail = lazy(() => import('@/pages/issues/IssueDetail'));
const Roadmap = lazy(() => import('@/pages/issues/Roadmap'));
const ProjectAnalytics = lazy(() => import('@/pages/projects/ProjectAnalytics'));
const TimeReport = lazy(() => import('@/pages/projects/TimeReport'));
const CustomFieldSettings = lazy(() => import('@/pages/projects/CustomFieldSettings'));
const WorkflowEditor = lazy(() => import('@/pages/projects/WorkflowEditor'));
const AutomationRules = lazy(() => import('@/pages/projects/AutomationRules'));
const LabelsSettings = lazy(() => import('@/pages/projects/LabelsSettings'));
const IssueTemplates = lazy(() => import('@/pages/projects/IssueTemplates'));
const Milestones = lazy(() => import('@/pages/projects/Milestones'));

const WikiLayout = lazy(() => import('@/pages/wiki/WikiLayout'));
const WikiHome = lazy(() => import('@/pages/wiki/WikiHome'));
const CreateWikiSpace = lazy(() => import('@/pages/wiki/CreateWikiSpace'));
const PageView = lazy(() => import('@/pages/wiki/PageView'));
const PageEdit = lazy(() => import('@/pages/wiki/PageEdit'));
const PageHistory = lazy(() => import('@/pages/wiki/PageHistory'));
const PageDiff = lazy(() => import('@/pages/wiki/PageDiff'));

function ProjectRedirect() {
  const { org, team, project } = useParams();
  return <Navigate to={`/${org}/${team}/${project}/board`} replace />;
}

/**
 *
 */
export function projectRoutes() {
  return (
    <>
      {/* Project routes -- wrapped in ProjectLayout for persistent nav bar */}
      <Route path="/:org/:team/:project" element={<ProjectLayout />}>
        <Route index element={<ProjectRedirect />} />
        <Route
          path="board"
          element={
            <ErrorBoundary>
              <Board />
            </ErrorBoundary>
          }
        />
        <Route
          path="issues"
          element={
            <ErrorBoundary>
              <IssueList />
            </ErrorBoundary>
          }
        />
        <Route
          path="issues/new"
          element={
            <ErrorBoundary>
              <IssueCreate />
            </ErrorBoundary>
          }
        />
        <Route
          path="issues/:num"
          element={
            <ErrorBoundary>
              <IssueDetail />
            </ErrorBoundary>
          }
        />
        <Route
          path="backlog"
          element={
            <ErrorBoundary>
              <Backlog />
            </ErrorBoundary>
          }
        />
        <Route
          path="roadmap"
          element={
            <ErrorBoundary>
              <Roadmap />
            </ErrorBoundary>
          }
        />
        <Route
          path="milestones"
          element={
            <ErrorBoundary>
              <Milestones />
            </ErrorBoundary>
          }
        />
        <Route
          path="analytics"
          element={
            <ErrorBoundary>
              <ProjectAnalytics />
            </ErrorBoundary>
          }
        />
        <Route
          path="time-report"
          element={
            <ErrorBoundary>
              <TimeReport />
            </ErrorBoundary>
          }
        />
        <Route
          path="settings"
          element={
            <ErrorBoundary>
              <ProjectSettingsLayout />
            </ErrorBoundary>
          }
        >
          <Route index element={<Navigate to="labels" replace />} />
          <Route path="labels" element={<LabelsSettings />} />
          <Route path="fields" element={<CustomFieldSettings />} />
          <Route path="templates" element={<IssueTemplates />} />
          <Route path="automation" element={<AutomationRules />} />
          <Route path="workflow" element={<WorkflowEditor />} />
        </Route>
      </Route>

      {/* Wiki routes -- wrapped in WikiLayout for persistent sidebar */}
      <Route
        path="/:org/:team/wiki"
        element={
          <ErrorBoundary>
            <WikiLayout />
          </ErrorBoundary>
        }
      >
        <Route index element={<WikiHome />} />
        <Route path="new" element={<CreateWikiSpace />} />
        <Route path=":space" element={<PageView />} />
        <Route path=":space/new" element={<PageEdit />} />
        <Route path=":space/:page" element={<PageView />} />
        <Route path=":space/:page/edit" element={<PageEdit />} />
        <Route path=":space/:page/history" element={<PageHistory />} />
        <Route path=":space/:page/diff" element={<PageDiff />} />
      </Route>
    </>
  );
}
