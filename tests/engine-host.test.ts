import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DiskCache } from "../src/main/cache.ts";
import { EngineHost } from "../src/main/engine-host.ts";

class FakeSession {
  static opened = 0;
  static closed = 0;
  webContents: object | null = null;
  async enter(): Promise<this> {
    FakeSession.opened += 1;
    this.webContents = {};
    return this;
  }
  async exit(): Promise<void> {
    FakeSession.closed += 1;
    this.webContents = null;
  }
}

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};

describe("one hidden window for every school site", () => {
  test("navigating jobs take turns, cookie jobs overlap them, and all share one window", async () => {
    FakeSession.opened = FakeSession.closed = 0;
    const host = new EngineHost(() => new FakeSession(), 60_000);
    const order: string[] = [];
    const first = gate();
    const started = gate();
    const a = host.exclusive(async (s) => {
      order.push("a-start");
      started.open();
      await first.opened;
      order.push("a-end");
      return s;
    });
    const b = host.exclusive(async (s) => {
      order.push("b");
      return s;
    });
    await started.opened;
    const shared = await host.shared(async (s) => {
      order.push("shared");
      return s;
    });
    first.open();
    const [sa, sb] = await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "shared", "a-end", "b"]);
    expect(sa).toBe(sb);
    expect(sa).toBe(shared);
    expect(FakeSession.opened).toBe(1);
    await host.close();
  });

  test("the window closes when idle and opens again for the next job", async () => {
    FakeSession.opened = FakeSession.closed = 0;
    const host = new EngineHost(() => new FakeSession(), 60_000);
    const held = gate();
    const job = host.exclusive(() => held.opened);
    await Promise.resolve();
    await host.close();
    expect(FakeSession.closed).toBe(0);
    held.open();
    await job;
    await host.close();
    expect(FakeSession.closed).toBe(1);
    expect(host.isOpen).toBe(false);
    await host.shared(async () => undefined);
    expect(FakeSession.opened).toBe(2);
    await host.close();
  });
});

describe("last school data on disk", () => {
  test("reads back what it wrote, ignores another format, and clears on logout", () => {
    const dir = mkdtempSync(join(tmpdir(), "kur-cache-"));
    const path = join(dir, "cache.json");
    try {
      const cache = new DiskCache<{ courses: string[] }>(path, 1);
      cache.write({ courses: ["가짜 과목"] });
      cache.flush();
      expect(new DiskCache<{ courses: string[] }>(path, 1).read()).toEqual({ courses: ["가짜 과목"] });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(new DiskCache(path, 2).read()).toBeNull();
      cache.clear();
      expect(cache.read()).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
