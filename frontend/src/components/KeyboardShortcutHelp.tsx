import { Keyboard } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';

interface KeyboardShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['k'], description: 'Move up in issue list' },
      { keys: ['j'], description: 'Move down in issue list' },
      { keys: ['Enter'], description: 'Open selected issue' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['c'], description: 'Create new issue' },
      { keys: ['/'], description: 'Focus search' },
      { keys: ['Ctrl', 'k'], description: 'Open command palette' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close dialog / clear selection' },
    ],
  },
];

/**
 * Modal dialog listing all available keyboard shortcuts.
 * Triggered by pressing '?' anywhere in the app.
 * @param root0
 * @param root0.open
 * @param root0.onClose
 */
export function KeyboardShortcutHelp({ open, onClose }: KeyboardShortcutHelpProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts" size="md">
      <div className="space-y-5">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="flex items-center gap-2 mb-2">
              <Keyboard className="h-3.5 w-3.5 text-text-tertiary" />
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                {group.title}
              </h3>
            </div>
            <div className="space-y-1">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.description}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-secondary transition-colors"
                >
                  <span className="text-sm text-text">{shortcut.description}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-mono font-medium text-text-secondary bg-surface-tertiary border border-border rounded"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
