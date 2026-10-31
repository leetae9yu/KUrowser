import type { WebContents } from "electron";

import type { FocusEvent } from "../shared/types.ts";
import { judge, newMemory, pageScript, ruleFor, type PageResult } from "./focus-rules.ts";

/**
 * Lays focus mode over one school pane: after each page or frame load it styles the frames a rule knows,
 * says the next step in the chat once, and reports a finished job so the pane can close.
 */
export class FocusMode {
  on = true;
  matched = false;
  private memory = newMemory();

  constructor(
    private readonly wc: WebContents,
    private readonly events: { say: (e: FocusEvent) => void; done: () => void; changed: () => void },
  ) {
    wc.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.setMatched(false);
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

  private apply(): void {
    if (this.wc.isDestroyed()) return;
    for (const frame of this.wc.mainFrame.framesInSubtree) {
      const rule = ruleFor(frame.url);
      if (!rule) continue;
      const url = frame.url;
      frame
        .executeJavaScript(pageScript(rule, this.on))
        .then((value: unknown) => {
          const res = value as PageResult | null;
          if (this.wc.isDestroyed() || !res?.matched) return;
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
