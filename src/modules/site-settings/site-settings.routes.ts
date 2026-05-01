import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { authenticate } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { isUserAdmin } from '../admin/admin.service';

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

// Admin-only — update settings
async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const admin = await isUserAdmin(req.userId!);
    if (!admin) {
      return next(new AppError(403, 'Admin access required', 'FORBIDDEN'));
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.put('/', authenticate, requireAdmin, controller.updateSiteSettings);

export default router;
