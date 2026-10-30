import { useQuery } from '@tanstack/react-query';
import { CheckCircle, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import { formsApi } from '@/api/forms.api';
import { Button } from '@/components/ui/Button';
import { FormWizard } from '@/components/ui/FormWizard';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';

/**
 * Public form page rendered at /f/:formSlug.
 * No app chrome — minimal layout suitable for external submitters.
 */
export default function PublicForm() {
  const { formSlug } = useParams<{ formSlug: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // A token-gated form needs its shared secret to show its fields and to accept answers
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const [secretInput, setSecretInput] = useState('');

  const {
    data: form,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['public-form', formSlug, secret],
    queryFn: () => formsApi.getPublic(formSlug!, secret),
    enabled: !!formSlug,
  });

  async function handleSubmit(data: { responses: Record<string, unknown>; honeypot: string }) {
    if (!formSlug) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await formsApi.submit(formSlug, { data: data.responses, honeypot: data.honeypot, secret });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to submit the form. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <PageLoader />;

  if (error || !form) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
        <div className="max-w-md w-full text-center space-y-3">
          <p className="text-[15px] font-semibold text-text">Form not found</p>
          <p className="text-[13px] text-text-muted">
            This form may have been removed or the link is invalid.
          </p>
        </div>
      </div>
    );
  }

  if (form.locked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
        <form
          className="max-w-sm w-full space-y-4 bg-surface border border-border rounded-xl p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setSecret(secretInput);
          }}
        >
          <h1 className="text-[17px] font-semibold text-text">{form.name}</h1>
          <p className="text-[13px] text-text-muted">This form needs an access code.</p>
          <Input
            type="password"
            label="Access code"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            error={secret !== undefined ? 'That access code is not valid' : undefined}
          />
          <Button type="submit" disabled={!secretInput}>
            <KeyRound size={14} />
            Open form
          </Button>
        </form>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex justify-center">
            <CheckCircle size={48} className="text-success" />
          </div>
          <h1 className="text-[20px] font-bold text-text">
            {form.successMessage ?? 'Thank you for your submission!'}
          </h1>
          <p className="text-[13px] text-text-muted">
            Your response has been recorded. We will review it shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-secondary px-4 py-10">
      <div className="max-w-xl mx-auto">
        {/* Form header */}
        <div className="mb-8 text-center">
          <h1 className="text-[22px] font-bold text-text">{form.name}</h1>
          {form.description && (
            <p className="mt-2 text-[14px] text-text-secondary">{form.description}</p>
          )}
        </div>

        {/* Form card */}
        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
          {submitError && (
            <div className="mb-4 text-[13px] text-danger bg-danger-light border border-danger/20 rounded-md px-3 py-2">
              {submitError}
            </div>
          )}
          <FormWizard form={form} onSubmit={handleSubmit} isSubmitting={isSubmitting} />
        </div>
      </div>
    </div>
  );
}
