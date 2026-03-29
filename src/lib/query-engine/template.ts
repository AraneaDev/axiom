import type { QueryContext } from './ast';
import { builtinFunctions } from './functions';

const DUMMY_CONTEXT: QueryContext = { currentUserId: '', projectId: '' };

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function formatValue(val: unknown): string {
  if (val == null) return '';
  if (Array.isArray(val)) return val.map(String).join(', ');
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function resolveExpression(expr: string, context: Record<string, unknown>): string {
  const trimmed = expr.trim();

  // Function call: contains parentheses
  if (trimmed.includes('(')) {
    const match = trimmed.match(/^(\w+)\((.*)\)$/);
    if (match) {
      const name = match[1].toLowerCase();
      const fn = builtinFunctions[name];
      if (fn) {
        const result = fn([], DUMMY_CONTEXT);
        return formatValue(result);
      }
    }
    return '';
  }

  // Dot-path traversal
  const val = getByPath(context, trimmed);
  return formatValue(val);
}

/**
 * Resolves {{...}} template expressions in a string using the provided context.
 * @param template
 * @param context
 */
export function resolveTemplate(template: string, context: Record<string, unknown>): string {
  if (!template) return '';
  return template.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
    return resolveExpression(expr, context);
  });
}
