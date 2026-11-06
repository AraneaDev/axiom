// Every way a GitHub call gets its Authorization value is registered here and nowhere else. The
// API and the worker both import this file, so a call made in either process resolves the same
// kinds: a process without a resolver would fail its calls with a 502. A new auth kind is
// registered here.
import { AppError } from '../../middleware/errorHandler';

import { refreshUserToken, userToken } from './github-account.service';
import { getGithubAppSecrets, installationToken } from './github-app.service';
import { registerGithubAuthResolver } from './github-client';
import { appJwt } from './github-jwt';

registerGithubAuthResolver('app', async () => {
  const app = await getGithubAppSecrets();
  if (!app) throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
  return `Bearer ${appJwt(app.appId, app.privateKey)}`;
});

registerGithubAuthResolver('installation', async (auth) => {
  if (auth.kind !== 'installation') throw new Error('Not an installation');
  return `token ${await installationToken(auth.installationId)}`;
});

registerGithubAuthResolver('oauth-app', async () => {
  const app = await getGithubAppSecrets();
  if (!app) throw new AppError(409, 'No GitHub App is set up', 'GITHUB_APP_MISSING');
  return `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;
});

registerGithubAuthResolver(
  'user',
  async (auth) => {
    if (auth.kind !== 'user') throw new Error('Not a user');
    return `token ${await userToken(auth.userId)}`;
  },
  // GitHub refused the token: renew it once, unless a call refused with it did that already
  async (auth, refused) => {
    if (auth.kind !== 'user') throw new Error('Not a user');
    const rejected = refused.replace(/^token\s+/, '');
    return `token ${await refreshUserToken(auth.userId, undefined, { rejected })}`;
  },
);
