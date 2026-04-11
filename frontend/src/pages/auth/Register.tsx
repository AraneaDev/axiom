import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFormError } from '@/hooks/useFormError';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuthStore();
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '' });
  const { error, setError, clearError } = useFormError();
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
      await register(form);
      navigate('/setup-2fa');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary">
      <Card className="w-full max-w-sm p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-center mb-1">Create account</h1>
        <p className="text-sm text-text-secondary text-center mb-6">Get started with Axiom</p>

        {error && (
          <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="displayName"
            label="Display name"
            value={form.displayName}
            onChange={(e) => update('displayName', e.target.value)}
            placeholder="Jane Doe"
            required
          />
          <Input
            id="username"
            label="Username"
            value={form.username}
            onChange={(e) => update('username', e.target.value)}
            placeholder="janedoe"
            required
          />
          <Input
            id="email"
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="jane@example.com"
            required
          />
          <Input
            id="password"
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            placeholder="Min 8 characters"
            required
          />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <Spinner size="sm" />
            ) : (
              <>
                <UserPlus className="h-4 w-4" /> Create account
              </>
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-text-secondary">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
