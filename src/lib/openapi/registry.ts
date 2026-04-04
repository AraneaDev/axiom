import { createDocument, type ZodOpenApiObject, type ZodOpenApiPathsObject } from 'zod-openapi';

const registeredPaths: ZodOpenApiPathsObject = {};

/**
 * Register one or more path definitions into the global OpenAPI registry.
 * Call this from each module's routes file to contribute endpoints.
 * @param paths
 */
export function registerPaths(paths: ZodOpenApiPathsObject): void {
  Object.assign(registeredPaths, paths);
}

/**
 * Build and return the complete OpenAPI 3.1 document from all registered paths.
 */
export function createOpenAPISpec(): ReturnType<typeof createDocument> {
  const doc: ZodOpenApiObject = {
    openapi: '3.1.0',
    info: {
      title: 'Axiom API',
      version: '1.0.0',
      description: 'REST API for the Axiom project management platform',
    },
    servers: [
      {
        url: '/api',
        description: 'API base path',
      },
    ],
    paths: registeredPaths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };

  return createDocument(doc);
}

/**
 * Reset registered paths — used in tests to ensure isolation.
 */
export function _resetPaths(): void {
  for (const key of Object.keys(registeredPaths)) {
    delete registeredPaths[key];
  }
}
