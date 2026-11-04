import { useQuery } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { authApi } from '@/api/auth.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { useFormError } from '@/hooks/useFormError';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Setup2FA() {
  const navigate = useNavigate();
  const { loadUser, logout } = useAuthStore();
  const [code, setCode] = useState('');
  const { error, setError, clearError } = useFormError();
  const [loading, setLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['2fa-setup'],
    queryFn: () => authApi.enable2FA(),
    retry: false,
    // Each call makes a new secret, so a refetch would invalidate the code being scanned, and a
    // cached one could show the secret to the next user of this tab
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { onError: () => navigate('/') },
  });

  async function handleVerify() {
    clearError();
    setLoading(true);
    try {
      await authApi.verify2FA(code);
      await loadUser();
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  if (isLoading || !data) return <PageLoader />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary">
      <Card className="w-full max-w-md p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-center mb-1">Set up two-factor authentication</h1>
        <p className="text-sm text-text-secondary text-center mb-6">
          Scan this QR code with your authenticator app, then enter the 6-digit code.
        </p>

        <div className="flex flex-col items-center gap-4 mb-6">
          <div className="rounded-lg border border-border p-4 bg-surface">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.otpauthUrl)}`}
              alt="2FA QR Code"
              className="h-48 w-48"
            />
          </div>
          <div className="text-center">
            <p className="text-xs text-text-secondary mb-1">Or enter this secret manually:</p>
            <code className="text-sm bg-surface-secondary px-3 py-1 rounded-md font-mono select-all">
              {data.secret}
            </code>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-danger-light border border-danger/20 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 6-digit code"
            maxLength={6}
            className="flex-1"
          />
          <Button onClick={handleVerify} disabled={loading || code.length !== 6}>
            {loading ? (
              <Spinner size="sm" />
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Verify
              </>
            )}
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={logout} className="mt-4 w-full">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </Card>
    </div>
  );
}
