import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

interface WizardStep {
  title: string;
}

interface WizardProgressProps {
  steps: WizardStep[];
  currentStep: number;
  className?: string;
}

/**
 * Step indicator for multi-step form wizards. Shows numbered circles with titles
 * and a check icon for completed steps.
 * @param root0
 * @param root0.steps
 * @param root0.currentStep
 * @param root0.className
 */
export function WizardProgress({ steps, currentStep, className }: WizardProgressProps) {
  return (
    <nav className={cn('flex items-center gap-0', className)} aria-label="Form progress">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;

        return (
          <div key={index} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                  isCompleted && 'bg-primary text-text-inverse',
                  isActive && 'bg-primary text-text-inverse ring-4 ring-primary/20',
                  !isCompleted &&
                    !isActive &&
                    'bg-surface-tertiary text-text-muted border border-border',
                )}
              >
                {isCompleted ? <Check size={14} strokeWidth={2.5} /> : index + 1}
              </div>
              <span
                className={cn(
                  'text-[11px] font-medium whitespace-nowrap',
                  isActive && 'text-primary',
                  isCompleted && 'text-text-secondary',
                  !isCompleted && !isActive && 'text-text-muted',
                )}
              >
                {step.title}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'h-px flex-1 mx-2 mb-5 transition-colors',
                  isCompleted ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
