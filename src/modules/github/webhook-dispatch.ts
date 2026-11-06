/** What a handler is told of the delivery it runs for */
export type GithubDeliveryContext = {
  deliveryId: string;
  event: string;
  action: string | null;
  installationId: number | null;
  repoId: number | null;
  payload: Record<string, unknown>;
};

export type GithubEventHandler = (d: GithubDeliveryContext) => Promise<'processed' | 'ignored'>;

const handlers = new Map<string, GithubEventHandler[]>();

/**
 * Registers a handler for a GitHub event. An event may have several, run in registration order.
 * A handler throws for a failure worth retrying, and answers `ignored` for a delivery that is
 * none of its business.
 * @param event The `X-GitHub-Event` name
 * @param handler Runs for each delivery of the event
 */
export function onGithubEvent(event: string, handler: GithubEventHandler): void {
  handlers.set(event, [...(handlers.get(event) ?? []), handler]);
}

/**
 * The handlers registered for an event.
 * @param event The `X-GitHub-Event` name
 * @returns Them in registration order, none for an event nobody handles
 */
export function handlersFor(event: string): readonly GithubEventHandler[] {
  return handlers.get(event) ?? [];
}
