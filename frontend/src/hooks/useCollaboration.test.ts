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
  constructor() {
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
  WebsocketProvider: function (this: unknown) {
    return new FakeProvider();
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

  it('15: a lost-edit notice is dropped on reconnect and when access comes back', () => {
    const { result } = renderHook(() => useCollaboration({ pageId: 'p1' }));
    const provider = providers[0];
    deliver(provider, 22, { canEdit: false });
    expect(result.current.locked).toEqual({ byName: '' });

    act(() => provider.emit('status', { status: 'connected' }));
    expect(result.current.locked).toBeNull();

    deliver(provider, 22, { canEdit: false });
    deliver(provider, 22, { canEdit: true });
    expect(result.current.locked).toBeNull();
  });
});
