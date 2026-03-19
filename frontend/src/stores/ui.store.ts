import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  searchOpen: boolean;
  currentOrgId: string | null;
  currentTeamId: string | null;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setCurrentOrg: (orgId: string | null) => void;
  setCurrentTeam: (teamId: string | null) => void;
}

/**
 * Global UI state store for sidebar, search, and active navigation context.
 * Provides toggle and setter actions for sidebar visibility,
 * command palette search, and current org/team selection.
 */
export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  searchOpen: false,
  currentOrgId: null,
  currentTeamId: null,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setCurrentOrg: (orgId) => set({ currentOrgId: orgId }),
  setCurrentTeam: (teamId) => set({ currentTeamId: teamId }),
}));
