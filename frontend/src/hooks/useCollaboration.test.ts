import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (encoder: unknown, decoder: { arr: Uint8Array; pos: number }) => void;

const providers: FakeProvider[] = [];

class FakeProvider {
  messageHandlers: Handler[] = [];
  listeners: Record<string, ((arg: unknown) => void)[]> = {};
  awareness = {
    setLocalStateField: vi.fn(),
    getLocalState: () => null,
    getStates: () => new Map(),
    on: vi.fn(),
    off: vi.fn(),
  };
  connect = vi.fn();
  constructor(public options?: unknown) {
    providers.push(this);
  }
  on(event: string, fn: (arg: unknown) => void) {
    (this.listeners[event] ??= []).push(fn);
  }
  off() {}
  emit(event: string, arg: unknown) {
    for (const fn of this.listeners[event] ?? []) fn(arg);
  }
  disconnect() {}
  destroy() {}
}

vi.mock('y-websocket', () => ({
  WebsocketProvider: function (_url: string, _room: string, _doc: unknown, options: unknown) {
    return new FakeProvider(options);
  },
}));
vi.mock('@/api/client', () => ({ getAccessToken: () => 'token' }));
vi.mock('@/stores/auth.store', () => {
  const user = { id: 'u1', username: 'tim', displayName: 'Tim' };
  return { useAuthStore: (select: (s: unknown) => unknown) => select({ user }) };
});

import { useCollaboration } from './useCollaboration';

/**
 * Deliver a message the way y-websocket's readMessage does: type read, decoder after it
 * @param provider
 * @param type
 * @param payload
 */
function deliver(provider: FakeProvider, type: number, payload?: unknown) {
  const bytes: number[] = [type];
  if (payload !== undefined) {
    const text = new TextEncoder().encode(JSON.stringify(payload));
    let n = text.length;
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 0x80);
    }
    bytes.push(n, ...text);
  }
  act(() => provider.messageHandlers[type]({}, { arr: new Uint8Array(bytes), pos: 1 }));
}

const pending = {
  state: 'pending',
  externalVersionId: 'ext-1',
  authorName: 'Agent',
  at: '2026-10-29T10:00:00.000Z',
  kind: 'EXTERNAL',
};

describe('useCollaboration state messages', () => {
  beforeEach(() => {
    providers.length = 0;
  });

  it('tracks pending, resolved and lock messages', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];

    deliver(provider, 20, pending);
    expect(result.current.pendingChange).toMatchObject({ externalVersionId: 'ext-1' });

    deliver(provider, 21, { locked: true, byName: 'Tim' });
    expect(result.current.locked).toEqual({ byName: 'Tim' });

    deliver(provider, 20, { state: 'resolved', byName: 'Tim' });
    expect(result.current.pendingChange).toBeNull();
    expect(result.current.resolvedBy).toBe('Tim');

    deliver(provider, 21, { locked: false, byName: 'Tim' });
    expect(result.current.locked).toBeNull();
  });

  it('ignores bare messages with no payload', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];
    deliver(provider, 20, pending);
    deliver(provider, 20);
    deliver(provider, 21);
    expect(result.current.pendingChange).toMatchObject({ externalVersionId: 'ext-1' });
    expect(result.current.locked).toBeNull();
  });

  it('remembers that it synced once, through a lost connection', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];
    expect(result.current.hasSynced).toBe(false);
    act(() => provider.emit('sync', true));
    expect(result.current.hasSynced).toBe(true);
    act(() => provider.emit('sync', false));
    expect(result.current.isSynced).toBe(false);
    expect(result.current.hasSynced).toBe(true);
  });

  it('connects from the effect, through the server only', () => {
    renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers.at(-1)!;
    expect(provider.options).toMatchObject({ connect: false, disableBc: true });
    expect(provider.connect).toHaveBeenCalled();
  });

  it('stops reconnecting when its session has ended, and rejoins with a new document', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];
    const firstDoc = result.current.ydoc;
    const disconnect = vi.spyOn(provider, 'disconnect');
    act(() => provider.messageHandlers[23]({}, { arr: new Uint8Array([23]), pos: 1 }));
    expect(disconnect).toHaveBeenCalled();
    expect(result.current.sessionEnded).toBe(true);
    act(() => result.current.rejoin());
    expect(result.current.sessionEnded).toBe(false);
    expect(providers).toHaveLength(2);
    expect(result.current.ydoc).not.toBe(firstDoc);
  });

  it('a new connection drops the previous lock and pending state', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];
    deliver(provider, 20, pending);
    deliver(provider, 21, { locked: true, byName: 'Tim' });
    act(() => provider.emit('status', { status: 'connected' }));
    expect(result.current.pendingChange).toBeNull();
    expect(result.current.locked).toBeNull();
    expect(result.current.isConnected).toBe(true);
  });

  it('15, N6: lost edit access is a read-only state, not a merge lock, and clears on reconnect', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];
    deliver(provider, 22, { canEdit: false });
    expect(result.current.readOnly).toBe(true);
    expect(result.current.locked).toBeNull();

    act(() => provider.emit('status', { status: 'connected' }));
    expect(result.current.readOnly).toBe(false);

    deliver(provider, 22, { canEdit: false });
    deliver(provider, 22, { canEdit: true });
    expect(result.current.readOnly).toBe(false);
  });
});
