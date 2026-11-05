import { z } from 'zod';

import { platformAdmin } from '../../actions/authorize';
import { defineAction, definePublicAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as siteSettingsService from './site-settings.service';

const noTarget = z.object({});
const settings = z.looseObject({});

const updateSiteSettingsSchema = z.object({
  heroTitle: z.string().min(1).max(200).optional(),
  heroSubtitle: z.string().max(500).optional(),
  ctaText: z.string().min(1).max(50).optional(),
  ctaLink: z.string().min(1).max(200).optional(),
  bodyMarkdown: z.string().max(50000).optional(),
  registrationMode: z.enum(['INVITE_ONLY', 'OPEN', 'DISABLED']).optional(),
  enforce2fa: z.boolean().optional(),
});

registerActions([
  definePublicAction({
    name: 'siteSettings.get',
    // Public: the landing page and the sign-in page read it before anyone signs in
    uiOnly: true,
    area: 'orgs',
    kind: 'read',
    summary: 'Read the landing page text and the sign-up mode',
    input: noTarget,
    output: settings,
    rest: { method: 'GET', path: '/api/site-settings', public: true },
    authorize: async () => {},
    handler: async () => siteSettingsService.getSiteSettings(),
  }),
  defineAction({
    name: 'siteSettings.update',
    // How people sign up and whether 2FA is required: a platform admin at the web UI
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: 'Change the landing page text, the sign-up mode or the 2FA requirement',
    target: noTarget,
    input: noTarget.extend(updateSiteSettingsSchema.shape),
    output: settings,
    rest: { method: 'PUT', path: '/api/site-settings' },
    authorize: async (ctx) => platformAdmin(ctx),
    handler: async (_ctx, data) => siteSettingsService.updateSiteSettings(data),
  }),
]);
