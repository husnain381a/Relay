import { expect, it } from "vitest";
import {
  createEpochSubscription,
  type EpochChannelContext,
} from "../src/lib/realtime-epoch";
it("ignores authorization that resolves after unsubscribe", async () => {
  let resolve!: (v: string | null) => void;
  let connections = 0;
  const value = createEpochSubscription<number>({
    resolveTopic: () =>
      new Promise((r) => {
        resolve = r;
      }),
    connect: () => ++connections,
    disconnect: () => {},
    onDenied: () => {},
    onError: () => {},
  });
  const running = value.refresh();
  value.unsubscribe();
  resolve("new-topic");
  await running;
  expect(connections).toBe(0);
});
it("prevents old topic callbacks and reauthorizes on rekey", async () => {
  let epoch = 1;
  const contexts: EpochChannelContext[] = [];
  const removed: number[] = [];
  const value = createEpochSubscription<number>({
    resolveTopic: async () => `topic:${epoch++}`,
    connect: (_topic, context) => {
      contexts.push(context);
      return contexts.length;
    },
    disconnect: (id) => {
      removed.push(id);
    },
    onDenied: () => {},
    onError: () => {},
  });
  await value.refresh();
  expect(contexts[0].isCurrent()).toBe(true);
  contexts[0].rekey();
  await Promise.resolve();
  await Promise.resolve();
  expect(contexts[0].isCurrent()).toBe(false);
  expect(contexts[1].isCurrent()).toBe(true);
  expect(removed).toEqual([1]);
  value.unsubscribe();
  expect(contexts[1].isCurrent()).toBe(false);
});
it("denied authorization disconnects the existing channel and never joins a replacement", async () => {
  let topic: string | null = "allowed";
  let connected = 0;
  let denied = 0;
  const removed: number[] = [];
  const value = createEpochSubscription<number>({
    resolveTopic: async () => topic,
    connect: () => ++connected,
    disconnect: (id) => {
      removed.push(id);
    },
    onDenied: () => {
      denied++;
    },
    onError: () => {},
  });
  await value.refresh();
  topic = null;
  await value.refresh();
  expect(connected).toBe(1);
  expect(removed).toEqual([1]);
  expect(denied).toBe(1);
});
it("a later authorization result owns the connection when earlier requests finish out of order", async () => {
  const resolves: ((v: string | null) => void)[] = [];
  const connected: string[] = [];
  const value = createEpochSubscription<string>({
    resolveTopic: () => new Promise((r) => resolves.push(r)),
    connect: (topic) => {
      connected.push(topic);
      return topic;
    },
    disconnect: () => {},
    onDenied: () => {},
    onError: () => {},
  });
  const old = value.refresh(),
    current = value.refresh();
  resolves[1]("current");
  await current;
  resolves[0]("stale");
  await old;
  expect(connected).toEqual(["current"]);
  value.unsubscribe();
});
