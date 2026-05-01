import { LogIn, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { PublicHeader } from '@/components/layout/PublicHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFormError } from '@/hooks/useFormError';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const { error, setError, clearError } = useFormError();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
      const result = await login(loginId, password, needs2FA ? twoFactorCode : undefined);
      if (result.twoFactorRequired) {
        setNeeds2FA(true);
      } else {
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : null) || 'Login failed';
      setError(
        msg.includes('Invalid credentials')
          ? 'Invalid email/username or password. Please try again.'
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-secondary">
      <PublicHeader />

      {/* Centered form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-sm p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-center text-text mb-1">Welcome back</h2>
          <p className="text-sm text-text-secondary text-center mb-6">Sign in to your account</p>

          {error && (
            <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {!needs2FA ? (
              <>
                <Input
                  id="login"
                  label="Email or username"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="admin"
                  autoFocus
                  required
                />
                <Input
                  id="password"
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
                <div className="flex justify-end">
                  <Link
                    to="/forgot-password"
                    className="text-xs text-primary hover:text-primary-hover"
                  >
                    Forgot your password?
                  </Link>
                </div>
              </>
            ) : (
              <Input
                id="twoFactorCode"
                label="Authentication code"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder="000000"
                hint="Enter the 6-digit code from your authenticator app"
                maxLength={6}
                autoFocus
                required
              />
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full mt-2"
              size="lg"
              aria-label={loading ? 'Signing in' : undefined}
            >
              {loading ? (
                <Spinner size="sm" />
              ) : needs2FA ? (
                <>
                  <ShieldCheck className="h-4 w-4" /> Verify
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" /> Sign in
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-text-tertiary">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary hover:text-primary-hover font-medium">
              Sign up
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
