import { useEffect, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { getAccessToken } from '@/api/client';
import { COLLAB_COLORS } from '@/components/wiki/collab-colors';
import type { PresenceUser } from '@/components/wiki/PresenceIndicators';
import { useAuthStore } from '@/stores/auth.store';

import {
  MESSAGE_ACCESS,
  MESSAGE_EXTERNAL_CHANGE,
  MESSAGE_LOCK,
  MESSAGE_SESSION_ENDED,
  parseAccess,
  parseExternalChange,
  parseLock,
  readJsonPayload,
  type PendingChange,
} from './collab-messages';

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
  /** Whether the document is in sync with the server right now */
  isSynced: boolean;
  /** Whether it has been at any time: after that a lost connection only pauses the session */
  hasSynced: boolean;
  /** List of other users currently editing */
  presenceUsers: PresenceUser[];
  /** The collaboration fragment name used by TipTap */
  fragmentName: string;
  /** An external change waiting to be merged into this session */
  pendingChange: PendingChange | null;
  /** Who merged the last pending change, until dismissed or a new change arrives */
  resolvedBy: string | null;
  /** Set while a merge swaps the content: the editor must be read-only */
  locked: { byName: string } | null;
  /** The server says this user may not edit right now */
  readOnly: boolean;
  /** The session this document belonged to ended while disconnected: call rejoin */
  sessionEnded: boolean;
  /** Start over with a new document from the server; replaces ydoc and provider */
  rejoin: () => void;
  /** Clear the "Merged by" note */
  dismissResolved: () => void;
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
  const [hasSynced, setHasSynced] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [resolvedBy, setResolvedBy] = useState<string | null>(null);
  const [locked, setLocked] = useState<{ byName: string } | null>(null);
  // Set when the server says this user may no longer edit (a permission change mid-session)
  const [readOnly, setReadOnly] = useState(false);
  const dismissResolved = useCallback(() => setResolvedBy(null), []);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [generation, setGeneration] = useState(0);
  const rejoin = useCallback(() => {
    setSessionEnded(false);
    setGeneration((g) => g + 1);
  }, []);

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

  const [session, setSession] = useState<{ ydoc: Y.Doc; provider: WebsocketProvider } | null>(null);
  const ydoc = session?.ydoc ?? null;
  const provider = session?.provider ?? null;

  // The document and provider belong to one run of this effect, which alone cleans them up: a
  // render can be thrown away, and StrictMode runs an effect twice with a cleanup in between
  useEffect(() => {
    if (!enabled || !pageId || !user) return;

    const token = getAccessToken();
    if (!token) return;

    const newYdoc = new Y.Doc();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${window.location.host}/ws/wiki`;

    const newProvider = new WebsocketProvider(serverUrl, pageId, newYdoc, {
      // Below, once the messages have their handlers and the listeners are on
      connect: false,
      params: { token },
      // Everything goes through the server. Tabs talking directly would feed the document of an
      // ended session into a new one, which is the doubling the server refuses it for.
      disableBc: true,
    });

    // Server state messages, registered before the first message can arrive. y-websocket and
    // BroadcastChannel peers may deliver a bare message with no payload: readJsonPayload gives null.
    newProvider.messageHandlers[MESSAGE_EXTERNAL_CHANGE] = (_encoder, decoder) => {
      const message = parseExternalChange(readJsonPayload(decoder));
      if (!message) return;
      if (message.state === 'pending') {
        const { state: _state, ...change } = message;
        setPendingChange(change);
        setResolvedBy(null);
      } else {
        setPendingChange(null);
        setResolvedBy(message.byName);
      }
    };
    newProvider.messageHandlers[MESSAGE_LOCK] = (_encoder, decoder) => {
      const message = parseLock(readJsonPayload(decoder));
      if (!message) return;
      // Render now, not on the next tick, so the editor is read-only before any further keystroke
      flushSync(() => setLocked(message.locked ? { byName: message.byName } : null));
    };
    newProvider.messageHandlers[MESSAGE_ACCESS] = (_encoder, decoder) => {
      const message = parseAccess(readJsonPayload(decoder));
      if (!message) return;
      // Read-only before any further keystroke
      flushSync(() => setReadOnly(!message.canEdit));
    };

    newProvider.messageHandlers[MESSAGE_SESSION_ENDED] = () => {
      // No reconnecting with this document: the server would only refuse it again
      newProvider.disconnect();
      setSessionEnded(true);
    };

    // Set local awareness state with user info
    const myColor = getMyColor();
    newProvider.awareness.setLocalStateField('user', {
      name: user.displayName ?? user.username,
      color: myColor,
      userId: user.id,
    });

    // Listen for connection status changes. A fresh connection replays the lock and pending state,
    // so whatever this client knew from the previous connection is dropped first.
    const onStatus = (event: { status: string }) => {
      if (event.status === 'connected') {
        setLocked(null);
        setPendingChange(null);
        // The server sends this connection's edit access after it joins
        setReadOnly(false);
      }
      setIsConnected(event.status === 'connected');
    };
    newProvider.on('status', onStatus);

    const onSync = (synced: boolean) => {
      setIsSynced(synced);
      if (synced) setHasSynced(true);
    };
    newProvider.on('sync', onSync);

    // Track awareness (other users' presence)
    const updatePresence = () => {
      const states = newProvider.awareness.getStates();
      const users: PresenceUser[] = [];
      const myClientId = newYdoc.clientID;

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

    newProvider.awareness.on('change', updatePresence);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session exists from here on
    setSession({ ydoc: newYdoc, provider: newProvider });
    newProvider.connect();

    return () => {
      newProvider.awareness.off('change', updatePresence);
      newProvider.off('status', onStatus);
      newProvider.off('sync', onSync);
      newProvider.disconnect();
      newProvider.destroy();
      newYdoc.destroy();
      setSession(null);
      setIsConnected(false);
      setIsSynced(false);
      setHasSynced(false);
      setPresenceUsers([]);
      setPendingChange(null);
      setResolvedBy(null);
      setLocked(null);
    };
    // generation: a rejoin needs a new document
  }, [pageId, enabled, user, generation, getMyColor]);

  return {
    ydoc,
    provider,
    isConnected,
    isSynced,
    hasSynced,
    presenceUsers,
    fragmentName,
    pendingChange,
    resolvedBy,
    // A merge in progress (with the merger's name)
    locked,
    // This user may not edit right now: a permission change, or view-only access
    readOnly,
    sessionEnded,
    rejoin,
    dismissResolved,
  };
}
