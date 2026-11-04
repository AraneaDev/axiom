/**
 * Every numeric field of every action's input at the edges of the Int column and past them: an
 * answer is 2xx or 4xx, never a failed query behind a 500.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { prisma } from '../config/database';
import '../index';
import { AppError } from '../middleware/errorHandler';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

import type { ActionContext, ActionDef } from './define';
import { executeAction } from './execute';
import { listActions } from './registry';

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  enum?: unknown[];
  items?: JsonSchema;
  format?: string;
  const?: unknown;
};

const EDGES = [2 ** 31, 2 ** 31 - 1, -(2 ** 31), -(2 ** 31) - 1, 1e15, -1e15, 0, -1, 1.5];

/**
 * Whether a schema takes a number, and whether digits as text too.
 * @param schema
 */
function numberKinds(schema: JsonSchema): { number: boolean; text: boolean } {
  const options = schema.anyOf ?? [schema];
  return {
    number: options.some((option) => option.type === 'number' || option.type === 'integer'),
    text: options.some((option) => option.type === 'string'),
  };
}

/**
 * The dotted paths of the fields of a schema that take a number, nested objects included.
 * @param schema
 * @param prefix
 */
function numericPaths(schema: JsonSchema, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  for (const [field, inner] of Object.entries(schema.properties ?? {})) {
    const path = [...prefix, field];
    if (numberKinds(inner).number) paths.push(path);
    for (const option of inner.anyOf ?? [inner]) paths.push(...numericPaths(option, path));
  }
  return paths;
}

describe('numeric inputs of every action', () => {
  let ctx: TestContext;
  let session: ActionContext;
  let known: Record<string, unknown>;

  /**
   * A value a required field can take, real where it names a row.
   * @param field
   * @param schema
   */
  function sample(field: string, schema: JsonSchema): unknown {
    if (field in known) return known[field];
    const option = schema.anyOf?.[0] ?? schema;
    if (option.enum) return option.enum[0];
    if (option.const !== undefined) return option.const;
    if (option.type === 'boolean') return true;
    if (option.type === 'number' || option.type === 'integer') return 1;
    if (option.type === 'array') return [];
    if (option.type === 'object') return filled(option);
    if (option.format === 'date-time') return new Date().toISOString();
    return 'x';
  }

  function filled(schema: JsonSchema): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    for (const [field, inner] of Object.entries(schema.properties ?? {})) {
      if (schema.required?.includes(field) || field in known) input[field] = sample(field, inner);
    }
    return input;
  }

  function withValue(base: Record<string, unknown>, path: string[], value: unknown) {
    const input = structuredClone(base);
    let node = input;
    for (const part of path.slice(0, -1)) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = value;
    return input;
  }

  async function failureOf(def: ActionDef, input: unknown): Promise<string | undefined> {
    try {
      await executeAction(def.name, input, session);
      return undefined;
    } catch (err) {
      if (err instanceof AppError && err.statusCode < 500) return undefined;
      return (err as Error).message.slice(0, 200);
    }
  }

  beforeAll(async () => {
    ctx = await createTestContext(`fuzz${Date.now()}`);
    session = { userId: ctx.owner.id, channel: 'ui' };
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Fuzz', slug: 'fuzz' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'Fuzz', slug: 'fuzz', body: 'x' },
    });
    // A number no edge value lands on, so no case can touch this issue by accident
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 7777,
        title: 'Fuzz',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    const comment = await prisma.comment.create({
      data: { issueId: issue.id, authorId: ctx.owner.id, body: 'x' },
    });
    const sprint = await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name: 'Fuzz',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    known = {
      orgId: ctx.orgId,
      teamId: ctx.teamId,
      projectId: ctx.projectId,
      issueNumber: 7777,
      issueId: issue.id,
      spaceId: space.id,
      pageSlug: page.slug,
      pageId: page.id,
      commentId: comment.id,
      sprintId: sprint.id,
    };
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('finds the fields that matter', () => {
    const names = listActions().filter(
      (def) =>
        !def.rest?.raw &&
        numericPaths(
          z.toJSONSchema(def.input, { io: 'input', unrepresentable: 'any' }) as JsonSchema,
        ).length > 0,
    );
    expect(names.map((def) => def.name)).toEqual(
      expect.arrayContaining(['issue.update', 'issue.move', 'page.diff', 'page.restore']),
    );
  });

  it('answers 2xx or 4xx at every edge, as a number and as digits', async () => {
    const failures: string[] = [];
    for (const def of listActions()) {
      if (def.rest?.raw || def.name.startsWith('test.')) continue;
      const schema = z.toJSONSchema(def.input, {
        io: 'input',
        unrepresentable: 'any',
      }) as JsonSchema;
      const paths = numericPaths(schema);
      if (paths.length === 0) continue;
      const base = filled(schema);
      for (const path of paths) {
        let field: JsonSchema = schema;
        for (const part of path) {
          field =
            field.properties?.[part] ??
            field.anyOf?.find((option) => option.properties?.[part])?.properties?.[part] ??
            {};
        }
        const { text } = numberKinds(field);
        for (const edge of EDGES) {
          const values: unknown[] = text && Number.isInteger(edge) ? [edge, String(edge)] : [edge];
          for (const value of values) {
            const failure = await failureOf(def, withValue(base, path, value));
            if (failure)
              failures.push(`${def.name} ${path.join('.')}=${String(value)}: ${failure}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
