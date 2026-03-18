import { Shield, Key, KeyRound } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Security() {
  const { user } = useAuthStore();

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Security</h1>

      <div className="space-y-4">
        {/* 2FA status */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Two-factor authentication</p>
                <p className="text-xs text-text-secondary">
                  Adds an extra layer of security to your account
                </p>
              </div>
            </div>
            <Badge variant={user?.twoFactorEnabled ? 'success' : 'warning'}>
              {user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
          {!user?.twoFactorEnabled && (
            <Link to="/setup-2fa" className="mt-3 block">
              <Button size="sm">
                <Shield className="h-4 w-4" /> Enable 2FA
              </Button>
            </Link>
          )}
        </div>

        {/* SSH Keys link */}
        <Link
          to="/settings/ssh-keys"
          className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3 hover:border-primary/50 transition-all block"
        >
          <Key className="h-5 w-5 text-text-secondary" />
          <div className="flex-1">
            <p className="font-medium text-sm">SSH Keys</p>
            <p className="text-xs text-text-secondary">Manage SSH keys for git access</p>
          </div>
        </Link>

        {/* API Tokens link */}
        <Link
          to="/settings/tokens"
          className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3 hover:border-primary/50 transition-all block"
        >
          <KeyRound className="h-5 w-5 text-text-secondary" />
          <div className="flex-1">
            <p className="font-medium text-sm">API Tokens</p>
            <p className="text-xs text-text-secondary">
              Manage tokens for API and git HTTPS access
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
