import { create } from 'zustand';

type ProjectView = 'board' | 'issues' | 'backlog';

interface UIState {
  sidebarOpen: boolean;
  searchOpen: boolean;
  shortcutHelpOpen: boolean;
  currentOrgId: string | null;
  currentTeamId: string | null;
  preferredProjectView: ProjectView;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSearch: () => void;
  toggleShortcutHelp: () => void;
  setShortcutHelpOpen: (open: boolean) => void;
  setCurrentOrg: (orgId: string | null) => void;
  setCurrentTeam: (teamId: string | null) => void;
  setPreferredProjectView: (view: ProjectView) => void;
}

/**
 * Global UI state store for sidebar, search, and active navigation context.
 * Provides toggle and setter actions for sidebar visibility,
 * command palette search, and current org/team selection.
 */
export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  searchOpen: false,
  shortcutHelpOpen: false,
  currentOrgId: null,
  currentTeamId: null,
  preferredProjectView: (localStorage.getItem('preferredProjectView') as ProjectView) || 'board',

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  toggleShortcutHelp: () => set((s) => ({ shortcutHelpOpen: !s.shortcutHelpOpen })),
  setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
  setCurrentOrg: (orgId) => set({ currentOrgId: orgId }),
  setCurrentTeam: (teamId) => set({ currentTeamId: teamId }),
  setPreferredProjectView: (view) => {
    localStorage.setItem('preferredProjectView', view);
    set({ preferredProjectView: view });
  },
}));
