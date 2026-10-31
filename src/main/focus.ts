import type { WebContents, WebFrameMain } from "electron";

import type { FocusEvent } from "../shared/types.ts";
import { judge, newMemory, pageScript, ruleFor, type PageResult } from "./focus-rules.ts";

/**
 * Lays focus mode over one school pane: after each page or frame load it styles the frames a rule knows,
 * says the next step in the chat once, and reports a finished job so the pane can close.
 * A result belongs to the document it ran in: once the pane starts loading another page (a login, say),
 * results still on their way are dropped, so a late "done" never closes the pane under the new page.
 */
export class FocusMode {
  on = true;
  matched = false;
  private memory = newMemory();
  private generation = 0;
  private navigating = false;

  constructor(
    private readonly wc: WebContents,
    private readonly events: { say: (e: FocusEvent) => void; done: () => void; changed: () => void },
  ) {
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.generation += 1;
      this.navigating = true;
      this.setMatched(false);
    });
    wc.on("did-navigate", () => {
      this.navigating = false;
    });
    wc.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) this.navigating = false;
    });
    wc.on("did-frame-finish-load", () => this.apply());
    wc.on("did-navigate-in-page", () => this.apply());
  }

  toggle(): void {
    this.on = !this.on;
    this.apply();
    this.events.changed();
  }

  private setMatched(value: boolean): void {
    if (this.matched === value) return;
    this.matched = value;
    this.events.changed();
  }

  private current(frame: WebFrameMain, url: string, generation: number): boolean {
    if (this.wc.isDestroyed() || generation !== this.generation || this.navigating) return false;
    try {
      return !frame.detached && frame.url === url;
    } catch {
      return false;
    }
  }

  private apply(): void {
    if (this.wc.isDestroyed() || this.navigating) return;
    const generation = this.generation;
    for (const frame of this.wc.mainFrame.framesInSubtree) {
      const rule = ruleFor(frame.url);
      if (!rule) continue;
      const url = frame.url;
      frame
        .executeJavaScript(pageScript(rule, this.on))
        .then((value: unknown) => {
          const res = value as PageResult | null;
          if (!res?.matched || !this.current(frame, url, generation)) return;
          this.setMatched(true);
          const { hint, done } = judge(this.memory, rule, url, res);
          if (hint) this.events.say({ kind: "hint", text: hint });
          if (done) {
            this.events.say({ kind: "done", text: done });
            this.events.done();
          }
        })
        .catch(() => undefined);
    }
  }
}
