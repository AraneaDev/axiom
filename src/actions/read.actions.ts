import { z } from 'zod';

import { defineAction } from './define';
import { MAX_KEY_LENGTH } from './keys';
import {
  ISSUE_FIELDS,
  ISSUE_INCLUDES,
  PAGE_FIELDS,
  PAGE_INCLUDES,
  readItems,
  type ReadInclude,
} from './read.service';
import { registerActions } from './registry';

const MAX_KEYS = 50;

const timestamp = z.string();
const userRef = z.strictObject({ id: z.string(), displayName: z.string() });

/**
 * An include: its rows, the cap on them, and whether the cap cut any off.
 * @param item - The schema of a row
 */
const capped = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), limit: z.number(), truncated: z.boolean() });

const issueSummary = z.strictObject({
  id: z.string(),
  key: z.string(),
  fullKey: z.string(),
  url: z.string(),
  title: z.string(),
  status: z.string().nullable(),
});
const pageSummary = z.strictObject({
  id: z.string(),
  key: z.string(),
  url: z.string(),
  title: z.string(),
  slug: z.string(),
});
const attachment = z.strictObject({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  url: z.string(),
  uploader: userRef,
  createdAt: timestamp,
});

/** With `fields` the base shrinks to what was named, so only id and key are always there. */
const issueData = z.strictObject({
  id: z.string(),
  key: z.string(),
  fullKey: z.string().optional(),
  url: z.string().optional(),
  number: z.number().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  type: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().nullable().optional(),
  assignee: userRef.nullable().optional(),
  creator: userRef.optional(),
  labels: z.array(z.strictObject({ id: z.string(), name: z.string() })).optional(),
  sprint: z.strictObject({ id: z.string(), name: z.string() }).nullable().optional(),
  parent: issueSummary.nullable().optional(),
  project: z
    .strictObject({ id: z.string(), name: z.string(), prefix: z.string(), slug: z.string() })
    .optional(),
  storyPoints: z.number().nullable().optional(),
  dueDate: timestamp.nullable().optional(),
  startDate: timestamp.nullable().optional(),
  timeEstimate: z.number().nullable().optional(),
  timeSpent: z.number().nullable().optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
  comments: capped(
    z.strictObject({
      id: z.string(),
      body: z.string().optional(),
      author: userRef,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  ).optional(),
  links: capped(
    z.strictObject({
      id: z.string(),
      type: z.string(),
      direction: z.enum(['outward', 'inward']),
      issue: issueSummary,
    }),
  ).optional(),
  webLinks: capped(
    z.strictObject({
      id: z.string(),
      url: z.string(),
      title: z.string().nullable(),
      createdBy: userRef,
      createdAt: timestamp,
    }),
  ).optional(),
  attachments: capped(attachment).optional(),
  history: capped(
    z.strictObject({
      id: z.string(),
      action: z.string(),
      details: z.json().nullable(),
      via: z.string().nullable(),
      actor: userRef,
      createdAt: timestamp,
    }),
  ).optional(),
  worklogs: capped(
    z.strictObject({
      id: z.string(),
      minutes: z.number(),
      description: z.string().nullable(),
      loggedAt: timestamp,
      user: userRef,
    }),
  ).optional(),
  children: capped(issueSummary).optional(),
  pages: capped(pageSummary.extend({ linkTypes: z.array(z.string()) })).optional(),
  omittedIncludes: z.array(z.string()).optional(),
});

const pageData = z.strictObject({
  id: z.string(),
  key: z.string(),
  url: z.string().optional(),
  slug: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  isDraft: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  space: z.strictObject({ id: z.string(), name: z.string(), slug: z.string() }).optional(),
  version: z.number().nullable().optional(),
  lastEditedBy: userRef.nullable().optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
  children: capped(pageSummary).optional(),
  attachments: capped(attachment).optional(),
  history: capped(
    z.strictObject({
      id: z.string(),
      version: z.number(),
      title: z.string(),
      changeDescription: z.string().nullable(),
      kind: z.string(),
      author: userRef,
      createdAt: timestamp,
    }),
  ).optional(),
  labels: capped(z.string()).optional(),
  linkedIssues: capped(
    z.strictObject({ issue: issueSummary, linkTypes: z.array(z.string()) }),
  ).optional(),
  comments: capped(
    z.strictObject({
      id: z.string(),
      body: z.string().optional(),
      anchorText: z.string().nullable(),
      resolved: z.boolean(),
      author: userRef,
      createdAt: timestamp,
    }),
  ).optional(),
  omittedIncludes: z.array(z.string()).optional(),
});

const itemError = z.strictObject({
  status: z.number(),
  code: z.string(),
  message: z.string(),
  details: z.strictObject({ candidates: z.array(z.string()) }).optional(),
});

const readOutput = z.strictObject({
  /** The most the call returns, and whether that left items with 413 RESPONSE_TOO_LARGE */
  byteLimit: z.number(),
  truncated: z.boolean(),
  items: z.array(
    z.union([
      z.strictObject({ key: z.string(), kind: z.literal('issue'), data: issueData }),
      z.strictObject({ key: z.string(), kind: z.literal('page'), data: pageData }),
      z.strictObject({ key: z.string(), error: itemError }),
    ]),
  ),
});

// Nothing to authorize on as a whole: each item is checked in the handler, and answers for itself
const readTarget = z.object({});

const includeNames = [...new Set<ReadInclude>([...ISSUE_INCLUDES, ...PAGE_INCLUDES])] as [
  ReadInclude,
  ...ReadInclude[],
];
const fieldNames = [...new Set([...ISSUE_FIELDS, ...PAGE_FIELDS])] as [
  (typeof ISSUE_FIELDS)[number] | (typeof PAGE_FIELDS)[number],
  ...Array<(typeof ISSUE_FIELDS)[number] | (typeof PAGE_FIELDS)[number]>,
];

const readActions = [
  defineAction({
    name: 'item.read',
    area: 'search',
    kind: 'read',
    summary:
      'Read issues and pages by key or URL in one call, with their comments, links, history and ' +
      'more. Each key answers for itself; an include for the other kind of item is passed over.',
    target: readTarget,
    input: readTarget.extend({
      keys: z.array(z.string().min(1).max(MAX_KEY_LENGTH)).min(1).max(MAX_KEYS),
      include: z.array(z.enum(includeNames)).optional(),
      fields: z.array(z.enum(fieldNames)).optional(),
      commentBodies: z.boolean().optional(),
    }),
    output: readOutput,
    checksOwnText: true,
    rest: { method: 'POST', path: '/api/read', status: 200 },
    // Per item in the handler: resolveKey for access, then the item's own area scope (R4)
    authorize: async () => {},
    handler: async (ctx, { keys, ...options }) => readItems(ctx, keys, options),
  }),
];

registerActions(readActions);
