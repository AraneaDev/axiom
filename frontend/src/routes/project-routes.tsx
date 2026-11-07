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
const ApprovalsSettings = lazy(() => import('@/pages/projects/ApprovalsSettings'));
const GithubSettings = lazy(() => import('@/pages/projects/GithubSettings'));
const FormsSettings = lazy(() => import('@/pages/projects/FormsSettings'));
const FormBuilderPage = lazy(() => import('@/pages/projects/FormBuilderPage'));
const AutomationRules = lazy(() => import('@/pages/projects/AutomationRules'));
const IntakeQueue = lazy(() => import('@/pages/intake/IntakeQueue'));
const LabelsSettings = lazy(() => import('@/pages/projects/LabelsSettings'));
const IssueTemplates = lazy(() => import('@/pages/projects/IssueTemplates'));
const Milestones = lazy(() => import('@/pages/projects/Milestones'));
const SprintReport = lazy(() => import('@/pages/issues/SprintReport'));

const MyApprovals = lazy(() => import('@/pages/approvals/MyApprovals'));
const OrgAnalytics = lazy(() => import('@/pages/analytics/OrgAnalytics'));
const TeamAnalytics = lazy(() => import('@/pages/analytics/TeamAnalytics'));
const TeamRoadmap = lazy(() => import('@/pages/roadmap/TeamRoadmap'));

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
      {/* Org-level approvals page */}
      <Route
        path="/:org/approvals"
        element={
          <ErrorBoundary>
            <MyApprovals />
          </ErrorBoundary>
        }
      />

      {/* Org and Team analytics -- outside project layout */}
      <Route
        path="/:org/analytics"
        element={
          <ErrorBoundary>
            <OrgAnalytics />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/analytics"
        element={
          <ErrorBoundary>
            <TeamAnalytics />
          </ErrorBoundary>
        }
      />
      <Route
        path="/:org/:team/roadmap"
        element={
          <ErrorBoundary>
            <TeamRoadmap />
          </ErrorBoundary>
        }
      />

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
          path="sprints/:sprintId/report"
          element={
            <ErrorBoundary>
              <SprintReport />
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
          path="intake"
          element={
            <ErrorBoundary>
              <IntakeQueue />
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
          <Route path="approvals" element={<ApprovalsSettings />} />
          <Route path="github" element={<GithubSettings />} />
          <Route path="forms" element={<FormsSettings />} />
          <Route path="forms/:formId" element={<FormBuilderPage />} />
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
