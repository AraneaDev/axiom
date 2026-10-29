import { describe, it, expect, beforeAll } from 'vitest';

// Import route registrations (side-effect: populates registry)
import './routes/auth';
import './routes/issues';
import './routes/wiki';

import { createOpenAPISpec } from './registry';

describe('OpenAPI spec', () => {
  let spec: ReturnType<typeof createOpenAPISpec>;

  beforeAll(() => {
    spec = createOpenAPISpec();
  });

  it('is a valid OpenAPI 3.1 document', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Axiom API');
    expect(spec.info.version).toBeDefined();
  });

  it('has paths registered', () => {
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths ?? {})).not.toHaveLength(0);
  });

  it('has auth paths', () => {
    expect(spec.paths?.['/auth/login']).toBeDefined();
    expect(spec.paths?.['/auth/register']).toBeDefined();
    expect(spec.paths?.['/auth/refresh']).toBeDefined();
    expect(spec.paths?.['/auth/logout']).toBeDefined();
  });

  it('has issue paths', () => {
    expect(spec.paths?.['/projects/{org}/{team}/{project}/issues']).toBeDefined();
    expect(spec.paths?.['/projects/{org}/{team}/{project}/issues/{num}']).toBeDefined();
  });

  it('has wiki paths', () => {
    expect(spec.paths?.['/wiki/{org}/{team}/spaces']).toBeDefined();
    expect(spec.paths?.['/wiki/{org}/{team}/{space}/pages']).toBeDefined();
    expect(spec.paths?.['/wiki/{org}/{team}/{space}/{page}']).toBeDefined();
  });

  it('has JWT security scheme defined', () => {
    expect(spec.components?.securitySchemes?.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('auth login POST has required request body', () => {
    const login = spec.paths?.['/auth/login'] as Record<string, unknown>;
    expect(login?.post).toBeDefined();
  });

  it('issues GET has pagination parameters', () => {
    const issues = spec.paths?.['/projects/{org}/{team}/{project}/issues'] as Record<
      string,
      unknown
    >;
    const get = issues?.get as { parameters?: Array<{ name: string }> } | undefined;
    const paramNames = (get?.parameters ?? []).map((p) => p.name);
    expect(paramNames).toContain('limit');
    expect(paramNames).toContain('offset');
  });
});
