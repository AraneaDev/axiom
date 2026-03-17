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
  column?: { id: string; name: string };
  comments?: Comment[];
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
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

export interface SearchResult {
  type: 'issues' | 'wiki';
  items: Record<string, unknown>[];
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}
