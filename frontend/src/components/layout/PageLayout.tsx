import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  sidebarWidth?: string;
  className?: string;
}

/**
 * Standard page layout: main content + optional right sidebar.
 * The left nav sidebar is handled by AppShell.
 * Right sidebar only appears on xl+ screens.
 * @param root0
 * @param root0.children
 * @param root0.sidebar
 * @param root0.sidebarWidth
 * @param root0.className
 */
export function PageLayout({
  children,
  sidebar,
  sidebarWidth = 'w-80',
  className,
}: PageLayoutProps) {
  if (!sidebar) {
    return <div className={cn('', className)}>{children}</div>;
  }

  return (
    <div className={cn('flex gap-6', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        className={cn(
          'hidden xl:block shrink-0 sticky top-0 self-start max-h-[calc(100vh-5rem)] overflow-y-auto',
          sidebarWidth,
        )}
      >
        {sidebar}
      </aside>
    </div>
  );
}
