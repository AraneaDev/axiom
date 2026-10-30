import { configure, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/api/client', () => ({ getAccessToken: () => 'test-token' }));
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: true }),
}));

/** Minimal browser WebSocket stand-in that records every instance and what it sent. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

import { subscribe, useWebSocket } from './useWebSocket';

describe('useWebSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => {
    configure({ reactStrictMode: false });
    vi.unstubAllGlobals();
  });

  it('sends subscriptions on a live socket after StrictMode mounts twice', () => {
    // Dev builds run under StrictMode, which mounts, unmounts and remounts every effect
    configure({ reactStrictMode: true });
    const { unmount } = renderHook(() => useWebSocket());
    subscribe(['project:proj-1']);

    // Every socket the hook opened has connected by now; exactly one is still in use
    for (const s of [...FakeSocket.instances]) s.open();
    const frames = FakeSocket.instances.flatMap((s) =>
      s.readyState === FakeSocket.OPEN ? s.sent : [],
    );
    expect(frames).toContain(JSON.stringify({ type: 'subscribe', rooms: ['project:proj-1'] }));
    expect(FakeSocket.instances.filter((s) => s.readyState === FakeSocket.OPEN)).toHaveLength(1);

    unmount();
    expect(FakeSocket.instances.every((s) => s.readyState === FakeSocket.CLOSED)).toBe(true);
  });

  it('keeps a room after a check error and asks again on reconnect, but drops a denied one', () => {
    configure({ reactStrictMode: false });
    const { unmount } = renderHook(() => useWebSocket());
    subscribe(['project:flaky', 'project:forbidden']);
    const first = FakeSocket.instances.at(-1)!;
    first.open();

    first.onmessage?.({ data: JSON.stringify({ type: 'subscribe:error', room: 'project:flaky' }) });
    first.onmessage?.({
      data: JSON.stringify({ type: 'subscribe:denied', room: 'project:forbidden' }),
    });

    // The connection drops; the reconnect resubscribes what the client still wants
    vi.useFakeTimers();
    first.close();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    const second = FakeSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.open();
    expect(second.sent).toEqual([JSON.stringify({ type: 'subscribe', rooms: ['project:flaky'] })]);
    unmount();
  });
});
