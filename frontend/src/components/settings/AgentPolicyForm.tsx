import { Lock, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';

import type { AgentPolicy } from '@/api/agent-policy.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import {
  LIMITS,
  parseNames,
  problemWith,
  rulesFrom,
  valuesOf,
  type PolicyScope,
} from '@/lib/agent-policy';

interface AgentPolicyFormProps {
  scope: PolicyScope;
  policy: AgentPolicy;
  /** False for a reader who may not change the rules. */
  canEdit: boolean;
  saving: boolean;
  /** What the server said when the last save failed. */
  error?: string | null;
  onSave: (rules: ReturnType<typeof rulesFrom>) => void;
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-xs text-text-secondary">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ActionNames({ names }: { names: string[] }) {
  return (
    <details className="mt-2 text-xs text-text-secondary">
      <summary className="cursor-pointer">Action names that can be listed ({names.length})</summary>
      <ul className="mt-1 grid max-h-40 gap-0.5 overflow-y-auto font-mono sm:grid-cols-2">
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The rules for which agent actions wait for your approval. An org owner can loosen or tighten
 * them for the org; a person can only tighten their own. Admin actions always wait.
 * @param root0 - The props
 * @param root0.scope - Whose rules these are
 * @param root0.policy - The rules, the effective values and the defaults
 * @param root0.canEdit - False for a reader who may not change them
 * @param root0.saving - Whether a save is under way
 * @param root0.error - What the server said when the last save failed
 * @param root0.onSave - Called with the rules to store
 */
export function AgentPolicyForm({
  scope,
  policy,
  canEdit,
  saving,
  error,
  onSave,
}: AgentPolicyFormProps) {
  const [values, setValues] = useState(() => valuesOf(policy));
  const [problem, setProblem] = useState<string | null>(null);
  // Typed as text, so a new line can be typed; the names are read at save
  const [alsoText, setAlsoText] = useState(() => values.alsoRequire.join('\n'));
  const [neverText, setNeverText] = useState(() => values.neverRequire.join('\n'));
  const limits = LIMITS[scope];
  const set = (patch: Partial<typeof values>) => {
    setValues({ ...values, ...patch });
    setProblem(null);
  };

  function submit() {
    const typed = {
      ...values,
      ...(scope === 'org'
        ? { alsoRequire: parseNames(alsoText), neverRequire: parseNames(neverText) }
        : {}),
    };
    const found = problemWith(scope, typed);
    setProblem(found);
    if (!found) onSave(rulesFrom(scope, typed, policy));
  }

  return (
    <Card className="p-5">
      <div className="divide-y divide-border-light">
        <Row
          title="Admin actions"
          description="Users, tokens, permissions and the like always wait for approval."
        >
          <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
            <Lock className="h-3.5 w-3.5" /> Always
          </span>
        </Row>
        <Row title="Destructive actions" description="Deletes, purges and revokes by a token.">
          {scope === 'org' ? (
            <Toggle
              aria-label="Destructive actions need approval"
              checked={values.destructive}
              disabled={!canEdit}
              onChange={(destructive) => set({ destructive })}
            />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
              <Lock className="h-3.5 w-3.5" /> Always
            </span>
          )}
        </Row>
        <Row
          title="Moves across projects or spaces"
          description="Moving an issue or page into another project or space."
        >
          {scope === 'org' ? (
            <Toggle
              aria-label="Moves across containers need approval"
              checked={values.crossContainerMove}
              disabled={!canEdit}
              onChange={(crossContainerMove) => set({ crossContainerMove })}
            />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
              <Lock className="h-3.5 w-3.5" /> Always
            </span>
          )}
        </Row>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Input
          label="Bulk threshold"
          type="number"
          min={limits.bulkOver[0]}
          max={limits.bulkOver[1]}
          value={values.bulkOver}
          disabled={!canEdit}
          onChange={(e) => set({ bulkOver: e.target.value })}
          hint={`A bulk action over this many items waits. ${
            scope === 'user' ? 'You can only lower it.' : ''
          }`}
        />
        <Input
          label="Expires after (minutes)"
          type="number"
          min={limits.expiresMinutes[0]}
          max={limits.expiresMinutes[1]}
          value={values.expiresMinutes}
          disabled={!canEdit}
          onChange={(e) => set({ expiresMinutes: e.target.value })}
          hint={`From ${limits.expiresMinutes[0]} to ${limits.expiresMinutes[1]}. ${
            scope === 'user' ? 'You can only shorten it.' : ''
          }`}
        />
      </div>

      <div className="mt-4">
        {scope === 'org' ? (
          <>
            <Textarea
              label="Also require approval for"
              rows={3}
              value={alsoText}
              disabled={!canEdit}
              onChange={(e) => setAlsoText(e.target.value)}
              hint="Action names, one per line, such as issue.update."
            />
            <ActionNames names={policy.writeActions} />
          </>
        ) : (
          <fieldset>
            <legend className="text-sm font-medium text-text">Also require approval for</legend>
            <p className="mb-2 text-xs text-text-secondary">
              Write actions that wait for you whenever an agent asks.
            </p>
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {policy.writeActions.map((name) => (
                <Checkbox
                  key={name}
                  id={`also-require-${name}`}
                  size="sm"
                  label={name}
                  checked={values.alsoRequire.includes(name)}
                  onChange={(e) =>
                    set({
                      alsoRequire: e.target.checked
                        ? [...values.alsoRequire, name]
                        : values.alsoRequire.filter((n) => n !== name),
                    })
                  }
                />
              ))}
            </div>
          </fieldset>
        )}
      </div>

      {scope === 'org' && (
        <div className="mt-4">
          <Textarea
            label="Never require approval for"
            rows={3}
            value={neverText}
            disabled={!canEdit}
            onChange={(e) => setNeverText(e.target.value)}
            hint="Action names, one per line. Admin actions still wait."
          />
        </div>
      )}

      {(problem ?? error) && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-danger/20 bg-danger-light px-3 py-2 text-sm text-danger"
        >
          {problem ?? error}
        </div>
      )}

      {canEdit && (
        <div className="mt-5 flex gap-2">
          <Button size="sm" onClick={submit} disabled={saving}>
            <Save className="h-4 w-4" /> Save rules
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setValues(valuesOf({ ...policy, rules: {}, effective: policy.defaults }));
              setAlsoText('');
              setNeverText('');
              setProblem(null);
            }}
            disabled={saving}
          >
            <RotateCcw className="h-4 w-4" /> Back to defaults
          </Button>
        </div>
      )}
    </Card>
  );
}
