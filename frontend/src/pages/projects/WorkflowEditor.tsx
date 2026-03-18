import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2, ArrowLeft, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useParams, Link } from 'react-router';

import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { workflowsApi } from '@/api/workflows.api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { BoardColumn } from '@/lib/types';

/**
 *
 */
export default function WorkflowEditor() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [fromColumnId, setFromColumnId] = useState('');
  const [toColumnId, setToColumnId] = useState('');

  // Resolve project
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  // Fetch board columns
  const { data: columns } = useQuery({
    queryKey: ['board', currentProject?.id],
    queryFn: () => issuesApi.getBoard(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Fetch workflow rules
  const { data: rules, isLoading } = useQuery({
    queryKey: ['workflow-rules', currentProject?.id],
    queryFn: () => workflowsApi.listRules(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: { fromColumnId: string; toColumnId: string }) =>
      workflowsApi.createRule(currentProject!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-rules', currentProject?.id] });
      setFromColumnId('');
      setToColumnId('');
      toast('Workflow rule created', 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => workflowsApi.deleteRule(currentProject!.id, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-rules', currentProject?.id] });
      toast('Workflow rule deleted', 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const columnOptions = (columns ?? []).map((col: BoardColumn) => ({
    value: col.id,
    label: col.name,
  }));

  const handleAdd = () => {
    if (!fromColumnId || !toColumnId) return;
    if (fromColumnId === toColumnId) {
      toast('From and To columns must be different', 'error');
      return;
    }
    createMutation.mutate({ fromColumnId, toColumnId });
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/${org}/${teamSlug}/${projectSlug}/issues`}
          className="text-text-secondary hover:text-text transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Workflow Rules</h1>
          <p className="text-sm text-text-secondary">
            Define allowed column transitions for {currentProject?.name}
          </p>
        </div>
      </div>

      {/* Add rule form */}
      <div className="bg-surface-elevated border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">Add Transition Rule</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Select
              label="From Column"
              options={columnOptions}
              value={fromColumnId}
              onChange={(v) => setFromColumnId(v as string)}
              placeholder="Select source..."
            />
          </div>
          <ArrowRight className="h-5 w-5 text-text-tertiary mb-2" />
          <div className="flex-1">
            <Select
              label="To Column"
              options={columnOptions}
              value={toColumnId}
              onChange={(v) => setToColumnId(v as string)}
              placeholder="Select target..."
            />
          </div>
          <Button
            onClick={handleAdd}
            disabled={!fromColumnId || !toColumnId || createMutation.isPending}
            size="md"
          >
            <Plus className="h-4 w-4" /> Add Rule
          </Button>
        </div>
      </div>

      {/* Rules table */}
      {rules && rules.length > 0 ? (
        <div className="bg-surface-elevated border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-surface-secondary">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">From</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary" />
                <th className="text-left px-4 py-3 font-medium text-text-secondary">To</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border-light last:border-0">
                  <td className="px-4 py-3 font-medium">{rule.fromColumn.name}</td>
                  <td className="px-4 py-3">
                    <ArrowRight className="h-4 w-4 text-text-tertiary" />
                  </td>
                  <td className="px-4 py-3 font-medium">{rule.toColumn.name}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<Workflow className="h-10 w-10" />}
          title="No workflow rules defined"
          description="Without rules, issues can move freely between any columns. Add rules to restrict allowed transitions."
        />
      )}
    </div>
  );
}
