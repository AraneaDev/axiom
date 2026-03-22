import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Users,
  FolderKanban,
  BookOpen,
  GitBranch,
  Plus,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

function NavItem({
  to,
  icon: Icon,
  label,
  count,
  indent,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  indent?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 h-9 text-[13px] transition-all duration-150',
          indent && 'ml-2',
          isActive
            ? 'bg-primary-light text-primary font-medium'
            : 'text-text-secondary hover:text-text hover:bg-surface-tertiary',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="ml-auto text-[10px] text-text-tertiary tabular-nums">{count}</span>
      )}
    </NavLink>
  );
}

function SectionHeader({
  label,
  action,
  collapsed,
  onToggle,
}: {
  label: string;
  action?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2.5 mb-1">
      <Button
        variant="ghost"
        size="xs"
        onClick={onToggle}
        className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-text-tertiary hover:text-text-secondary px-0"
        title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      >
        {onToggle && (
          <ChevronDown
            className={cn('h-3 w-3 transition-transform duration-200', collapsed && '-rotate-90')}
          />
        )}
        {label}
      </Button>
      {action}
    </div>
  );
}

/**
 *
 */
export function Sidebar() {
  const { org, team } = useParams();
  const { sidebarOpen, setSidebarOpen, currentOrgId, setCurrentOrg, setCurrentTeam } = useUIStore();
  const [orgsCollapsed, setOrgsCollapsed] = useState(false);
  const [teamsCollapsed, setTeamsCollapsed] = useState(false);

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });

  useEffect(() => {
    if (currentOrg?.id && currentOrg.id !== currentOrgId) setCurrentOrg(currentOrg.id);
  }, [currentOrg?.id, currentOrgId, setCurrentOrg]);

  const currentTeam = teams?.find((t) => t.slug === team);
  useEffect(() => {
    if (currentTeam?.id) setCurrentTeam(currentTeam.id);
  }, [currentTeam?.id, setCurrentTeam]);

  if (!sidebarOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={cn(
          'w-60 border-r border-border bg-surface flex flex-col shrink-0 overflow-y-auto scrollbar-none',
          'fixed inset-y-0 left-0 z-40 pt-12 lg:pt-0 lg:relative lg:z-auto',
        )}
      >
        {/* Sections wrapper */}
        <div className="flex flex-col gap-6 p-3">
          {/* Org section */}
          <div className="space-y-1">
            <SectionHeader
              label="Organization"
              collapsed={orgsCollapsed}
              onToggle={() => setOrgsCollapsed(!orgsCollapsed)}
              action={
                <NavLink
                  to="/orgs/new"
                  className="text-text-tertiary hover:text-primary transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </NavLink>
              }
            />
            <div
              className={cn(
                'overflow-hidden transition-all duration-200',
                orgsCollapsed ? 'max-h-0' : 'max-h-96',
              )}
            >
              {orgs?.map((o) => (
                <NavLink
                  key={o.id}
                  to={`/${o.slug}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-all duration-150',
                      isActive
                        ? 'bg-primary-light text-primary font-medium'
                        : 'text-text-secondary hover:bg-surface-tertiary hover:text-text',
                    )
                  }
                >
                  <div className="h-5 w-5 rounded bg-primary flex items-center justify-center">
                    <span className="text-[9px] text-text-inverse font-bold">{o.name[0]}</span>
                  </div>
                  <span className="truncate">{o.name}</span>
                </NavLink>
              ))}
            </div>
          </div>

          {/* Teams */}
          {currentOrg && teams && (
            <div className="flex-1 space-y-1">
              <SectionHeader
                label="Teams"
                collapsed={teamsCollapsed}
                onToggle={() => setTeamsCollapsed(!teamsCollapsed)}
                action={
                  <NavLink
                    to={`/${org}/teams/new`}
                    className="text-text-tertiary hover:text-primary transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </NavLink>
                }
              />
              <div
                className={cn(
                  'overflow-hidden transition-all duration-200',
                  teamsCollapsed ? 'max-h-0' : 'max-h-96',
                )}
              >
                {teams.map((t) => (
                  <NavItem
                    key={t.id}
                    to={`/${org}/${t.slug}`}
                    icon={Users}
                    label={t.name}
                    count={t._count?.projects}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Team sub-nav */}
          {currentTeam && (
            <div className="space-y-1">
              <SectionHeader label={currentTeam.name} />
              <NavItem to={`/${org}/${team}/projects`} icon={FolderKanban} label="Projects" />
              <NavItem to={`/${org}/${team}/wiki`} icon={BookOpen} label="Wiki" />
              <NavItem to={`/${org}/${team}/repos`} icon={GitBranch} label="Repositories" />
              <NavItem to={`/${org}/${team}/members`} icon={Users} label="Members" />
            </div>
          )}

          {/* Admin link -- only for org owners */}
          {orgs?.some((o) => o.role === 'OWNER') && (
            <div className="mt-auto">
              <NavItem to="/admin" icon={ShieldCheck} label="Admin" />
            </div>
          )}
        </div>
        {/* /Sections wrapper */}
      </aside>
    </>
  );
}
