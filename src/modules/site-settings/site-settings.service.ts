import { prisma } from '../../config/database';

/**
 *
 */
export async function getSiteSettings() {
  const existing = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  try {
    return await prisma.siteSettings.create({ data: { id: 1 } });
  } catch (err) {
    // Concurrent first requests on a fresh database race to create the row (P2002).
    if ((err as { code?: string }).code === 'P2002') {
      return prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } });
    }
    throw err;
  }
}

/**
 *
 * @param data
 * @param data.heroTitle
 * @param data.heroSubtitle
 * @param data.ctaText
 * @param data.ctaLink
 * @param data.bodyMarkdown
 * @param data.registrationMode
 * @param data.enforce2fa
 */
export async function updateSiteSettings(data: {
  heroTitle?: string;
  heroSubtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  bodyMarkdown?: string;
  registrationMode?: string;
  enforce2fa?: boolean;
}) {
  return prisma.siteSettings.upsert({
    where: { id: 1 },
    create: { ...data },
    update: { ...data },
  });
}
