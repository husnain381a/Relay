import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueries } from "../src/lib/relay/queries";
import type { Message } from "../src/lib/types";

const conversationId = "00000000-0000-4000-8000-000000000001";
function message(seq: number): Message {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    conversation_id: conversationId,
    author_id: "00000000-0000-4000-8000-000000000002",
    body: `Message ${seq}`,
    parent_id: null,
    created_at: "2026-10-28T10:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    author: null,
    reactions: [],
    attachments: [],
    delivery: "sent",
  };
}

/** A deterministic PostgREST boundary fixture; authorization itself is tested by SQL. */
function backend(initial: Message[]) {
  const state = {
    rows: initial,
    authorized: true,
    pages: [] as number[],
    afterFirstCatchup: undefined as (() => void) | undefined,
  };
  class Query implements PromiseLike<{ data: unknown[]; error: null }> {
    predicates: ((value: Record<string, unknown>) => boolean)[] = [];
    sortField = "seq";
    ascending = true;
    maximum = Infinity;
    catchup = false;
    constructor(readonly table: string) {}
    select() {
      return this;
    }
    eq(field: string, value: unknown) {
      this.predicates.push((row) => row[field] === value);
      return this;
    }
    is(field: string, value: unknown) {
      return this.eq(field, value);
    }
    in(field: string, values: unknown[]) {
      this.predicates.push((row) => values.includes(row[field]));
      return this;
    }
    gt(field: string, value: number) {
      this.catchup = true;
      this.predicates.push((row) => Number(row[field]) > value);
      return this;
    }
    lte(field: string, value: number) {
      this.predicates.push((row) => Number(row[field]) <= value);
      return this;
    }
    lt(field: string, value: number) {
      this.predicates.push((row) => Number(row[field]) < value);
      return this;
    }
    order(field: string, options: { ascending: boolean }) {
      this.sortField = field;
      this.ascending = options.ascending;
      return this;
    }
    limit(maximum: number) {
      this.maximum = maximum;
      return this;
    }
    result() {
      const source =
        this.table === "conversations"
          ? state.authorized
            ? [{ id: conversationId }]
            : []
          : state.rows;
      const rows = source
        .filter((row) =>
          this.predicates.every((predicate) =>
            predicate(row as unknown as Record<string, unknown>),
          ),
        )
        .sort((a, b) => {
          const difference =
            Number((a as unknown as Record<string, unknown>)[this.sortField]) -
            Number((b as unknown as Record<string, unknown>)[this.sortField]);
          return this.ascending ? difference : -difference;
        })
        .slice(0, this.maximum);
      if (this.catchup) {
        state.pages.push(rows.length);
        const callback = state.afterFirstCatchup;
        state.afterFirstCatchup = undefined;
        callback?.();
      }
      return { data: structuredClone(rows), error: null };
    }
    maybeSingle() {
      const result = this.result();
      return Promise.resolve({ data: result.data[0] ?? null, error: null });
    }
    then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
      resolve?:
        | ((value: {
            data: unknown[];
            error: null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }
  const client = {
    from: (table: string) => new Query(table),
  } as unknown as SupabaseClient;
  return { state, service: createQueries(() => client) };
}

describe("persisted-state synchronization", () => {
  it("recovers more than one page of offline messages without losing existing history", async () => {
    const rows = Array.from({ length: 310 }, (_, index) => message(index + 1));
    const { service, state } = backend(rows);
    const result = await service.synchronizeMessages(
      conversationId,
      rows.slice(0, 50),
    );
    expect(result).toHaveLength(310);
    expect(new Set(result.map((row) => row.id)).size).toBe(310);
    expect(result.map((row) => row.seq)).toEqual(
      Array.from({ length: 310 }, (_, index) => index + 1),
    );
    expect(state.pages).toEqual([100, 100, 60]);
  });
  it("refreshes offline edits, deletions, and reactions in previously loaded pages", async () => {
    const known = [message(1), message(2), message(3)];
    const rows = structuredClone(known);
    rows[0].body = "Edited offline";
    rows[0].edited_at = "2026-10-28T10:05:00.000Z";
    rows[1].body = "";
    rows[1].deleted_at = "2026-10-28T10:06:00.000Z";
    rows[2].reactions = [
      { message_id: rows[2].id, user_id: rows[2].author_id, emoji: "👍" },
    ];
    const { service } = backend(rows);
    const result = await service.synchronizeMessages(conversationId, known);
    expect(result[0].body).toBe("Edited offline");
    expect(result[1].deleted_at).toBeTruthy();
    expect(result[2].reactions).toHaveLength(1);
  });
  it("retains failed local sends and acknowledges an interrupted send that reached the database", async () => {
    const known = [
      message(1),
      { ...message(2), delivery: "failed" as const },
      { ...message(3), delivery: "failed" as const },
    ];
    const { service } = backend([message(1), message(2)]);
    const result = await service.synchronizeMessages(conversationId, known);
    expect(result.find((row) => row.seq === 2)?.delivery).toBe("sent");
    expect(result.find((row) => row.seq === 3)?.delivery).toBe("failed");
  });
  it("bounds recovery to a captured highwater while new traffic continues", async () => {
    const rows = Array.from({ length: 210 }, (_, index) => message(index + 1));
    const { service, state } = backend(rows);
    state.afterFirstCatchup = () => {
      state.rows.push(message(211));
    };
    const result = await service.synchronizeMessages(conversationId, [
      message(1),
    ]);
    expect(result).toHaveLength(210);
    expect(result.at(-1)?.seq).toBe(210);
    const next = await service.synchronizeMessages(conversationId, result);
    expect(next).toHaveLength(211);
  });
  it("fails before retaining cached content when conversation membership was revoked", async () => {
    const { service, state } = backend([message(1)]);
    state.authorized = false;
    await expect(
      service.synchronizeMessages(conversationId, [message(1)]),
    ).rejects.toThrow("no longer have access");
    expect(state.pages).toEqual([]);
  });
});
