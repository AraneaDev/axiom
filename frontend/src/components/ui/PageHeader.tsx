import { type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  prefix?: string;
  children?: ReactNode;
}

/**
 * Consistent page header for project views.
 * Renders title + optional project prefix badge on the left,
 * and action buttons (passed as children) on the right.
 * @param root0
 * @param root0.title
 * @param root0.prefix
 * @param root0.children
 */
export function PageHeader({ title, prefix, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <h1 className="h2">{title}</h1>
        {prefix && (
          <span className="text-xs font-mono text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded">
            {prefix}
          </span>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
