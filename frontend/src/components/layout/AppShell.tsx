import { Outlet } from 'react-router';

import { Breadcrumbs } from './Breadcrumbs';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

import { CommandPalette } from '@/components/ui/CommandPalette';

/**
 *
 */
export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-surface-secondary">
      <Header />
      <CommandPalette />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:px-8 lg:py-6">
            <Breadcrumbs />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
