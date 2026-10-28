import { describe, expect, it } from "vitest";
import {
  appendUnique,
  createRequestGuard,
  offsetPage,
  pageOptions,
} from "../src/lib/pagination";

describe("collection pages and request ownership", () => {
  it("uses an extra record to distinguish a full final page from a page with successors", () => {
    expect(offsetPage([1, 2, 3], { offset: 0, limit: 3 })).toEqual({
      items: [1, 2, 3],
      hasMore: false,
      nextOffset: null,
    });
    expect(offsetPage([4, 5, 6, 7], { offset: 3, limit: 3 })).toEqual({
      items: [4, 5, 6],
      hasMore: true,
      nextOffset: 6,
    });
  });
  it.each([
    { offset: -1 },
    { offset: NaN },
    { offset: 1.5 },
    { limit: 0 },
    { limit: 101 },
    { limit: Infinity },
  ])("rejects invalid database range %j", (value) => {
    expect(() => pageOptions(value)).toThrow();
  });
  it("updates overlapping records after concurrent inserts instead of duplicating rows", () => {
    const first = [
      { id: "a", read: false },
      { id: "b", read: false },
    ];
    const next = [
      { id: "b", read: true },
      { id: "c", read: false },
    ];
    expect(appendUnique(first, next, (row) => row.id)).toEqual([
      { id: "a", read: false },
      { id: "b", read: true },
      { id: "c", read: false },
    ]);
    expect(first[1].read).toBe(false);
  });
  it("prevents an older search response from replacing a newer query", async () => {
    const guard = createRequestGuard();
    const results: string[] = [];
    let releaseOld!: (value: string) => void;
    let releaseNew!: (value: string) => void;
    const old = new Promise<string>((resolve) => {
      releaseOld = resolve;
    });
    const newer = new Promise<string>((resolve) => {
      releaseNew = resolve;
    });
    const oldCurrent = guard.begin();
    const oldCommit = old.then((value) => {
      if (oldCurrent()) results.push(value);
    });
    const newCurrent = guard.begin();
    const newCommit = newer.then((value) => {
      if (newCurrent()) results.push(value);
    });
    releaseNew("current workspace");
    await newCommit;
    releaseOld("previous workspace");
    await oldCommit;
    expect(results).toEqual(["current workspace"]);
  });
  it("invalidates a pending response on close/unmount and keeps independent collection loads independent", () => {
    const saved = createRequestGuard();
    const scheduled = createRequestGuard();
    const savedCurrent = saved.begin();
    const scheduledCurrent = scheduled.begin();
    saved.invalidate();
    expect(savedCurrent()).toBe(false);
    expect(scheduledCurrent()).toBe(true);
    scheduled.invalidate();
    expect(scheduledCurrent()).toBe(false);
  });
});
