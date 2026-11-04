import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

/** The document's `components.schemas`, which hoisted definitions are added to. */
export interface SchemaStore {
  schemas: Record<string, JsonSchema>;
}

/**
 * A name a component can have: letters, digits and `.`, `_`, `-`.
 * @param name - Any name
 */
function componentName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Point every `#/$defs/...` reference at the component the definition moved to.
 * @param node - A schema, or part of one
 * @param names - The new name of each definition
 */
function rewriteRefs(node: unknown, names: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item, names);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string') {
      const target = value.startsWith('#/$defs/')
        ? names.get(value.slice('#/$defs/'.length))
        : undefined;
      if (target === undefined) throw new Error(`Unsupported schema reference ${value}`);
      record[key] = `#/components/schemas/${target}`;
    } else {
      rewriteRefs(value, names);
    }
  }
}

/**
 * The JSON Schema of a Zod schema, for an OpenAPI 3.1 document.
 * - A `.catch(x)` field accepts anything and hands x on, so the default it would publish is not
 *   something a caller may rely on: it stays required, without the default.
 * - Shared definitions (`$defs`) move into the document's components, as a reference inside a
 *   schema would resolve against the document and not against the schema.
 * @param schema - The Zod schema
 * @param io - 'input' for what a caller sends, 'output' for what comes back
 * @param owner - Names the components the schema brings along, e.g. 'item.read.output'
 * @param store - The document's components
 * @throws {Error} When the schema can't be represented
 */
export function jsonSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
  owner: string,
  store: SchemaStore,
): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'catch') delete ctx.jsonSchema.default;
    },
  }) as JsonSchema;
  delete json.$schema;

  const defs = (json.$defs ?? {}) as Record<string, JsonSchema>;
  delete json.$defs;
  const names = new Map(
    Object.keys(defs).map((key) => [key, componentName(`${owner}.${key}`)] as const),
  );
  rewriteRefs(json, names);
  for (const [key, def] of Object.entries(defs)) {
    rewriteRefs(def, names);
    store.schemas[names.get(key) as string] = def;
  }
  return json;
}
