import { useEffect, useMemo, useState, useCallback } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { getAccessToken } from '@/api/client';
import { COLLAB_COLORS } from '@/components/wiki/collab-colors';
import type { PresenceUser } from '@/components/wiki/PresenceIndicators';
import { useAuthStore } from '@/stores/auth.store';

interface UseCollaborationOptions {
  /** The wiki page ID to collaborate on */
  pageId: string | undefined;
  /** Whether collaboration should be enabled */
  enabled?: boolean;
}

interface UseCollaborationReturn {
  /** The Yjs document for TipTap collaboration */
  ydoc: Y.Doc | null;
  /** The y-websocket provider instance */
  provider: WebsocketProvider | null;
  /** Whether the provider is connected and synced */
  isConnected: boolean;
  /** Whether the initial sync has completed */
  isSynced: boolean;
  /** List of other users currently editing */
  presenceUsers: PresenceUser[];
  /** The collaboration fragment name used by TipTap */
  fragmentName: string;
}

/**
 * Hook to manage real-time collaborative editing for wiki pages.
 * Creates a Yjs document and connects via y-websocket to the server.
 * Manages user awareness (presence indicators) and connection state.
 * Falls back gracefully if the WebSocket connection fails.
 * @param options - Collaboration configuration.
 * @param options.pageId - The wiki page ID to collaborate on.
 * @param options.enabled - Whether collaboration should be active. Defaults to true.
 * @returns Yjs document, provider, connection/sync state, presence users, and fragment name.
 */
export function useCollaboration({
  pageId,
  enabled = true,
}: UseCollaborationOptions): UseCollaborationReturn {
  const user = useAuthStore((s) => s.user);

  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

  const fragmentName = 'default';

  // Assign a consistent color based on user ID
  const getMyColor = useCallback(() => {
    if (!user) return COLLAB_COLORS[0];
    let hash = 0;
    for (let i = 0; i < user.id.length; i++) {
      hash = user.id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
  }, [user]);

  // Create ydoc and provider synchronously so they are available during render
  const { ydoc, provider } = useMemo(() => {
    if (!enabled || !pageId || !user) {
      return { ydoc: null, provider: null };
    }

    const token = getAccessToken();
    if (!token) {
      return { ydoc: null, provider: null };
    }

    const newYdoc = new Y.Doc();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${window.location.host}/ws/wiki`;

    const newProvider = new WebsocketProvider(serverUrl, pageId, newYdoc, {
      connect: true,
      params: { token },
    });

    return { ydoc: newYdoc, provider: newProvider };
  }, [pageId, enabled, user]);

  // Set up awareness, listeners, and cleanup in an effect
  useEffect(() => {
    if (!provider || !ydoc || !user) return;

    // Set local awareness state with user info
    const myColor = getMyColor();
    provider.awareness.setLocalStateField('user', {
      name: user.displayName ?? user.username,
      color: myColor,
      userId: user.id,
    });

    // Listen for connection status changes
    const onStatus = (event: { status: string }) => {
      setIsConnected(event.status === 'connected');
    };
    provider.on('status', onStatus);

    const onSync = (synced: boolean) => {
      setIsSynced(synced);
    };
    provider.on('sync', onSync);

    // Track awareness (other users' presence)
    const updatePresence = () => {
      const states = provider.awareness.getStates();
      const users: PresenceUser[] = [];
      const myClientId = ydoc.clientID;

      states.forEach((state, clientId) => {
        if (clientId !== myClientId && state.user) {
          users.push({
            clientId,
            name: state.user.name ?? 'Unknown',
            color: state.user.color ?? COLLAB_COLORS[0],
          });
        }
      });

      setPresenceUsers(users);
    };

    provider.awareness.on('change', updatePresence);

    return () => {
      provider.awareness.off('change', updatePresence);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
      setIsConnected(false);
      setIsSynced(false);
      setPresenceUsers([]);
    };
  }, [provider, ydoc, user, getMyColor]);

  return {
    ydoc,
    provider,
    isConnected,
    isSynced,
    presenceUsers,
    fragmentName,
  };
}
