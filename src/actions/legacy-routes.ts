/**
 * Every route the frontend still calls that is not a registry action yet, each tagged with the
 * plan that migrates it. parity.test.ts keeps this list honest: a frontend call that is neither
 * a registry route nor listed here fails, and so does an entry that a registry route now serves.
 * Plan 4 ends with this list empty.
 */
export interface LegacyRoute {
  method: string;
  /** The Express path, with the /api prefix */
  path: string;
  plan: 3 | 4;
}

/** Plan 4 migrates what is left; plan 3 brought the admin reach of tokens behind approval. */
export const LEGACY_ROUTES: LegacyRoute[] = [];
