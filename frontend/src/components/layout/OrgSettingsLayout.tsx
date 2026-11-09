import { Bot, ShieldCheck } from 'lucide-react';
import { Outlet, useParams } from 'react-router';

import { SettingsNav } from './SettingsNav';

/**
 * The settings of one org (`/:org/settings/...`): a nav beside the page it opens.
 */
export function OrgSettingsLayout() {
  const { org = '' } = useParams();
  return (
    <div className="flex gap-8">
      <SettingsNav
        heading="Org settings"
        items={[
          { to: `/${org}/settings/service-accounts`, icon: Bot, label: 'Service accounts' },
          { to: `/${org}/settings/agent-approvals`, icon: ShieldCheck, label: 'Agent approvals' },
        ]}
      />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
