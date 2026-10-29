import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowLeft, Building2, Users, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const STEPS = [{ label: 'Welcome' }, { label: 'Organization' }, { label: 'Team' }];

/**
 *
 */
export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [createdOrgSlug, setCreatedOrgSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function handleOrgNameChange(value: string) {
    setOrgName(value);
    setOrgSlug(toSlug(value));
  }

  function handleTeamNameChange(value: string) {
    setTeamName(value);
    setTeamSlug(toSlug(value));
  }

  async function handleCreateOrg() {
    if (!orgName.trim() || !orgSlug.trim()) return;
    setLoading(true);
    try {
      const org = await orgsApi.create({
        name: orgName.trim(),
        slug: orgSlug.trim(),
        description: orgDescription.trim() || undefined,
      });
      setCreatedOrgId(org.id);
      setCreatedOrgSlug(org.slug);
      setStep(2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create organization.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTeam() {
    if (!teamName.trim() || !teamSlug.trim() || !createdOrgId) return;
    setLoading(true);
    try {
      await teamsApi.create(createdOrgId, {
        name: teamName.trim(),
        slug: teamSlug.trim(),
        description: teamDescription.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['orgs'] });
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Your workspace is ready.');
      navigate(`/${createdOrgSlug}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create team.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-4xl mx-auto">
        {/* Step indicators */}
        <div className="flex items-center justify-center mb-10">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-200',
                    i < step
                      ? 'bg-primary text-text-inverse'
                      : i === step
                        ? 'bg-primary text-text-inverse ring-4 ring-primary/20'
                        : 'bg-surface-tertiary text-text-tertiary border border-border',
                  )}
                >
                  {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    i === step ? 'text-primary' : 'text-text-tertiary',
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-px w-16 mx-2 mb-5 transition-colors duration-200',
                    i < step ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl shadow-sm p-8">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center">
              <div className="h-16 w-16 rounded-2xl bg-primary-light flex items-center justify-center mx-auto mb-6">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-text mb-3">Welcome to Axiom</h1>
              <p className="text-text-secondary mb-8 leading-relaxed">
                Let&apos;s get you set up with your first organization and team.
              </p>
              <Button size="lg" className="w-full" onClick={() => setStep(1)}>
                <ArrowRight className="h-4 w-4" /> Get Started
              </Button>
            </div>
          )}

          {/* Step 1: Create Organization */}
          {step === 1 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-text mb-1">Create your organization</h2>
                <p className="text-sm text-text-secondary">
                  An organization groups your teams and projects together.
                </p>
              </div>

              <div className="space-y-4 mb-8">
                <Input
                  label="Organization name"
                  placeholder="Acme Corp"
                  value={orgName}
                  onChange={(e) => handleOrgNameChange(e.target.value)}
                  autoFocus
                />
                <Input
                  label="Slug"
                  placeholder="acme-corp"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  hint="Used in URLs. Only lowercase letters, numbers, and hyphens."
                />
                <Textarea
                  label="Description"
                  placeholder="What does your organization do? (optional)"
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(0)} className="flex-1">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateOrg}
                  disabled={!orgName.trim() || !orgSlug.trim() || loading}
                >
                  <Building2 className="h-4 w-4" />
                  {loading ? 'Creating...' : 'Create Organization'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Create Team */}
          {step === 2 && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-text mb-1">Create your first team</h2>
                <p className="text-sm text-text-secondary">
                  Teams contain projects, issues, wikis, and more.
                </p>
              </div>

              <div className="space-y-4 mb-8">
                <Input
                  label="Team name"
                  placeholder="Engineering"
                  value={teamName}
                  onChange={(e) => handleTeamNameChange(e.target.value)}
                  autoFocus
                />
                <Input
                  label="Slug"
                  placeholder="engineering"
                  value={teamSlug}
                  onChange={(e) => setTeamSlug(e.target.value)}
                  hint="Used in URLs. Only lowercase letters, numbers, and hyphens."
                />
                <Textarea
                  label="Description"
                  placeholder="What does this team work on? (optional)"
                  value={teamDescription}
                  onChange={(e) => setTeamDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateTeam}
                  disabled={!teamName.trim() || !teamSlug.trim() || loading}
                >
                  <Users className="h-4 w-4" />
                  {loading ? 'Creating...' : 'Create Team'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
