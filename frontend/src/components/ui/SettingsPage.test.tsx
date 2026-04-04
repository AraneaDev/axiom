import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  it('renders the title', () => {
    render(<SettingsPage title="General Settings">content</SettingsPage>);
    expect(screen.getByRole('heading', { name: 'General Settings' })).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <SettingsPage title="Settings">
        <p>Main content here</p>
      </SettingsPage>,
    );
    expect(screen.getByText('Main content here')).toBeInTheDocument();
  });

  it('renders the actions slot', () => {
    render(
      <SettingsPage title="Settings" actions={<button>Save</button>}>
        content
      </SettingsPage>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
