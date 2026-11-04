import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import type { Express } from 'express';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { LEGACY_ROUTES, type LegacyRoute } from './legacy-routes';
import { listActions } from './registry';

const ROOT = path.resolve(__dirname, '../..');
const FRONTEND_SRC = path.join(ROOT, 'frontend/src');
const CLIENT_FILE = 'frontend/src/api/client.ts';

/** Stands in for a template expression while a path is being read */
const PARAM_MARK = '\uE000';
/** Stands in for an expression that is visibly a query string */
const QUERY_MARK = '\uE001';

/** Calls that take a path relative to /api, with the method they default to */
const RELATIVE_CALLS: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  patch: 'PATCH',
  put: 'PUT',
  del: 'DELETE',
  api: 'GET',
  apiFormData: 'POST',
};
/** Calls that take the whole path */
const ABSOLUTE_CALLS = new Set(['fetchWithAuth', 'getBlob', 'fetch']);

/** Registry routes that are not action bindings: /api/read is item.read's own binding */
const EXTRA_REGISTRY_ROUTES = [{ method: 'POST', path: '/api/act' }];

/**
 * Calls whose path the scan can't read, each with the reason it is safe to skip. The path of
 * each reaches the call through a variable, and is built from an /api literal that is scanned on
 * its own. Matched by file and the exact argument text, so a moved line keeps its entry and a new
 * unreadable call in the same file does not hide behind it.
 */
const UNREADABLE_ALLOWED: Array<{ file: string; arg: string; reason: string }> = [
  ...['`${API_BASE}${path}`', 'path', 'url'].map((arg) => ({
    file: CLIENT_FILE,
    arg,
    reason:
      'Defines the helpers. Every path they carry arrives as a parameter from a call scanned elsewhere',
  })),
  ...['src', 'url'].map((arg) => ({
    file: 'frontend/src/components/ui/AttachmentList.tsx',
    arg,
    reason:
      'The urls come from attachmentsApi.getDownloadUrl and getPreviewUrl, scanned as literals',
  })),
  {
    file: 'frontend/src/components/ui/AttachmentPreview.tsx',
    arg: 'url',
    reason:
      'The urls come from attachmentsApi.getDownloadUrl and getPreviewUrl, scanned as literals',
  },
];

/**
 * Frontend calls to a route that exists nowhere, found by this test. They fail today with a 404;
 * each stays here until its route is built or its caller removed. The test below fails once
 * Express serves one, so the entry can't outlive the bug.
 */
const BROKEN_FRONTEND_CALLS: Array<{ method: string; path: string; reason: string }> = [
  {
    method: 'PATCH',
    path: '/api/projects/:projectId/roadmap/issues/:issueId/bucket',
    reason: 'Roadmap.tsx moves an issue to a bucket; the roadmap module has no such route',
  },
  {
    method: 'PATCH',
    path: '/api/projects/:projectId/roadmap/issues/:issueId/dates',
    reason: "Roadmap.tsx sets an issue's dates; the roadmap module has no such route",
  },
];

interface FrontendCall {
  method: string;
  /** Segments of the path with every expression as ':param', without the query */
  path: string;
  where: string;
}

interface UnreadableCall {
  file: string;
  arg: string;
  where: string;
}

/**
 * Source files of the frontend, tests excluded.
 * @param dir - The directory to walk
 */
function frontendFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
    .filter((file) => !file.split(path.sep).includes('node_modules'))
    .sort()
    .map((file) => path.join(dir, file));
}

/**
 * The top-level `const NAME = 'text'` strings of a file, which paths are built from.
 * @param sf - The parsed file
 */
function stringConstants(sf: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        (ts.isStringLiteral(decl.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(decl.initializer))
      ) {
        constants.set(decl.name.text, decl.initializer.text);
      }
    }
  }
  return constants;
}

/**
 * The text a string-like expression builds, with every expression it can't read as PARAM_MARK.
 * Undefined when the node is not string-like at all (a variable, a call).
 * @param node - The expression
 * @param constants - The file's string constants
 */
function pathText(node: ts.Expression, constants: Map<string, string>): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return pathText(node.expression, constants);
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      text += expressionText(span.expression, constants) + span.literal.text;
    }
    return text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = pathText(node.left, constants);
    const right = pathText(node.right, constants);
    if (left === undefined && right === undefined) return undefined;
    return (left ?? PARAM_MARK) + (right ?? PARAM_MARK);
  }
  return undefined;
}

