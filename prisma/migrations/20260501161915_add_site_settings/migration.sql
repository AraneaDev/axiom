-- CreateTable
CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "heroTitle" TEXT NOT NULL DEFAULT 'Code. Track. Document.',
    "heroSubtitle" TEXT NOT NULL DEFAULT 'Git hosting, issue tracking, and documentation — unified with built-in AI integration.',
    "ctaText" TEXT NOT NULL DEFAULT 'Get Started',
    "ctaLink" TEXT NOT NULL DEFAULT '/register',
    "bodyMarkdown" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);
