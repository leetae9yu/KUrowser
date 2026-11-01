import { describe, expect, test } from "bun:test";

import { classify, GatewayError, JEV_PAUSE_MS, JevGuard } from "../src/main/jev-guard.ts";
import type { Course } from "../src/renderer/data.ts";
import { courseCommand, FALLBACK_CHIPS, homeChips, outcomeFor } from "../src/renderer/commands.ts";

function setup() {
  let now = Date.parse("2026-11-01T09:30:00Z");
  const logged: unknown[] = [];
  const guard = new JevGuard((f) => logged.push(f), () => now);
  const calls = { jev: 0, luna: 0 };
  let jevFails: GatewayError | null = new GatewayError(502, "Decisions provider error");
  const sentence = () =>
    classify(
      guard,
      "jev-latest",
      async () => {
        calls.jev++;
        if (jevFails) throw jevFails;
        return { route: "jev" };
      },
      (body) => (body as { route: string }).route,
      {
        model: () => "gpt-5.6-luna",
        call: async () => {
          calls.luna++;
          return "luna";
        },
        parse: (raw) => raw,
      },
    );
  return {
    guard,
    calls,
    logged,
    sentence,
    tick: (ms: number) => (now += ms),
    jevFailsWith: (e: GatewayError | null) => (jevFails = e),
  };
}

describe("Jev outage", () => {
  test("a 502 classifies the same sentence with the chat model and records the failure", async () => {
    const t = setup();
    expect(await t.sentence()).toEqual({ route: "luna", via: "luna" });
    expect(t.calls).toEqual({ jev: 1, luna: 1 });
    expect(t.logged).toEqual([{ at: "2026-11-01T09:30:00.000Z", status: 502, model: "jev-latest", detail: "Decisions provider error" }]);
  });

  test("a timeout also goes to the chat model", async () => {
    const t = setup();
    t.jevFailsWith(new GatewayError("timeout"));
    expect(await t.sentence()).toEqual({ route: "luna", via: "luna" });
  });

  test("two server failures in a row skip Jev for ten minutes, then Jev is tried once more", async () => {
    const t = setup();
    await t.sentence();
    await t.sentence();
    expect(t.guard.pausedUntil()).toBe(new Date(Date.parse("2026-11-01T09:30:00Z") + JEV_PAUSE_MS).toISOString());
    expect(await t.sentence()).toEqual({ route: "luna", via: "luna" });
    expect(t.calls.jev).toBe(2);

    t.tick(JEV_PAUSE_MS);
    await t.sentence();
    expect(t.calls.jev).toBe(3);
    // The one retry failed too, so Jev pauses again without a second try.
    expect(t.guard.pausedUntil()).not.toBeNull();
    await t.sentence();
    expect(t.calls.jev).toBe(3);

    t.tick(JEV_PAUSE_MS);
    t.jevFailsWith(null);
    expect(await t.sentence()).toEqual({ route: "jev", via: "jev" });
    expect(t.guard.pausedUntil()).toBeNull();
  });

  test("a request Jev refuses (4xx) neither pauses Jev nor spends a chat-model call", async () => {
    const t = setup();
    t.jevFailsWith(new GatewayError(400));
    expect(await t.sentence()).toEqual({ route: null, via: null });
    expect(await t.sentence()).toEqual({ route: null, via: null });
    expect(t.calls).toEqual({ jev: 2, luna: 0 });
    expect(t.guard.pausedUntil()).toBeNull();
    expect(t.guard.failures).toBe(2);
  });

  test("when the chat model fails too, the sentence is left unread and both failures are recorded", async () => {
    const t = setup();
    const guard = t.guard;
    const result = await classify(
      guard,
      "jev-latest",
      () => Promise.reject(new GatewayError(503)),
      () => "never",
      { model: () => "gpt-5.6-luna", call: () => Promise.reject(new GatewayError(500)), parse: (raw) => raw },
    );
    expect(result).toEqual({ route: null, via: null });
    expect(t.logged).toMatchObject([{ status: 503, model: "jev-latest" }, { status: 500, model: "gpt-5.6-luna" }]);
  });
});

describe("chips", () => {
  const noData = { courses: [], courseById: {}, assignments: [], lectures: [], recordings: [], notices: [], files: [] };

  test("the fallback buttons cover the common requests and none of them starts a download", () => {
    const kinds = FALLBACK_CHIPS.map((c) => (c.parsed.kind === "read" ? c.parsed.command.command : c.parsed.kind === "ams" ? `ams:${c.parsed.topic}` : c.parsed.kind));
    expect(kinds).toEqual(["deadlines", "files", "lectures", "recordings", "notices", "portal", "ams:grades", "ams:timetable", "ams:credits", "schedule", "seats", "loans", "menus", "navigate"]);
    expect(FALLBACK_CHIPS.some((c) => c.parsed.kind === "read" && c.parsed.start)).toBe(false);
  });

  test("home chips carry their command, so a chip never depends on reading its label", () => {
    const chips = homeChips(noData);
    expect(chips.find((c) => c.label === "새 자료 다 받아줘")?.parsed).toEqual({ kind: "read", command: { command: "files", onlyNew: true }, start: true });
    expect(chips.find((c) => c.label === "중앙도서관 빈자리 있어?")?.parsed).toEqual({ kind: "seats", library: "중앙도서관" });
    expect(chips.at(-1)?.parsed).toEqual({ kind: "read", command: { command: "courses" } });
  });

  test("a course picked from the course list opens that course", () => {
    const course: Course = { id: "c1", name: "형사소송법", prof: "", hue: 1, aliases: [] };
    const data = { ...noData, courses: [course], courseById: { c1: course } };
    const parsed = courseCommand(course.name);
    if (parsed.kind !== "read") throw new Error("course command is a read");
    const snap = { watched: new Set<string>(), read: new Set<string>(), downloaded: new Set<string>() };
    expect(outcomeFor(parsed.command, data, snap)).toMatchObject({ kind: "course", course: { id: "c1" } });
  });
});
