import { describe, it, expect, beforeEach } from 'vitest';

import { _resetPaths, createOpenAPISpec, registerPaths } from './registry';

describe('OpenAPI registry', () => {
  beforeEach(() => {
    _resetPaths();
  });

  it('produces a valid OpenAPI 3.1 document structure', () => {
    const spec = createOpenAPISpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Axiom API');
    expect(spec.info.version).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it('includes registered paths', () => {
    registerPaths({
      '/auth/login': {
        post: {
          summary: 'Login',
          responses: { '200': { description: 'OK' } },
        },
      },
    });

    const spec = createOpenAPISpec();
    expect(spec.paths?.['/auth/login']).toBeDefined();
  });

  it('merges multiple registrations', () => {
    registerPaths({
      '/auth/login': {
        post: { summary: 'Login', responses: { '200': { description: 'OK' } } },
      },
    });
    registerPaths({
      '/auth/register': {
        post: { summary: 'Register', responses: { '201': { description: 'Created' } } },
      },
    });

    const spec = createOpenAPISpec();
    expect(spec.paths?.['/auth/login']).toBeDefined();
    expect(spec.paths?.['/auth/register']).toBeDefined();
  });

  it('includes security scheme for JWT', () => {
    const spec = createOpenAPISpec();
    expect(spec.components?.securitySchemes?.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('resets paths between tests', () => {
    registerPaths({
      '/test': { get: { summary: 'Test', responses: { '200': { description: 'OK' } } } },
    });
    _resetPaths();
    const spec = createOpenAPISpec();
    expect(Object.keys(spec.paths ?? {})).toHaveLength(0);
  });
});
