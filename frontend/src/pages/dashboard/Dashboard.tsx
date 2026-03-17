import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { Plus, Building2, ArrowRight, Users, Clock, Star } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { orgsApi } from '@/api/orgs.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';

function StatCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-text">{value}</p>
        <p className="text-xs text-text-tertiary">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const { data: orgs, isLoading } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });

  if (isLoading) return <PageLoader />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const orgCount = orgs?.length ?? 0;
  const ownerCount = orgs?.filter((o) => o.role === 'OWNER').length ?? 0;
  const memberCount = orgs?.filter((o) => o.role === 'MEMBER').length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text">{greeting}, {user?.displayName?.split(' ')[0]}</h1>
          <p className="text-text-secondary text-sm mt-0.5">Here's an overview of your workspace</p>
        </div>
        <Link to="/orgs/new">
          <Button variant="outline" size="sm"><Plus className="h-3.5 w-3.5" /> New Organization</Button>
        </Link>
      </div>

      {/* Stat cards */}
      {orgCount > 0 && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard icon={Building2} label="Organizations" value={orgCount} color="bg-gradient-to-br from-indigo-500 to-purple-600" />
          <StatCard icon={Star} label="Owner roles" value={ownerCount} color="bg-gradient-to-br from-amber-400 to-orange-500" />
          <StatCard icon={Users} label="Member roles" value={memberCount} color="bg-gradient-to-br from-emerald-400 to-teal-500" />
          <StatCard icon={Clock} label="Last active" value="Today" color="bg-gradient-to-br from-sky-400 to-blue-500" />
        </div>
      )}

      {!orgs?.length ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title="No organizations yet"
          description="Create your first organization to start managing projects and documentation."
          action={<Link to="/orgs/new"><Button><Plus className="h-4 w-4" /> Create Organization</Button></Link>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => (
            <Link
              key={org.id}
              to={`/${org.slug}`}
              className="group rounded-xl border border-border bg-surface overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200"
            >
              <div className="h-16 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 flex items-end px-5 pb-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-sm -mb-5 ring-2 ring-surface">
                  <span className="text-white text-sm font-bold">{org.name[0]}</span>
                </div>
              </div>
              <div className="p-5 pt-7">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-text text-sm truncate">{org.name}</h3>
                  <Badge variant="outline" size="sm">{org.role?.toLowerCase()}</Badge>
                </div>
                <p className="text-xs text-text-tertiary mb-2">/{org.slug}</p>
                {org.description && (
                  <p className="text-sm text-text-secondary line-clamp-2 mb-3">{org.description}</p>
                )}
                <div className="flex items-center text-xs text-text-tertiary group-hover:text-primary transition-colors">
                  <span>Open workspace</span>
                  <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