/**
 * An expression inside a template: a known string constant, else a parameter.
 * @param node - The expression
 * @param constants - The file's string constants
 */
function expressionText(node: ts.Expression, constants: Map<string, string>): string {
  if (ts.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text)!;
  if (isQueryString(node, constants)) return QUERY_MARK;
  return pathText(node, constants) ?? PARAM_MARK;
}

/**
 * Whether an expression is visibly a query string: a `cond ? `?${x}` : ''`, or a variable or call
 * named for one (`query`, `qs`, `buildQuery(filters)`). Anything else glued to a path is unknown.
 * @param node - The expression
 * @param constants - The file's string constants
 */
function isQueryString(node: ts.Expression, constants: Map<string, string>): boolean {
  if (ts.isConditionalExpression(node)) {
    return (pathText(node.whenTrue, constants) ?? '').startsWith('?');
  }
  const named = ts.isCallExpression(node) ? node.expression : node;
  return ts.isIdentifier(named) && /^(q|qs|query|querystring|buildquery)$/i.test(named.text);
}

/**
 * The segments of a path read from source, as ':param' where an expression stands, without the
 * query string. Undefined when the path doesn't start with a literal slash, or ends in an unknown
 * expression glued to a literal.
 * @param text - The text from pathText
 */
function normalizePath(text: string): string | undefined {
  // A query string ends the path, whatever follows it
  const withoutQuery = text.split(QUERY_MARK)[0].split('?')[0].split('#')[0];
  // `/x${y}`: an unknown expression glued to a literal could be a segment or a query
  if (/[^/\uE000]\uE000+$/.test(withoutQuery)) return undefined;
  if (!withoutQuery.startsWith('/') || withoutQuery.startsWith(`/${PARAM_MARK}`)) return undefined;
  const segments = withoutQuery
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.includes(PARAM_MARK) ? ':param' : segment));
  // `${API_BASE}${path}`: nothing but the prefix is known
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'api')) return undefined;
  return `/${segments.join('/')}`;
}

/**
 * The method an options object sets, GET-like default when it sets none.
 * @param init - The call's options argument
 * @param fallback - The method with no option
 * @returns Undefined when the options are not a literal that names the method readably
 */
function methodOf(init: ts.Expression | undefined, fallback: string): string | undefined {
  if (!init) return fallback;
  if (!ts.isObjectLiteralExpression(init)) return undefined;
  for (const prop of init.properties) {
    if (ts.isSpreadAssignment(prop)) return undefined;
    const name =
      prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ? prop.name.text
        : undefined;
    // A computed key or a method named otherwise can't be told apart from `method`
    if (prop.name && ts.isComputedPropertyName(prop.name)) return undefined;
    if (name === 'method') {
      return ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)
        ? prop.initializer.text.toUpperCase()
        : undefined;
    }
  }
  return fallback;
}

/**
 * The method a call makes. get, post and the like fix it; api takes it from its options,
 * apiFormData from its third argument, and the fetch calls from their init.
 * @param callee - The function called
 * @param second - The call's second argument
 * @param third - The call's third argument
 * @returns Undefined when the method is not a literal the scan can read
 */
function methodOfCall(
  callee: string,
  second: ts.Expression | undefined,
  third: ts.Expression | undefined,
): string | undefined {
  if (callee === 'api') return methodOf(second, 'GET');
  if (callee === 'apiFormData') {
    if (!third) return 'POST';
    return ts.isStringLiteral(third) ? third.text.toUpperCase() : undefined;
  }
  if (Object.hasOwn(RELATIVE_CALLS, callee)) return RELATIVE_CALLS[callee];
  return methodOf(second, 'GET');
}

/**
 * What a file imports from api/client, by local name, so a local function called `post` is not
 * mistaken for the helper and an aliased import is still read.
 * @param sf - The parsed file
 */
function clientImports(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /(^|\/)client$/.test(statement.moduleSpecifier.text) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        names.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

/**
 * Whether a literal names a module (`import x from '@/api/client'`, `import('@/api/x')`), which
 * is not a url.
 * @param node - The literal
 */
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isLiteralTypeNode(parent) ||
    (ts.isCallExpression(parent) &&
      (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
        /^(mock|doMock|importActual)$/.test(
          ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name.text : '',
        )))
  );
}

/**
 * Every request path the frontend source holds: the calls to the client helpers, `fetch`, and any
 * other /api literal (urls handed to fetchWithAuth through a variable, image sources).
 * @returns The calls it could read, and the calls whose path it could not
 */
