import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { prisma } from '../config/database';
import { encryptSecret, secretContext } from '../lib/secret-box';
import { clearInstallationTokens } from '../modules/github/github-app.service';

import type { GithubFake } from './github-fake';

/**
 * Stores a GitHub App as the manifest flow would, with its secrets sealed, and (when given the
 * fake) tells the fake its public key. Replaces any App already stored.
 * @param opts The App's id (1201 by default) and the fake to register the key with
 * @param opts.appId
 * @param opts.fake
 * @returns The plain secrets, for tests that need to look for them
 */
export async function seedGithubApp(
  opts: { appId?: number; fake?: GithubFake } = {},
): Promise<{ privateKey: string; publicKey: string; webhookSecret: string }> {
  const appId = opts.appId ?? 1201;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const webhookSecret = `whsec_${randomBytes(12).toString('hex')}`;
  const clientSecret = `cs_${randomBytes(12).toString('hex')}`;
  const seal = (field: string, plain: string) =>
    encryptSecret(plain, secretContext('githubApp', field, '1'));
  const data = {
    appId,
    slug: 'acme-axiom',
    name: 'Axiom (axiom.acme.test)',
    htmlUrl: 'https://github.com/apps/acme-axiom',
    ownerLogin: 'acme-labs',
    clientId: 'Iv1.0a1b2c3d4e5f6a7b',
    clientSecret: seal('clientSecret', clientSecret),
    privateKey: seal('privateKey', privateKey),
    webhookSecret: seal('webhookSecret', webhookSecret),
    createdById: 'seed',
  };
  await prisma.githubApp.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  clearInstallationTokens();
  opts.fake?.setApp({ appId, publicKey });
  return { privateKey, publicKey, webhookSecret };
}
