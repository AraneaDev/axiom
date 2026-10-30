import { BookTemplate, Braces, Eye, EyeOff, Save, Wifi, WifiOff, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { PresenceIndicators, type PresenceUser } from '@/components/wiki/PresenceIndicators';
import { cn } from '@/lib/utils';

interface PageEditHeaderProps {
  isNew: boolean;
  hasExistingPage: boolean;
  draftStatus: 'saved' | 'saving' | 'idle';
  showTemplatePicker: boolean;
  onToggleTemplatePicker: () => void;
  hasTemplates: boolean;
  showVariablePanel: boolean;
  onToggleVariablePanel: () => void;
  showPreview: boolean;
  onTogglePreview: () => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  canSave: boolean;
  /** Hide Save for users who may only view the page */
  readOnly?: boolean;
  isConnected: boolean;
  presenceUsers: PresenceUser[];
}

/**
 *
 * @param root0
 * @param root0.isNew
 * @param root0.hasExistingPage
 * @param root0.draftStatus
 * @param root0.showTemplatePicker
 * @param root0.onToggleTemplatePicker
 * @param root0.hasTemplates
 * @param root0.showVariablePanel
 * @param root0.onToggleVariablePanel
 * @param root0.showPreview
 * @param root0.onTogglePreview
 * @param root0.onCancel
 * @param root0.onSave
 * @param root0.isSaving
 * @param root0.canSave
 * @param root0.readOnly
 * @param root0.isConnected
 * @param root0.presenceUsers
 */
export function PageEditHeader({
  isNew,
  hasExistingPage,
  draftStatus,
  showTemplatePicker,
  onToggleTemplatePicker,
  hasTemplates,
  showVariablePanel,
  onToggleVariablePanel,
  showPreview,
  onTogglePreview,
  onCancel,
  onSave,
  isSaving,
  canSave,
  readOnly = false,
  isConnected,
  presenceUsers,
}: PageEditHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <h1 className="h2">{isNew ? 'New Page' : 'Edit Page'}</h1>
        {draftStatus === 'saving' && (
          <span className="text-xs text-text-tertiary flex items-center gap-1">
            <Save className="h-3 w-3 animate-pulse" /> Saving draft...
          </span>
        )}
        {draftStatus === 'saved' && (
          <span className="text-xs text-success flex items-center gap-1">
            <Save className="h-3 w-3" /> Draft saved
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Collaboration presence indicators */}
        {!isNew && presenceUsers.length > 0 && <PresenceIndicators users={presenceUsers} />}
        {!isNew && hasExistingPage && (
          <span
            className={cn(
              'flex items-center gap-1 text-xs',
              isConnected ? 'text-success' : 'text-text-tertiary',
            )}
            title={isConnected ? 'Real-time sync active' : 'Editing offline'}
          >
            {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          </span>
        )}
        {isNew && hasTemplates && (
          <Button variant="ghost" size="sm" onClick={onToggleTemplatePicker}>
            <BookTemplate className="h-4 w-4" />
            {showTemplatePicker ? 'Hide templates' : 'Templates'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleVariablePanel}
          className={cn(showVariablePanel && 'text-primary bg-primary/10')}
          title="Toggle template variable reference"
        >
          <Braces className="h-4 w-4" />
          Variables
        </Button>
        <Button variant="secondary" size="sm" onClick={onTogglePreview}>
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showPreview ? 'Hide Preview' : 'Preview'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        {!readOnly && (
          <Button onClick={onSave} disabled={isSaving || !canSave}>
            {isSaving ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Save className="h-4 w-4" /> Save
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
