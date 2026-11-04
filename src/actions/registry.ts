import type { ActionDef } from './define';

const actions = new Map<string, ActionDef>();

/**
 * Add actions to the registry. A name can be registered once: replacing an action would
 * silently replace its authorization too.
 * @param defs - The actions
 * @throws {Error} When a name is already registered
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerActions(defs: ActionDef<any, any, any>[]): void {
  for (const def of defs) {
    if (actions.has(def.name)) throw new Error(`Action ${def.name} is already registered`);
    actions.set(def.name, def);
  }
}

/**
 * The action with this name.
 * @param name - The dotted name
 */
export function getAction(name: string): ActionDef | undefined {
  return actions.get(name);
}

/** Every registered action, tokens' or not. */
export function listActions(): ActionDef[] {
  return [...actions.values()];
}
