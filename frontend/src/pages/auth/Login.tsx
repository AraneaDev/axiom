import { LogIn, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(loginId, password, needs2FA ? twoFactorCode : undefined);
      if (result.twoFactorRequired) {
        setNeeds2FA(true);
      } else {
        navigate('/');
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
    <div className="flex min-h-screen">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
        <div className="relative z-10 text-text-inverse max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-12 w-12 rounded-lg bg-surface/20 backdrop-blur-sm flex items-center justify-center">
              <span className="text-2xl font-bold">A</span>
            </div>
            <span className="text-3xl font-bold tracking-tight">Axiom</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Code. Track. Document.
            <br />
            All in one place.
          </h1>
          <p className="text-lg text-primary-light leading-relaxed">
            Git hosting, issue tracking, and documentation — unified with built-in AI integration.
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-surface min-h-screen">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-text-inverse text-sm font-bold">A</span>
            </div>
            <span className="text-xl font-bold text-text">Axiom</span>
          </div>

          <h2 className="text-2xl font-bold text-text mb-1">Welcome back</h2>
          <p className="text-sm text-text-secondary mb-8">Sign in to your account</p>

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

            <Button type="submit" disabled={loading} className="w-full mt-2" size="lg">
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
        </div>
      </div>
    </div>
  );
}
