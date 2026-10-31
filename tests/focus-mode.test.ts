import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import type { WebContents } from "electron";

import { FocusMode } from "../src/main/focus.ts";
import type { PageResult } from "../src/main/focus-rules.ts";

const ASSIGNMENT = "https://mylms.korea.ac.kr/courses/1/assignments/2";

function fakePane() {
  const wc = new EventEmitter() as EventEmitter & { isDestroyed: () => boolean; mainFrame: unknown };
  const answers: Array<(r: PageResult) => void> = [];
  const frame = {
    url: ASSIGNMENT,
    detached: false,
    executeJavaScript: () => new Promise<PageResult>((resolve) => answers.push(resolve)),
  };
  wc.isDestroyed = () => false;
  wc.mainFrame = { framesInSubtree: [frame] };
  const said: string[] = [];
  let closed = 0;
  const mode = new FocusMode(wc as unknown as WebContents, { say: (e) => said.push(e.kind), done: () => (closed += 1), changed: () => undefined });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { wc, frame, answers, said, closed: () => closed, mode, settle };
}

describe("FocusMode", () => {
  test("a finished submission closes the pane", async () => {
    const p = fakePane();
    p.wc.emit("did-frame-finish-load");
    p.answers.shift()!({ matched: true, target: true, done: false });
    await p.settle();
    p.wc.emit("did-frame-finish-load");
    p.answers.shift()!({ matched: true, target: false, done: true });
    await p.settle();
    expect(p.said).toEqual(["hint", "done"]);
    expect(p.closed()).toBe(1);
  });

  test("a result that arrives after another page started loading is dropped", async () => {
    const p = fakePane();
    p.wc.emit("did-frame-finish-load");
    p.answers.shift()!({ matched: true, target: true, done: false });
    await p.settle();
    p.wc.emit("did-frame-finish-load");
    const late = p.answers.shift()!;
    p.wc.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    late({ matched: true, target: false, done: true });
    await p.settle();
    expect(p.closed()).toBe(0);
    p.wc.emit("did-frame-finish-load");
    expect(p.answers.length).toBe(0);
  });

  test("a result from a frame that moved to another address is dropped", async () => {
    const p = fakePane();
    p.wc.emit("did-frame-finish-load");
    p.answers.shift()!({ matched: true, target: true, done: false });
    await p.settle();
    p.wc.emit("did-frame-finish-load");
    const late = p.answers.shift()!;
    p.frame.url = "https://mylms.korea.ac.kr/courses/1/assignments/3";
    late({ matched: true, target: false, done: true });
    await p.settle();
    expect(p.closed()).toBe(0);
  });
});
