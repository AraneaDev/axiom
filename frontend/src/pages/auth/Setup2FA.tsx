import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { authApi } from '@/api/auth.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner, PageLoader } from '@/components/ui/Spinner';

/**
 *
 */
export default function Setup2FA() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['2fa-setup'],
    queryFn: () => authApi.enable2FA(),
    retry: false,
    meta: { onError: () => navigate('/') },
  });

  async function handleVerify() {
    setError('');
    setLoading(true);
    try {
      await authApi.verify2FA(code);
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
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
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
              <Spinner className="h-4 w-4" />
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Verify
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
