export interface EpochChannelContext {
  isCurrent(): boolean;
  rekey(): void;
}
export interface EpochSubscriptionOptions<Channel> {
  resolveTopic(): Promise<string | null>;
  connect(topic: string, context: EpochChannelContext): Channel;
  disconnect(channel: Channel): unknown;
  onResolving?(): void;
  onDenied(): void;
  onError(error: unknown): void;
}

/** Owns async authorization and socket generations. No stale generation may commit. */
export function createEpochSubscription<Channel>(
  options: EpochSubscriptionOptions<Channel>,
) {
  let closed = false;
  let generation = 0;
  let channel: Channel | undefined;
  const dispose = (value: Channel) => {
    try {
      void Promise.resolve(options.disconnect(value)).catch(() => {});
    } catch {
      /* best-effort socket disposal */
    }
  };
  const detach = () => {
    const previous = channel;
    channel = undefined;
    if (previous !== undefined) dispose(previous);
  };
  const refresh = async () => {
    if (closed) return;
    const ticket = ++generation;
    const isCurrent = () => !closed && ticket === generation;
    detach();
    options.onResolving?.();
    try {
      const topic = await options.resolveTopic();
      if (!isCurrent()) return;
      if (!topic) {
        options.onDenied();
        return;
      }
      const created = options.connect(topic, {
        isCurrent,
        rekey: () => {
          if (isCurrent()) void refresh();
        },
      });
      if (isCurrent()) channel = created;
      else dispose(created);
    } catch (error) {
      if (isCurrent()) options.onError(error);
    }
  };
  return {
    refresh,
    unsubscribe() {
      if (closed) return;
      closed = true;
      generation += 1;
      detach();
    },
  };
}
