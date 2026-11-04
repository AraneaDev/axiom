import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineAction, type ActionDef } from './define';
import { listActions } from './registry';

/** Writes tokens may not make until plan 3 adds approval (R9) */
const TOKEN_BLOCKED_WRITE_AREAS = new Set(['admin', 'orgs', 'teams', 'projects']);

/**
 * Every actions file below a directory, tests excluded by their suffix.
 * @param root - The directory to search
 */
function findActionFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(
      (file) => file.endsWith('.actions.ts') && !file.split(path.sep).includes('node_modules'),
    )
    .map((file) => path.join(root, file));
}

/**
 * Import actions files. A file that registers nothing fails here, or its actions would escape
 * the rules below: these files register themselves when imported.
 * @param files - Absolute paths
 */
async function loadActionFiles(files: string[]): Promise<void> {
  for (const file of files) {
    const before = listActions().length;
    await import(file);
    if (listActions().length === before) {
      throw new Error(`${file} registered no actions; call registerActions when imported`);
    }
  }
}

/**
 * The fields of an object schema. Undefined for anything else (a union, a transform), whose
 * fields can't be listed, so the rules below treat it as breaking them.
 * @param schema - The schema
 */
function fieldsOf(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  return schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodType>) : undefined;
}

/**
 * The names of a path's params.
 * @param restPath - An Express path, e.g. /api/x/:id
 */
