import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface HelpItem {
  title: string;
  description: string;
}

interface SettingsPageProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  helpTitle?: string;
  helpDescription?: string;
  helpItems?: HelpItem[];
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Two-column settings page layout.
 * Left: page title, description, action buttons, and main content.
 * Right: contextual help card with tips and explanations.
 * @param root0
 * @param root0.title
 * @param root0.description
 * @param root0.icon
 * @param root0.helpTitle
 * @param root0.helpDescription
 * @param root0.helpItems
 * @param root0.children
 * @param root0.actions
 * @param root0.className
 */
export function SettingsPage({
  title,
  description,
  icon: Icon,
  helpTitle,
  helpDescription,
  helpItems,
  children,
  actions,
  className,
}: SettingsPageProps) {
  const hasHelp = helpTitle || helpDescription || (helpItems && helpItems.length > 0);

  return (
    <div className={cn('flex gap-8', className)}>
      <div className={cn('flex-1 min-w-0', !hasHelp && 'max-w-4xl')}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
              {Icon && <Icon className="h-6 w-6 text-text-secondary" />}
              {title}
            </h1>
            {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </div>

      {hasHelp && (
        <aside className="hidden lg:block w-80 shrink-0 mt-[4.25rem]">
          <div className="sticky top-20 rounded-lg border border-border bg-surface p-5 shadow-sm">
            {helpTitle && <h3 className="text-sm font-semibold text-text mb-2">{helpTitle}</h3>}
            {helpDescription && (
              <p className="text-sm text-text-secondary leading-relaxed">{helpDescription}</p>
            )}
            {helpItems && helpItems.length > 0 && (
              <ul className={cn('space-y-3', (helpTitle || helpDescription) && 'mt-4')}>
                {helpItems.map((item) => (
                  <li key={item.title}>
                    <p className="text-sm font-medium text-text">{item.title}</p>
                    <p className="text-xs text-text-tertiary leading-relaxed mt-0.5">
                      {item.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