function scanFrontend(): { calls: FrontendCall[]; unreadable: UnreadableCall[] } {
  const calls: FrontendCall[] = [];
  const unreadable: UnreadableCall[] = [];

  for (const file of frontendFiles(FRONTEND_SRC)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const constants = stringConstants(sf);
    const imported = clientImports(sf);
    const inCalls = new Set<ts.Node>();
    const where = (node: ts.Node) =>
      `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const local = node.expression.text;
        // An aliased import (`get as fetchJson`) is the helper it names
        const callee = imported.get(local) ?? local;
        const relative = Object.hasOwn(RELATIVE_CALLS, callee);
        const absolute = ABSOLUTE_CALLS.has(callee);
        // fetch is global; the helpers count only where they come from api/client
        const ours =
          (relative || absolute) &&
          (local === 'fetch' || imported.has(local) || rel === CLIENT_FILE);
        if (ours && node.arguments[0]) {
          const [first, second, third] = node.arguments;
          inCalls.add(first);
          const text = pathText(first, constants);
          const normalized = text === undefined ? undefined : normalizePath(text);
          const method = methodOfCall(callee, second, third);
          if (normalized === undefined || method === undefined) {
            unreadable.push({ file: rel, arg: first.getText(), where: where(node) });
          } else {
            calls.push({
              method,
              path: relative ? `/api${normalized}` : normalized,
              where: where(node),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    // Any other /api literal is a url some code will fetch with GET
    const visitLiterals = (node: ts.Node) => {
      const isString =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node);
      if (isString && !inCalls.has(node) && !isModuleSpecifier(node)) {
        const text = pathText(node as ts.Expression, constants);
        const normalized = text === undefined ? undefined : normalizePath(text);
        if (normalized?.startsWith('/api/')) {
          calls.push({ method: 'GET', path: normalized, where: where(node) });
        } else if (text !== undefined && text.includes('/api/')) {
          // An /api url behind an unknown prefix (`${origin}/api/x`) or suffix
          unreadable.push({ file: rel, arg: node.getText(), where: where(node) });
        }
        if (isString && ts.isTemplateExpression(node)) return;
      }
      ts.forEachChild(node, visitLiterals);
    };
    visitLiterals(sf);
  }
  return { calls, unreadable };
}

/**
 * Whether a request path reaches a route.
 * A param in the request path matches only a param in the route, and a literal only the same
 * literal: the frontend writes ids as expressions, so `/issues/stats` is not `/issues/:number`.
 * @param request - The request's segments
 * @param route - The route's segments
 */
function segmentsMatch(request: string[], route: string[]): boolean {
  return (
    request.length === route.length &&
    request.every((segment, i) =>
      segment === ':param'
        ? route[i].startsWith(':')
        : segment.toLowerCase() === route[i].toLowerCase(),
    )
  );
}

/**
 * Whether any route in a list serves a request.
 * @param routes - Method and Express path
 * @param method - The request's method
 * @param requestPath - The request's path, expressions as ':param'
 */
function served(
  routes: Array<{ method: string; path: string }>,
  method: string,
  requestPath: string,
): boolean {
  const request = requestPath.split('/').filter(Boolean);
  return routes.some(
    (route) =>
      route.method === method && segmentsMatch(request, route.path.split('/').filter(Boolean)),
  );
}

/**
 * A legacy route as the request path a frontend call would make.
 * @param route - The legacy route
 */
function asRequestPath(route: LegacyRoute): string {
  return route.path.replace(/:[a-zA-Z_]+/g, ':param');
}

/** The registry's routes: every action binding, and the by-name endpoint */
function registryRoutes(): Array<{ method: string; path: string }> {
  const bindings = listActions().flatMap((action) => (action.rest ? [action.rest] : []));
  return [...bindings, ...EXTRA_REGISTRY_ROUTES];
}

/** The parts of Express's router internals the walk below reads */
interface RouterLayer {
  route?: { _handlesMethod(method: string): boolean };
  handle: { stack?: RouterLayer[] };
  path?: string;
  match(path: string): boolean;
}

/**
 * Whether the router stack has a route for a request. Mount layers match a prefix, so the walk
 * strips what they matched and goes into the router they mount.
 * @param stack - A router's layers
 * @param method - The request's method
 * @param requestPath - A concrete path
 */
function stackServes(stack: RouterLayer[], method: string, requestPath: string): boolean {
  return stack.some((layer) => {
    if (layer.route) return layer.match(requestPath) && layer.route._handlesMethod(method);
    if (!layer.handle.stack || !layer.match(requestPath)) return false;
    const rest = requestPath.slice(layer.path?.length ?? 0) || '/';
    return stackServes(layer.handle.stack, method, rest);
  });
}

/**
 * Domains the registry owns after plan 1, so that no legacy route may sit in them. A legacy
 * route in a domain needs an exemption below, with the reason.
 */
const MIGRATED_DOMAINS: Array<{ domain: string; matches(route: LegacyRoute): boolean }> = [
  { domain: 'issue', matches: (r) => /^\/api\/projects\/:\w+\/issues(\/|$)/.test(r.path) },
  { domain: 'comment', matches: (r) => /^\/api\/projects\/:\w+\/comments(\/|$)/.test(r.path) },
  {
    domain: 'worklog',
    matches: (r) => /^\/api\/projects\/:\w+\/(issues\/:\w+\/worklogs|time-report)/.test(r.path),
  },
  {
    domain: 'link',
    matches: (r) => /^\/api\/projects\/:\w+\/issues\/:\w+\/(web-)?links/.test(r.path),
  },
  { domain: 'attachment', matches: (r) => /^\/api\/attachments(\/|$)/.test(r.path) },
  {
    domain: 'page',
    matches: (r) =>
      /^\/api\/wiki\/spaces\/:\w+\/pages(\/|$)/.test(r.path) ||
      /^\/api\/wiki\/pages\/:\w+\/(copy|move|reorder|linked-issues)/.test(r.path),
  },
  {
    domain: 'sprint',
    matches: (r) => /^\/api\/projects\/:\w+\/(sprints|backlog|velocity)(\/|$)/.test(r.path),
  },
  {
    domain: 'org, team or project read',
    matches: (r) =>
      r.method === 'GET' &&
      /^\/api\/(orgs|orgs\/:\w+|teams\/:\w+|teams\/org\/:\w+|projects\/:\w+|projects\/team\/:\w+)$/.test(
        r.path,
      ),
  },
  {
    domain: 'space read',
    matches: (r) =>
      r.method === 'GET' && /^\/api\/wiki\/(spaces\/:\w+|team\/:\w+\/spaces)$/.test(r.path),
  },
];

/**
 * Legacy routes that a domain's pattern catches by name but plan 1 does not migrate. Each names
 * the plan task that takes it, in .superpowers' plans/2026-10-30-agent-layer-<plan>-*.md.
 */
const DOMAIN_EXEMPTIONS: Array<{
  method: string;
  path: string;
  plan: 3 | 4;
  task: string;
  reason: string;
}> = [
  {
    method: 'GET',
    path: '/api/projects/:projectId/issues/:issueNumber/activity',
    plan: 4,
    task: 'plan 4, Task 4 (people and notifications: activity)',
    reason: 'The activity feed belongs to the activity module, not to the issue actions',
  },
  {
    method: 'GET',
    path: '/api/wiki/spaces/:spaceId/pages/:pageSlug/export',
    plan: 4,
    task: 'plan 4, Task 2 (wiki rest: export)',
    reason: 'Page export is a raw download, which plan 4 gives its own handling',
  },
];

describe('frontend and registry parity', () => {
  let scan: ReturnType<typeof scanFrontend>;
  let app: Express;

  beforeAll(async () => {
    // Importing the app registers every actions file, as it does at startup
    app = (await import('../index')).default;
    scan = scanFrontend();
  });

  it('finds the frontend calls at all', () => {
    expect(scan.calls.length).toBeGreaterThan(100);
  });

  it('reads the path of every frontend call, or names it in the allowlist', () => {
    const unexplained = scan.unreadable.filter(
      (call) =>
        !UNREADABLE_ALLOWED.some(
          (allowed) => allowed.file === call.file && allowed.arg === call.arg,
        ),
    );
    expect(unexplained.map((call) => `${call.where}  ${call.arg}`)).toEqual([]);
  });

  it('has no allowlist entry that nothing needs', () => {
    const unused = UNREADABLE_ALLOWED.filter(
      (allowed) =>
        !scan.unreadable.some((call) => allowed.file === call.file && allowed.arg === call.arg),
    );
    expect(unused.map((allowed) => allowed.file)).toEqual([]);
  });

  it('serves every frontend call from the registry or a tracked legacy route', () => {
    const registry = registryRoutes();
    const legacy = LEGACY_ROUTES.map((route) => ({ method: route.method, path: route.path }));
    const broken = BROKEN_FRONTEND_CALLS.map(({ method, path }) => ({ method, path }));
    const unmatched = scan.calls
      .filter(
        (call) =>
          !served(registry, call.method, call.path) &&
          !served(legacy, call.method, call.path) &&
          !served(broken, call.method, call.path),
      )
      .map((call) => `${call.method} ${call.path}  (${call.where})`);
    expect([...new Set(unmatched)].sort()).toEqual([]);
  });

  it('lists no legacy route that a registry route serves', () => {
    const registry = registryRoutes();
    const stale = LEGACY_ROUTES.filter((route) =>
      served(registry, route.method, asRequestPath(route)),
    );
    expect(stale.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('lists no legacy route twice', () => {
    const keys = LEGACY_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
  });

  it('lists no legacy route that no frontend call reaches', () => {
    const unused = LEGACY_ROUTES.filter(
      (route) =>
        !scan.calls.some((call) =>
          served([{ method: route.method, path: route.path }], call.method, call.path),
        ),
    );
    expect(unused.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('lists only routes that exist in Express', () => {
    const stack = (app.router as unknown as { stack: RouterLayer[] }).stack;
    const missing = LEGACY_ROUTES.filter(
      (route) => !stackServes(stack, route.method, route.path.replace(/:[a-zA-Z_]+/g, 'x')),
    );
    expect(missing.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('reaches an Express route with every frontend call', () => {
    const stack = (app.router as unknown as { stack: RouterLayer[] }).stack;
    const broken = BROKEN_FRONTEND_CALLS.map(({ method, path }) => ({ method, path }));
    const lost = scan.calls
      .filter((call) => !served(broken, call.method, call.path))
      .filter((call) => !stackServes(stack, call.method, call.path.replace(/:param/g, 'x')))
      .map((call) => `${call.method} ${call.path}  (${call.where})`);
    expect([...new Set(lost)].sort()).toEqual([]);
  });

  it('checks each domain exemption against its plan', () => {
    const wrong = DOMAIN_EXEMPTIONS.filter((entry) => {
      const route = LEGACY_ROUTES.find((r) => r.method === entry.method && r.path === entry.path);
      return route?.plan !== entry.plan || !entry.task.includes(`plan ${entry.plan}`);
    });
    expect(wrong.map((entry) => `${entry.method} ${entry.path}`)).toEqual([]);
  });

  it('lists a broken frontend call only while no route serves it', () => {
    const stack = (app.router as unknown as { stack: RouterLayer[] }).stack;
    const nowServed = BROKEN_FRONTEND_CALLS.filter((call) =>
      stackServes(stack, call.method, call.path.replace(/:[a-zA-Z_]+/g, 'x')),
    );
    expect(nowServed.map((call) => `${call.method} ${call.path}`)).toEqual([]);
    const called = BROKEN_FRONTEND_CALLS.filter(
      (call) =>
        !scan.calls.some(
          (found) =>
            found.method === call.method &&
            found.path === call.path.replace(/:[a-zA-Z_]+/g, ':param'),
        ),
    );
    expect(called.map((call) => `${call.method} ${call.path}`)).toEqual([]);
  });

  it('tags every legacy route with the plan that migrates it', () => {
    expect(LEGACY_ROUTES.filter((route) => route.plan !== 3 && route.plan !== 4)).toEqual([]);
  });

  it('keeps issue, comment, worklog, link, attachment, page, sprint and org, team, project reads out of the list', () => {
    const exempt = (route: LegacyRoute) =>
      DOMAIN_EXEMPTIONS.some((entry) => entry.method === route.method && entry.path === route.path);
    const strays = LEGACY_ROUTES.flatMap((route) =>
      MIGRATED_DOMAINS.filter((d) => d.matches(route) && !exempt(route)).map(
        (d) => `${d.domain}: ${route.method} ${route.path}`,
      ),
    );
    expect(strays).toEqual([]);
  });

  it('has no domain exemption that names a route outside the list', () => {
    const listed = new Set(LEGACY_ROUTES.map((route) => `${route.method} ${route.path}`));
    expect(
      DOMAIN_EXEMPTIONS.filter((entry) => !listed.has(`${entry.method} ${entry.path}`)),
    ).toEqual([]);
  });
});
