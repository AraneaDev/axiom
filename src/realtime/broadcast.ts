import { WebSocket } from 'ws';

import type { RealtimeEvent } from './events';
import { getClients } from './ws-server';

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  rooms: Set<string>;
  isAlive: boolean;
}

/**
 * Broadcast an event to all clients subscribed to a given room.
 * Room naming convention: `project:{id}`, `repo:{id}`, `space:{id}`, `user:{id}`
 * @param room
 * @param event
 */
export function broadcastToRoom(room: string, event: RealtimeEvent): void {
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
