import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCollectionQueries } from "../src/lib/relay/collections";

const workspace = "00000000-0000-4000-8000-000000000001";
const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
type Row = Record<string, unknown>;
function backend(rows: Record<string, Row[]>, platformLimit = Infinity) {
  const calls: {
    table: string;
    selected: string;
    range?: [number, number];
    filters: [string, string, unknown][];
    order: [string, boolean][];
  }[] = [];
  const state = { failAtCall: -1 };
  class Query {
    call: (typeof calls)[number];
    maximum = Infinity;
    constructor(table: string) {
      this.call = { table, selected: "", filters: [], order: [] };
      calls.push(this.call);
    }
    select(value: string) {
      this.call.selected = value;
      return this;
    }
    eq(field: string, value: unknown) {
      this.call.filters.push(["eq", field, value]);
      return this;
    }
    is(field: string, value: unknown) {
      this.call.filters.push(["eq", field, value]);
      return this;
    }
    gt(field: string, value: unknown) {
      this.call.filters.push(["gt", field, value]);
      return this;
    }
    ilike(field: string, value: string) {
      this.call.filters.push(["ilike", field, value]);
      return this;
    }
    order(field: string, options: { ascending: boolean }) {
      this.call.order.push([field, options.ascending]);
      return this;
    }
    range(start: number, end: number) {
      this.call.range = [start, end];
      return this;
    }
    limit(maximum: number) {
      this.maximum = maximum;
      return this;
    }
    result() {
      if (calls.indexOf(this.call) === state.failAtCall)
        return {
          data: null,
          error: { message: "Page request failed", code: "TEST" },
        };
      const data = (rows[this.call.table] ?? [])
        .filter((row) =>
          this.call.filters.every(([operation, field, expected]) => {
            if (operation === "gt")
              return String(row[field]) > String(expected);
            if (operation === "ilike")
              return String(row[field])
                .toLowerCase()
                .includes(String(expected).replaceAll("%", "").toLowerCase());
            return row[field] === expected;
          }),
        )
        .sort((a, b) => {
          for (const [field, ascending] of this.call.order) {
            const comparison = String(a[field]).localeCompare(String(b[field]));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
      const [start, end] = this.call.range ?? [0, this.maximum - 1];
      return {
        data: data.slice(start, Math.min(end + 1, start + platformLimit)),
        error: null,
      };
    }
    then<TResult1 = ReturnType<Query["result"]>, TResult2 = never>(
      resolve?:
        | ((
            value: ReturnType<Query["result"]>,
          ) => TResult1 | PromiseLike<TResult1>)
        | null,
      reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }
  const client = {
    from: (table: string) => new Query(table),
  } as unknown as SupabaseClient;
  return { service: createCollectionQueries(() => client), calls, state };
}

describe("paginated PostgREST collection boundaries", () => {
  it("loads all file pages in deterministic timestamp/id order and requests one sentinel", async () => {
    const rows = Array.from({ length: 65 }, (_, n) => ({
      id: id(n + 1),
      created_at: "2026-10-29T00:00:00Z",
      "conversation.workspace_id": workspace,
    }));
    const { service, calls } = backend({ attachments: rows });
    const first = await service.filesPage(workspace, "", { limit: 30 });
    const second = await service.filesPage(workspace, "", {
      limit: 30,
      offset: first.nextOffset!,
    });
    const third = await service.filesPage(workspace, "", {
      limit: 30,
      offset: second.nextOffset!,
    });
    expect([
      first.items.length,
      second.items.length,
      third.items.length,
    ]).toEqual([30, 30, 5]);
    expect(third.hasMore).toBe(false);
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map((row) => row.id),
      ).size,
    ).toBe(65);
    expect(calls.map((call) => call.range)).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
    expect(calls[0].order).toEqual([
      ["created_at", false],
      ["id", false],
    ]);
  });
  it("scans saved identifiers beyond both old100 and platform1000 caps, including a lower server row cap", async () => {
    const rows = Array.from({ length: 1205 }, (_, n) => ({
      message_id: id(n + 1),
      "message.conversation.workspace_id": workspace,
    }));
    const { service, calls } = backend({ saved_messages: rows }, 137);
    const result = await service.savedIds(workspace);
    expect(result).toHaveLength(1205);
    expect(new Set(result).size).toBe(1205);
    expect(calls.length).toBe(10);
    expect(calls[0].selected).not.toContain("body");
    expect(calls[1].filters).toContainEqual(["gt", "message_id", id(137)]);
    expect(
      calls.every((call) =>
        call.filters.some(
          ([, field, value]) =>
            field === "message.conversation.workspace_id" &&
            value === workspace,
        ),
      ),
    ).toBe(true);
  });
  it("surfaces a failed later identifier page instead of silently returning a partial saved set", async () => {
    const { service, state } = backend({
      saved_messages: Array.from({ length: 700 }, (_, n) => ({
        message_id: id(n),
        "message.conversation.workspace_id": workspace,
      })),
    });
    state.failAtCall = 1;
    await expect(service.savedIds(workspace)).rejects.toThrow(
      "Page request failed",
    );
  });
  it("preserves authorized workspace filters on saved/activity/scheduled pagination", async () => {
    const { service, calls } = backend({});
    await service.savedPage(workspace, { offset: 30, limit: 30 });
    await service.notificationsPage(workspace, { offset: 30 });
    await service.scheduledPage(workspace);
    expect(calls[0].filters).toContainEqual([
      "eq",
      "message.conversation.workspace_id",
      workspace,
    ]);
    expect(calls[1].filters).toContainEqual(["eq", "workspace_id", workspace]);
    expect(calls[2].filters).toContainEqual([
      "eq",
      "conversation.workspace_id",
      workspace,
    ]);
    expect(calls[2].filters).toContainEqual(["eq", "sent_at", null]);
  });
  it("treats filename underscores and percent signs as literal characters rather than unbounded search wildcards", async () => {
    const { service, calls } = backend({});
    await service.filesPage(workspace, "report_100%.txt");
    expect(calls[0].filters).toContainEqual([
      "ilike",
      "name",
      "%report\\_100\\%.txt%",
    ]);
    await expect(service.filesPage(workspace, "x".repeat(201))).rejects.toThrow(
      "200 characters",
    );
  });
  it("rejects malformed ranges before issuing a database request", async () => {
    const { service, calls } = backend({});
    await expect(
      service.filesPage(workspace, "", { offset: -1 }),
    ).rejects.toThrow("offset");
    expect(calls).toHaveLength(0);
  });
});
