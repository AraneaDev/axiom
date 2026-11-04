import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  normalizeApiPath,
  scopeAllows,
  TOKEN_SCOPES,
  tokenAllows,
} from '../middleware/token-scopes';

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
 * Import actions files. These register themselves when imported, so a file that never calls
 * registerActions fails here, or its actions would escape the rules below. Read from the source:
 * counting what an import adds fails on a file that another one already imported.
 * @param files - Absolute paths
 */
async function loadActionFiles(files: string[]): Promise<void> {
  for (const file of files) {
    if (!readFileSync(file, 'utf8').includes('registerActions(')) {
      throw new Error(`${file} registered no actions; call registerActions when imported`);
    }
    await import(file);
  }
}

/**
 * The actions files the app does not import, whose routes would silently stay on the legacy
 * routers and whose actions would be missing from describe.
 * @param files - Absolute paths
 * @param root - The directory the entry file is in
 * @param entrySource - The source of the entry file
 */
function filesNotImported(files: string[], root: string, entrySource: string): string[] {
  return files.filter((file) => {
    const specifier = `./${path.relative(root, file).split(path.sep).join('/').replace(/\.ts$/, '')}`;
    return !entrySource.includes(`'${specifier}'`);
  });
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
 * Whether an object schema does something with unknown fields: a loose one hands them to the
 * handler and a strict one answers 400 before authorize runs. Only the default strips them.
 * @param schema - The schema
 */
function hasCatchall(schema: z.ZodType): boolean {
  return schema instanceof z.ZodObject && schema.def.catchall !== undefined;
}

/**
 * Whether the legacy table refuses this binding to a token holding every scope. Those are the
 * always-blocked rules, which skip the table on a registry route and so must become a flag.
 * @param binding - The binding
 * @param binding.method - Its method
 * @param binding.path - Its path
 */
function alwaysBlocked(binding: NonNullable<ActionDef['rest']>): boolean {
  const concrete = binding.path.replace(/:[^/]+/g, 'probe');
  return !tokenAllows(TOKEN_SCOPES, binding.method, normalizeApiPath(concrete));
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

  if (def.rest && !def.uiOnly && !def.tokenBlocked && alwaysBlocked(def.rest)) {
    violations.push(
      `${def.name}: tokenAllows refuses ${def.rest.method} ${def.rest.path} to every token, ` +
        'so it needs uiOnly or tokenBlocked (R7, R9)',
    );
  }

  if (def.rest && !def.target) {
    const params = paramsOf(def.rest.path);
    const beyondParams =
      !inputFields ||
      hasCatchall(def.input) ||
      Object.keys(inputFields).some((field) => !params.includes(field));
    if (beyondParams) {
      violations.push(`${def.name}: an input beyond the path params needs a target (R10, R11)`);
    }
  }

  for (const [field, schema] of Object.entries(inputFields ?? {})) {
    if (isUntyped(schema)) {
      violations.push(`${def.name}: input.${field} is z.unknown() or z.any(); type it (R16)`);
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

/**
 * Whether a field accepts any JSON, however it is wrapped in optional, nullable or default.
 * @param schema - The field's schema
 */
function isUntyped(schema: z.ZodType): boolean {
  let current: z.ZodType = schema;
  for (;;) {
    const type = current._zod.def.type;
    if (type === 'unknown' || type === 'any') return true;
    if (type === 'optional' || type === 'nullable' || type === 'default') {
      current = (current as z.ZodOptional).unwrap() as z.ZodType;
    } else {
      return false;
    }
  }
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

  it('finds every actions file imported by the app', () => {
    const root = path.resolve(__dirname, '..');
    const entry = readFileSync(path.join(root, 'index.ts'), 'utf8');
    expect(filesNotImported(findActionFiles(root), root, entry)).toEqual([]);
  });

  describe('token reach', () => {
    // Every binding is compared with what tokenAllows gave its route, for each single scope.
    // Intended differences keep their rows, with a weaker comparison:
    // - uiOnly and tokenBlocked: refused to every token, whatever tokenAllows let through
    // - R1: attachment actions need the parent's area scope as well, so they may reach less,
    //   never more
    const isRefused = (def: ActionDef): boolean => !!def.uiOnly || !!def.tokenBlocked;
    const isAttachment = (def: ActionDef): boolean => def.name.startsWith('attachment.');

    // Read when the tests run: the actions files load in beforeAll
    const tableRows = () =>
      listActions()
        .filter((def) => def.rest)
        .flatMap((def) => TOKEN_SCOPES.map((scope) => ({ def, scope })));

    it('has rows to compare', () => {
      expect(tableRows().length).toBeGreaterThan(0);
    });

    it('gives each single scope the reach tokenAllows gave the route', () => {
      const differences = tableRows().flatMap(({ def, scope }) => {
        const { method, path: pattern } = def.rest!;
        const concrete = pattern.replace(/:[A-Za-z]+/g, 'x');
        const before = tokenAllows([scope], method, concrete);
        // What the registry lets this scope do: nothing for a refused action
        const after = !isRefused(def) && scopeAllows([scope], def.area, def.kind);
        const fine = isRefused(def)
          ? !after
          : isAttachment(def)
            ? !after || before
            : before === after;
        return fine ? [] : [`${def.name} with ${scope}: was ${before}, is ${after}`];
      });
      expect(differences).toEqual([]);
    });
  });

  describe('R16: typed inputs', () => {
    it.each([
      ['z.unknown()', z.unknown()],
      ['z.any()', z.any()],
      ['an optional z.unknown()', z.unknown().optional()],
    ])('fails on a field that is %s', (_label, schema) => {
      const action = defineAction({
        ...throwaway,
        name: 'throwaway.untyped',
        area: 'issues',
        kind: 'read',
        input: z.object({ filter: schema }),
      });
      expect(ruleViolations(action)).toEqual([expect.stringContaining('R16')]);
    });

    it('passes on a typed field', () => {
      const action = defineAction({
        ...throwaway,
        name: 'throwaway.typed',
        area: 'issues',
        kind: 'read',
        input: z.object({ filter: z.string().optional() }),
      });
      expect(ruleViolations(action)).toEqual([]);
    });
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

    it.each([
      ['PATCH', '/api/projects/:projectId'],
      ['DELETE', '/api/projects/:projectId'],
      ['PUT', '/api/wiki/pages/:pageId/restrictions'],
      ['GET', '/api/admin/users'],
      ['PATCH', '/api/users/me'],
    ] as const)('fails on %s %s in an open area, which tokenAllows always blocks', (method, p) => {
      const params = Object.fromEntries(paramsOf(p).map((name) => [name, z.string()]));
      const base = {
        ...throwaway,
        name: 'throwaway.blockedPath',
        area: 'issues' as const,
        kind: 'write' as const,
        input: z.object(params),
        rest: { method, path: p },
      };
      expect(ruleViolations(defineAction(base))).toEqual([expect.stringContaining('R7, R9')]);
      expect(ruleViolations(defineAction({ ...base, tokenBlocked: true }))).toEqual([]);
      expect(ruleViolations(defineAction({ ...base, uiOnly: true }))).toEqual([]);
    });
  });

  describe('R10, R11: a binding with more than path params declares a target', () => {
    const bound = {
      ...throwaway,
      name: 'throwaway.bound',
      area: 'issues' as const,
      kind: 'write' as const,
      rest: { method: 'POST' as const, path: '/api/wiki/x/:projectId' },
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

    it.each([
      ['loose', z.looseObject({ projectId: z.string() })],
      ['strict', z.strictObject({ projectId: z.string() })],
    ])('fails on a %s input of only path params, which takes or refuses more', (_name, input) => {
      expect(ruleViolations(defineAction({ ...bound, input }))).toEqual([
        expect.stringContaining('needs a target'),
      ]);
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
    const registers = 'const registerActions = (_: unknown[]) => {};\nregisterActions([]);\n';
    let root: string;

    beforeAll(() => {
      root = mkdtempSync(path.join(tmpdir(), 'registry-rules-'));
      mkdirSync(path.join(root, 'deep', 'er'), { recursive: true });
      mkdirSync(path.join(root, 'empty'));
      mkdirSync(path.join(root, 'node_modules'));
      writeFileSync(path.join(root, 'deep', 'er', 'a.actions.ts'), registers);
      writeFileSync(
        path.join(root, 'deep', 'b.actions.ts'),
        `import './er/a.actions';\n${registers}`,
      );
      writeFileSync(path.join(root, 'deep', 'a.actions.test.ts'), '');
      writeFileSync(path.join(root, 'deep', 'a.routes.ts'), '');
      writeFileSync(path.join(root, 'empty', 'c.actions.ts'), 'export const c = 1;\n');
      writeFileSync(path.join(root, 'node_modules', 'd.actions.ts'), '');
      return () => rmSync(root, { recursive: true });
    });

    it('finds every actions file at any depth, and no others', () => {
      expect(findActionFiles(path.join(root, 'deep')).sort()).toEqual([
        path.join(root, 'deep', 'b.actions.ts'),
        path.join(root, 'deep', 'er', 'a.actions.ts'),
      ]);
      expect(findActionFiles(root)).not.toContain(path.join(root, 'node_modules', 'd.actions.ts'));
    });

    it('accepts an actions file that imports another, in either order', async () => {
      const deep = path.join(root, 'deep');
      const [a, b] = [path.join(deep, 'er', 'a.actions.ts'), path.join(deep, 'b.actions.ts')];
      await expect(loadActionFiles([b, a])).resolves.toBeUndefined();
    });

    it('fails on an actions file that registers nothing', async () => {
      await expect(loadActionFiles(findActionFiles(path.join(root, 'empty')))).rejects.toThrow(
        'registered no actions',
      );
    });

    it('fails on an actions file the entry file does not import', () => {
      const files = ['/src/modules/a/a.actions.ts', '/src/modules/b/b.actions.ts'];
      const entry = "import './modules/a/a.actions';\n";
      expect(filesNotImported(files, '/src', entry)).toEqual(['/src/modules/b/b.actions.ts']);
    });
  });
});
