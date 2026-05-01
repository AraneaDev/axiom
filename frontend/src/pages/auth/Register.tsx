import { Moon, Sun, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useFormError } from '@/hooks/useFormError';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Register() {
  const navigate = useNavigate();
  const { isDark, toggle } = useDarkMode();
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
    <div className="min-h-screen flex flex-col bg-surface-secondary">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-text-inverse text-sm font-bold">A</span>
          </div>
          <span className="text-xl font-bold text-text">Axiom</span>
        </Link>
        <button
          onClick={toggle}
          className="p-2 rounded-md text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      {/* Centered form */}
      <div className="flex-1 flex items-center justify-center px-4">
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
    </div>
  );
}
