import { get, put } from './client';

export interface SiteSettings {
  id: number;
  heroTitle: string;
  heroSubtitle: string;
  ctaText: string;
  ctaLink: string;
  bodyMarkdown: string;
  registrationMode: 'INVITE_ONLY' | 'OPEN' | 'DISABLED';
  enforce2fa: boolean;
  updatedAt: string;
}

export const siteSettingsApi = {
  get: () => get<SiteSettings>('/site-settings'),

  update: (data: Partial<Omit<SiteSettings, 'id' | 'updatedAt'>>) =>
    put<SiteSettings>('/site-settings', data),
};
