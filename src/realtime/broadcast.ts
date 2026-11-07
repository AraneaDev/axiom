import { WebSocket } from 'ws';

import type { RealtimeEvent } from './events';
import { publishHook } from './publish-hook';
import { getClients } from './ws-server';

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  rooms: Set<string>;
  isAlive: boolean;
}

/**
 * Broadcast an event to all clients subscribed to a given room.
 * In the worker the event is published through the bridge instead, so a browser
 * hears it from the API. Room naming convention: `project:{id}`, `space:{id}`, `user:{id}`
 * @param room
 * @param event
 */
export function broadcastToRoom(room: string, event: RealtimeEvent): void {
  // The worker has no sockets: it publishes and the API processes broadcast what arrives
  const publish = publishHook();
  if (publish) {
    publish(room, event);
    return;
  }
  broadcastLocal(room, event);
}

/**
 * Broadcast an event to the sockets of this process only, never through the bridge. What the
 * bridge delivers goes this way, so a received event is not published again.
 * @param room
 * @param event
 */
export function broadcastLocal(room: string, event: RealtimeEvent): void {
  const payload = JSON.stringify(event);

  for (const client of getClients() as Set<AuthenticatedSocket>) {
    if (client.readyState === WebSocket.OPEN && client.rooms.has(room)) {
      client.send(payload);
    }
  }
}

/**
 * Broadcast an event to all connections belonging to a specific user.
 * Sends to `user:{userId}` room automatically.
 * @param userId
 * @param event
 */
export function broadcastToUser(userId: string, event: RealtimeEvent): void {
  broadcastToRoom(`user:${userId}`, event);
}
