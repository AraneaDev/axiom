import { get } from './client';

export interface DevelopmentSummary {
  branches: Array<{
    id: string;
    repoId: string;
    repoName: string;
    repoSlug: string;
    branchName: string;
    createdAt: string;
  }>;
  commits: Array<{
    id: string;
    repoId: string;
    repoName: string;
    repoSlug: string;
    sha: string;
    message: string;
    authorName: string;
    committedAt: string;
  }>;
  pullRequests: Array<{
    id: string;
    repoId: string;
    repoName: string;
    repoSlug: string;
    number: number;
    title: string;
    status: string;
    authorName: string;
    createdAt: string;
  }>;
  pipelines: Array<{
    id: string;
    repoName: string;
    pipelineName: string;
    status: string;
    ref: string;
    createdAt: string;
  }>;
  wikiPages: Array<{
    id: string;
    linkType: string;
    page: {
      id: string;
      title: string;
      slug: string;
      space: {
        id: string;
        name: string;
        slug: string;
        team: { slug: string; org: { slug: string } };
      };
    };
  }>;
}

export const developmentPanelApi = {
  getSummary: (projectId: string, issueNumber: number) =>
    get<DevelopmentSummary>(`/projects/${projectId}/issues/${issueNumber}/development`),
};
