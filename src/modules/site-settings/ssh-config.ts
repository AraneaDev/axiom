export interface SshCloneConfig {
  enabled: boolean;
  host: string | null;
  port: number;
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * SSH clone settings shown to users. Read from the environment, never stored.
 * @param env - Environment to read (defaults to process.env)
 * @returns Whether SSH is offered, and the host and port for clone URLs
 */
export function getSshCloneConfig(env: NodeJS.ProcessEnv = process.env): SshCloneConfig {
  return {
    enabled: env.SSH_ENABLED === 'true',
    host: env.SSH_PUBLIC_HOST?.trim() || null,
    port: parsePort(env.SSH_PUBLIC_PORT) ?? parsePort(env.SSH_PORT) ?? 2222,
  };
}
