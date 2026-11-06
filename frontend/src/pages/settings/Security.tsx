import { Shield, KeyRound } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { SettingsPage } from '@/components/ui/SettingsPage';
import { useAuthStore } from '@/stores/auth.store';

/**
 *
 */
export default function Security() {
  const { user } = useAuthStore();

  return (
    <SettingsPage
      title="Security"
      description="Manage authentication and access credentials"
      icon={Shield}
      helpTitle="Securing your account"
      helpItems={[
        {
          title: 'Two-factor authentication',
          description:
            '2FA adds an extra layer of protection by requiring a code from your authenticator app when signing in.',
        },
        {
          title: 'API Tokens',
          description:
            'Tokens provide programmatic access to the API and are scoped to your account.',
        },
      ]}
    >
      <div className="space-y-4">
        {/* 2FA status */}
        <Card className="p-5">
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
            <ButtonLink to="/setup-2fa" size="sm" className="mt-3">
              <Shield className="h-4 w-4" /> Enable 2FA
            </ButtonLink>
          )}
        </Card>

        {/* API Tokens link */}
        <Link
          to="/settings/tokens"
          className="bg-surface rounded-lg border border-border p-4 flex items-center gap-3 hover:border-primary/50 transition-all block"
        >
          <KeyRound className="h-5 w-5 text-text-secondary" />
          <div className="flex-1">
            <p className="font-medium text-sm">API Tokens</p>
            <p className="text-xs text-text-secondary">Manage tokens for API access</p>
          </div>
        </Link>
      </div>
    </SettingsPage>
  );
}