function paramsOf(restPath: string): string[] {
  return restPath
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/**
 * What an action breaks of the rules for the registry.
 * @param def - The action
 */
function ruleViolations(def: ActionDef): string[] {
  const violations: string[] = [];
  const inputFields = fieldsOf(def.input);

  if (
    def.kind === 'write' &&
    TOKEN_BLOCKED_WRITE_AREAS.has(def.area) &&
    !def.uiOnly &&
    !def.tokenBlocked
  ) {
    violations.push(`${def.name}: a write in area ${def.area} needs uiOnly or tokenBlocked (R9)`);
  }

  if (def.rest && !def.target) {
    const params = paramsOf(def.rest.path);
    const beyondParams =
      !inputFields || Object.keys(inputFields).some((field) => !params.includes(field));
    if (beyondParams) {
      violations.push(`${def.name}: an input beyond the path params needs a target (R10, R11)`);
    }
  }

  if (def.target) {
    const targetFields = fieldsOf(def.target);
    if (!targetFields || !inputFields) {
      violations.push(`${def.name}: target and input must both be objects to compare (R11)`);
    } else {
      for (const [field, schema] of Object.entries(targetFields)) {
        if (inputFields[field] !== schema) {
          violations.push(`${def.name}: target.${field} is not the schema of input.${field} (R11)`);
        }
      }
    }
  }

  return violations;
}

const output = z.looseObject({});
const noAuthorize = async () => {};
const noHandler = async () => ({});
const throwaway = {
  summary: 'Throwaway, never registered',
  output,
  authorize: noAuthorize,
  handler: noHandler,
};

describe('registry rules', () => {
  beforeAll(async () => {
    await loadActionFiles(findActionFiles(path.resolve(__dirname, '..')));
  });

  it('holds for every registered action', () => {
    expect(listActions().flatMap(ruleViolations)).toEqual([]);
  });

  describe('R9: writes that tokens may not make', () => {
    it.each(['admin', 'orgs', 'teams', 'projects'] as const)(
      'fails on a write in area %s without a flag',
      (area) => {
        const action = defineAction({
          ...throwaway,
          name: 'throwaway.write',
          area,
          kind: 'write',
          input: z.object({}),
        });
        expect(ruleViolations(action)).toEqual([expect.stringContaining('R9')]);
      },
    );

    it('passes with uiOnly or tokenBlocked, on reads and in other areas', () => {
      const base = { ...throwaway, name: 'throwaway.ok', input: z.object({}) };
      const write = { ...base, kind: 'write' as const };
      expect(ruleViolations(defineAction({ ...write, area: 'orgs', uiOnly: true }))).toEqual([]);
      expect(ruleViolations(defineAction({ ...write, area: 'orgs', tokenBlocked: true }))).toEqual(
        [],
      );
      expect(ruleViolations(defineAction({ ...base, area: 'orgs', kind: 'read' }))).toEqual([]);
      expect(ruleViolations(defineAction({ ...write, area: 'issues' }))).toEqual([]);
    });
  });

  describe('R10, R11: a binding with more than path params declares a target', () => {
    const bound = {
      ...throwaway,
      name: 'throwaway.bound',
      area: 'issues' as const,
      kind: 'write' as const,
      rest: { method: 'POST' as const, path: '/api/x/:projectId' },
    };

    it('fails on body or query fields without a target', () => {
      const action = defineAction({
        ...bound,
        input: z.object({ projectId: z.string(), title: z.string() }),
      });
      expect(ruleViolations(action)).toEqual([expect.stringContaining('needs a target')]);
    });

    it('fails on an input whose fields cannot be listed', () => {
      const action = defineAction({
        ...bound,
        input: z.object({ projectId: z.string() }).transform((value) => value),
      });
      expect(ruleViolations(action)).toEqual([expect.stringContaining('needs a target')]);
    });

    it('passes when the input is only the path params, or there is no binding', () => {
      const params = z.object({ projectId: z.string() });
      expect(ruleViolations(defineAction({ ...bound, input: params }))).toEqual([]);

      const { rest: _rest, ...unbound } = bound;
      const action = defineAction({
        ...unbound,
        input: z.object({ projectId: z.string(), title: z.string() }),
      });
      expect(ruleViolations(action)).toEqual([]);
    });

    it('passes with a target the input extends', () => {
      const target = z.object({ projectId: z.string() });
      const action = defineAction({
        ...bound,
        target,
        input: target.extend({ title: z.string() }),
      });
      expect(ruleViolations(action)).toEqual([]);
    });
  });

  describe('R11: target and input share their id fields', () => {
    const targeted = {
      ...throwaway,
      name: 'throwaway.targeted',
      area: 'issues' as const,
      kind: 'write' as const,
    };

    it('fails when a field of the same name is a different schema', () => {
      const action = defineAction({
        ...targeted,
        target: z.object({ projectId: z.string() }),
        input: z.object({ projectId: z.string(), title: z.string() }),
      });
      expect(ruleViolations(action)).toEqual([expect.stringContaining('target.projectId')]);
    });

    it('fails when the input lacks a target field', () => {
      const action = defineAction({
        ...targeted,
        target: z.object({ projectId: z.string() }),
        input: z.object({ title: z.string() }),
      });
      expect(ruleViolations(action)).toEqual([expect.stringContaining('target.projectId')]);
    });

    it('fails when the fields cannot be compared', () => {
      const action = defineAction({
        ...targeted,
        target: z.object({ projectId: z.string() }),
        input: z.object({ projectId: z.string() }).transform((value) => value),
      });
      expect(ruleViolations(action)).toEqual([expect.stringContaining('compare')]);
    });
  });

  describe('loading actions files', () => {
    let root: string;

    beforeAll(() => {
      root = mkdtempSync(path.join(tmpdir(), 'registry-rules-'));
      mkdirSync(path.join(root, 'deep', 'er'), { recursive: true });
      mkdirSync(path.join(root, 'node_modules'));
      writeFileSync(path.join(root, 'deep', 'er', 'a.actions.ts'), 'export const a = 1;\n');
      writeFileSync(path.join(root, 'deep', 'a.actions.test.ts'), '');
      writeFileSync(path.join(root, 'deep', 'a.routes.ts'), '');
      writeFileSync(path.join(root, 'node_modules', 'b.actions.ts'), '');
      return () => rmSync(root, { recursive: true });
    });

    it('finds every actions file at any depth, and no others', () => {
      expect(findActionFiles(root)).toEqual([path.join(root, 'deep', 'er', 'a.actions.ts')]);
    });

    it('fails on an actions file that registers nothing', async () => {
      await expect(loadActionFiles(findActionFiles(root))).rejects.toThrow('registered no actions');
    });
  });
});
