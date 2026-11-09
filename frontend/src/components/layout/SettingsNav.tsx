import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

/**
 * The side nav of a settings area: a heading and one link per page.
 * @param props - The heading and the links
 * @param props.heading - What the area is called
 * @param props.items - Its pages
 */
export function SettingsNav({ heading, items }: { heading: string; items: SettingsNavItem[] }) {
  return (
    <nav className="w-56 shrink-0" aria-label={heading}>
      <h2 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider px-3 mb-2">
        {heading}
      </h2>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-all duration-150',
                isActive
                  ? 'bg-primary/10 text-primary font-semibold border-l-2 border-primary'
                  : 'text-text-secondary hover:text-text hover:bg-surface-tertiary border-l-2 border-transparent',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
