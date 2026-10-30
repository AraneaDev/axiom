import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';

import * as controller from './site-settings.controller';

const router = Router();

export const updateSiteSettingsSchema = z.object({
  heroTitle: z.string().min(1).max(200).optional(),
  heroSubtitle: z.string().max(500).optional(),
  ctaText: z.string().min(1).max(50).optional(),
  ctaLink: z.string().min(1).max(200).optional(),
  bodyMarkdown: z.string().max(50000).optional(),
  registrationMode: z.enum(['INVITE_ONLY', 'OPEN', 'DISABLED']).optional(),
  enforce2fa: z.boolean().optional(),
});

// Public — no auth required
router.get('/', controller.getSiteSettings);

router.put('/', authenticate, requireAdmin, controller.updateSiteSettings);

export default router;
