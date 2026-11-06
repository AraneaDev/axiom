import { sign } from 'node:crypto';

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * The JWT a GitHub App authenticates as itself with (RS256). `iat` sits a minute in the past
 * to absorb clock drift, and `exp` nine minutes ahead, inside GitHub's ten minute limit.
 * @param appId The App's numeric id, the issuer
 * @param privateKeyPem The App's private key as GitHub hands it out (PEM)
 * @param now The signing time, for tests
 */
export function appJwt(appId: number, privateKeyPem: string, now: Date = new Date()): string {
  const seconds = Math.floor(now.getTime() / 1000);
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iat: seconds - 60,
    exp: seconds + 9 * 60,
    iss: appId,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), privateKeyPem).toString('base64url');
  return `${unsigned}.${signature}`;
}
