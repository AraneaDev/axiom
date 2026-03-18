import { get } from './client';

export interface CommitFrequencyPoint {
  date: string;
  count: number;
}

export interface ContributorInfo {
  name: string;
  email: string;
  commits: number;
  lastCommitDate: string;
}

export interface LanguageBreakdown {
  language: string;
  bytes: number;
  percentage: number;
}

export interface CodeFrequencyPoint {
  week: string;
  additions: number;
  deletions: number;
}

export const insightsApi = {
  getCommitFrequency: (repoId: string, days?: number) => {
    const params = days ? `?days=${days}` : '';
    return get<CommitFrequencyPoint[]>(`/repos/${repoId}/insights/commit-frequency${params}`);
  },

  getContributors: (repoId: string) =>
    get<ContributorInfo[]>(`/repos/${repoId}/insights/contributors`),

  getLanguages: (repoId: string, ref?: string) => {
    const params = ref ? `?ref=${ref}` : '';
    return get<LanguageBreakdown[]>(`/repos/${repoId}/insights/languages${params}`);
  },

  getCodeFrequency: (repoId: string, weeks?: number) => {
    const params = weeks ? `?weeks=${weeks}` : '';
    return get<CodeFrequencyPoint[]>(`/repos/${repoId}/insights/code-frequency${params}`);
  },
};
