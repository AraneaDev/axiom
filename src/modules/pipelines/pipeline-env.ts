/**
 * System env vars safe to expose to pipeline steps.
 * Everything else (DATABASE_URL, JWT_SECRET, REDIS_URL, etc.) is stripped.
 */
const ALLOWED_SYSTEM_VARS = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'HOSTNAME',
  'TZ',
  'TMPDIR',
  'NODE_ENV',
]);

/**
 * Build a safe environment for pipeline step execution.
 * Only allowlisted system vars + AXIOM_* context vars + step-defined vars are included.
 * @param processEnv
 * @param contextEnv
 * @param stepEnv
 */
export function buildSafeEnv(
  processEnv: Record<string, string | undefined>,
  contextEnv: Record<string, string>,
  stepEnv: Record<string, string>,
): Record<string, string> {
  const safe: Record<string, string> = {};

  // Only allowlisted system env vars
  for (const key of ALLOWED_SYSTEM_VARS) {
    if (processEnv[key]) safe[key] = processEnv[key]!;
  }

  // All context vars (AXIOM_COMMIT_SHA, AXIOM_BRANCH, etc.)
  Object.assign(safe, contextEnv);

  // Step-defined vars (from pipeline YAML)
  Object.assign(safe, stepEnv);

  return safe;
}
