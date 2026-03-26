import { Mail, ArrowLeft, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { authApi } from '@/api/auth.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>

        <h2 className="text-2xl font-bold text-text mb-1">Reset your password</h2>
        <p className="text-sm text-text-secondary mb-6">
          Enter your email and we will send you a link to reset your password.
        </p>

        {sent ? (
          <div className="rounded-md bg-success-light border border-success/20 px-4 py-3 text-sm text-success">
            <Mail className="h-4 w-4 inline mr-2" />
            If an account exists with that email, you will receive a reset link shortly.
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                id="email"
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
              <Button type="submit" disabled={loading} className="w-full" size="lg">
                {loading ? <Spinner size="sm" /> : <><Send className="h-4 w-4" /> Send reset link</>}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
