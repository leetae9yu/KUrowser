import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { STATE_FILENAME, syncMaterials } from "../src/engine/materials.ts";

const row = (key: string, file: string) => ({ key, course: "과목", course_code: "", folders: ["1주차"], file, size: 1, updated_at: "2026-10-01T00:00:00Z", download_url: `https://mylms.korea.ac.kr/files/${key}` });

describe("overlapping material syncs", () => {
  test("keep every state entry and never share a file name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kur-sync-"));
    const gates: Array<() => void> = [];
    const targets: string[] = [];
    const session = {
      downloadFile: async (_url: string, target: string) => {
        targets.push(target);
        await new Promise<void>((resolve) => gates.push(resolve));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, "x");
        return 1;
      },
    };
    try {
      const a = syncMaterials(session as never, [row("a", "notes.pdf")], dir, { termFolders: false });
      const b = syncMaterials(session as never, [row("b", "notes.pdf")], dir, { termFolders: false });
      expect(gates.length).toBe(2);
      gates[1]!();
      await b;
      gates[0]!();
      await a;
      expect(new Set(targets).size).toBe(2);
      const state = JSON.parse(readFileSync(join(dir, STATE_FILENAME), "utf-8")).files;
      expect(Object.keys(state).sort()).toEqual(["a", "b"]);
      expect(state.a.path).not.toBe(state.b.path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
