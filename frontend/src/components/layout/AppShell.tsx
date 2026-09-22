import { Outlet } from 'react-router';

import { CommandPalette } from '@/components/ui/CommandPalette';

import { Breadcrumbs } from './Breadcrumbs';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

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
        <main className="flex-1 overflow-y-auto px-6 py-5">
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
