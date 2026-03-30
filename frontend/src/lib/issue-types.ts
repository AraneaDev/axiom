export interface TeamMember {
  user: { id: string; displayName: string };
}

export interface IssueLinkResource {
  id: string;
  number: number;
  title: string;
  project: { slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
}

export interface IssueLink {
  id: string;
  type: string;
  fromId: string;
  fromKey: string;
  toKey: string;
  from: IssueLinkResource;
  to: IssueLinkResource;
}
