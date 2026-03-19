import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { RealtimeEvent } from './useRealtimeInvalidation';

import { getAccessToken } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';
type EventCallback = (event: RealtimeEvent) => void;

/**
 * Singleton WebSocket manager.
 * Maintains one shared connection across all hook consumers.
 * Handles automatic reconnection with exponential backoff (max 30s).
 */
let ws: WebSocket | null = null;
let state: ConnectionState = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30_000;
const listeners = new Set<EventCallback>();
const subscribedRooms = new Set<string>();
const stateListeners = new Set<() => void>();

function notifyStateListeners(): void {
  for (const cb of stateListeners) cb();
}

function subscribeToState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

function getStateSnapshot(): ConnectionState {
  return state;
}

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getAccessToken();
  return `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token ?? '')}`;
}

function sendJson(data: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const token = getAccessToken();
  if (!token) return;

  state = 'connecting';
  notifyStateListeners();
  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    state = 'connected';
    notifyStateListeners();
    reconnectAttempt = 0;

    // Re-subscribe to any rooms we had before reconnect
    if (subscribedRooms.size > 0) {
      sendJson({ type: 'subscribe', rooms: Array.from(subscribedRooms) });
    }
  };

  ws.onmessage = (ev) => {
    try {
      const event = JSON.parse(ev.data as string) as RealtimeEvent;
      for (const cb of listeners) {
        cb(event);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    state = 'disconnected';
    notifyStateListeners();
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (!getAccessToken()) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
  reconnectAttempt++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  subscribedRooms.clear();

  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  state = 'disconnected';
  notifyStateListeners();
}

/**
 * Subscribe to rooms. Sends subscribe message immediately if connected,
 * otherwise queues for reconnect.
 * @param rooms
 */
export function subscribe(rooms: string[]): void {
  for (const r of rooms) subscribedRooms.add(r);
  sendJson({ type: 'subscribe', rooms });
}

/**
 * Unsubscribe from rooms.
 * @param rooms
 */
export function unsubscribe(rooms: string[]): void {
  for (const r of rooms) subscribedRooms.delete(r);
  sendJson({ type: 'unsubscribe', rooms });
}

/**
 * Register a listener for realtime events.
 * Returns an unsubscribe function.
 * @param callback
 */
export function onEvent(callback: EventCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Get the current connection state.
 */
export function getConnectionState(): ConnectionState {
  return state;
}

/**
 * React hook that manages the singleton WebSocket lifecycle.
 * Should be called once near the top of the component tree (after auth).
 * Connects on mount when authenticated, disconnects on logout.
 * @returns Object with subscribe, unsubscribe, onEvent functions and connection state.
 */
export function useWebSocket(): {
  subscribe: typeof subscribe;
  unsubscribe: typeof unsubscribe;
  onEvent: typeof onEvent;
  state: ConnectionState;
} {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const mountedRef = useRef(false);
  const connectionState = useSyncExternalStore(subscribeToState, getStateSnapshot);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnect();
      return;
    }

    if (!mountedRef.current) {
      mountedRef.current = true;
      connect();
    }

    return () => {
      // Only disconnect if truly unmounting (not just re-render)
      // The singleton persists across component re-renders
    };
  }, [isAuthenticated]);

  // Disconnect on full unmount (e.g. logout)
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return {
    subscribe,
    unsubscribe,
    onEvent,
    state: connectionState,
  };
}

/**
 * Hook to listen for specific realtime events.
 * @param callback
 */
export function useRealtimeListener(callback: EventCallback): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const handler: EventCallback = (event) => callbackRef.current(event);
    return onEvent(handler);
  }, []);
}
