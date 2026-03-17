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
