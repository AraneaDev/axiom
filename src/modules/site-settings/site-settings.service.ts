import { prisma } from '../../config/database';

/**
 *
 */
export async function getSiteSettings() {
  return prisma.siteSettings.upsert({
    where: { id: 1 },
    create: {},
    update: {},
  });
}

/**
 *
 * @param data
 * @param data.heroTitle
 * @param data.heroSubtitle
 * @param data.ctaText
 * @param data.ctaLink
 * @param data.bodyMarkdown
 */
export async function updateSiteSettings(data: {
  heroTitle?: string;
  heroSubtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  bodyMarkdown?: string;
}) {
  return prisma.siteSettings.upsert({
    where: { id: 1 },
    create: { ...data },
    update: { ...data },
  });
}
