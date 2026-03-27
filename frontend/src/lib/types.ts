// Shared frontend types matching backend models

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  role?: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string;
  _count?: { members: number; repos: number; projects: number };
  members?: TeamMember[];
  repos?: { id: string; name: string; slug: string; visibility: string }[];
  projects?: { id: string; name: string; slug: string; prefix: string }[];
  wikiSpaces?: { id: string; name: string; slug: string }[];
}

export interface TeamMember {
  id: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  user: { id: string; username: string; displayName: string };
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string;
  prefix: string;
  _count?: { issues: number };
}

export interface ProjectAnalytics {
  totalIssues: number;
  openCount: number;
  closedCount: number;
  avgCycleTime: number;
  avgLeadTime: number;
  issuesByStatus: { status: string; isDone: boolean; count: number }[];
  issuesByPriority: { priority: string; count: number }[];
  issuesOverTime: { date: string; opened: number; closed: number }[];
  memberWorkload: {
    userId: string;
    displayName: string;
    username: string;
    assignedCount: number;
    inProgressCount: number;
    completedCount: number;
  }[];
}

export interface TimeReport {
  members: {
    userId: string;
    displayName: string;
    username: string;
    totalMinutes: number;
    estimateMinutes: number;
  }[];
  issues: {
    issueId: string;
    number: number;
    title: string;
    estimateMinutes: number | null;
    loggedMinutes: number;
    sprintId: string | null;
    sprintName: string | null;
  }[];
}

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
  isDefault: boolean;
  isDone: boolean;
  issues: Issue[];
}

export interface Issue {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  body: string;
  type: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  assignee?: { id: string; username: string; displayName: string };
  creator: { id: string; username: string; displayName: string };
  labels: Label[];
  column?: { id: string; name: string; isDone?: boolean };
  comments?: Comment[];
  parentId?: string;
  parent?: { id: string; number: number; title: string; key?: string };
  children?: Issue[];
  dueDate?: string;
  storyPoints?: number;
  sprintId?: string;
  sprint?: { id: string; name: string };
  timeEstimate?: number | null;
  timeSpent?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpicProgress {
  total: number;
  completed: number;
  inProgress: number;
  percentage: number;
}

export interface RoadmapEpic extends Issue {
  progress: { total: number; completed: number; percentage: number };
  startDate: string;
  endDate: string;
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: 'PLANNING' | 'ACTIVE' | 'COMPLETED';
  issues: Issue[];
  _storyPoints?: number;
  createdAt: string;
}

export interface VelocityDataPoint {
  sprintId: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  completedPoints: number;
  issueCount: number;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface Comment {
  id: string;
  body: string;
  author: { id: string; username: string; displayName: string };
  createdAt: string;
  updatedAt: string;
}

export interface WikiSpace {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string;
  isArchived?: boolean;
  _count?: { pages: number };
}

export interface Page {
  id: string;
  spaceId: string;
  title: string;
  slug: string;
  body: string;
  parentId?: string;
  isDraft: boolean;
  children?: PageTreeNode[];
  versions?: PageVersion[];
  restrictions?: PageRestriction[];
  createdAt: string;
  updatedAt: string;
}

export interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  parentId?: string;
  position: number;
  children: PageTreeNode[];
}

export interface PageVersion {
  id: string;
  version: number;
  title: string;
  body: string;
  author: { id: string; username: string; displayName: string };
  changeDescription?: string | null;
  createdAt: string;
}

export interface DiffChange {
  value: string;
  added: boolean;
  removed: boolean;
}

export interface DiffResult {
  from: {
    version: number;
    title: string;
    body: string;
    author: { id: string; username: string; displayName: string };
    changeDescription?: string | null;
    createdAt: string;
  };
  to: {
    version: number;
    title: string;
    body: string;
    author: { id: string; username: string; displayName: string };
    changeDescription?: string | null;
    createdAt: string;
  };
  changes: DiffChange[];
}

export interface PageTemplate {
  id: string;
  spaceId: string;
  name: string;
  body: string;
  description?: string;
  isBuiltIn: boolean;
  createdAt: string;
}

export interface PageComment {
  id: string;
  pageId: string;
  userId: string;
  user: { id: string; username: string; displayName: string };
  body: string;
  anchorText?: string;
  resolved: boolean;
  createdAt: string;
}

export interface PageLabel {
  id: string;
  pageId: string;
  label: string;
}

export interface PageRestriction {
  id: string;
  pageId: string;
  type: 'VIEW' | 'EDIT';
  userId?: string;
  user?: { id: string; username: string; displayName: string };
  teamRoleMin?: string;
  createdAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  token?: string; // Only returned on creation
}

export interface SshKey {
  id: string;
  title: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface SearchResultItem {
  id: string;
  url: string;
  type?: string;
  key?: string;
  title?: string;
  name?: string;
  priority?: string;
  status?: string;
  projectName?: string;
  spaceName?: string;
  snippet?: string;
  description?: string;
  visibility?: string;
  assignee?: { id: string; username: string; displayName: string; avatarUrl?: string };
  space?: { name: string };
  slug?: string;
}

export interface SearchResult {
  type: 'issues' | 'wiki' | 'repos' | 'code';
  items: SearchResultItem[];
  total: number;
}

export interface CodeMatch {
  repoId: string;
  repoName: string;
  repoUrl: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

export interface CodeSearchResult {
  type: 'code';
  items: CodeMatch[];
  total: number;
}

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  query: { q: string; type?: string; filters?: Record<string, string> };
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}
