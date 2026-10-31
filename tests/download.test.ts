import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadWithCanvasCookie } from "../src/engine/live.ts";
import { isDownloadHost } from "../src/main/hosts.ts";

describe("material download redirects", () => {
  test("stop before contacting a host outside the allowlist", async () => {
    let storageHits = 0;
    const storage = Bun.serve({ port: 0, fetch: () => (storageHits++, new Response("file")) });
    const lms = Bun.serve({ port: 0, fetch: () => Response.redirect(`http://127.0.0.2:${storage.port}/f.pdf`, 302) });
    const dir = mkdtempSync(join(tmpdir(), "kur-dl-"));
    try {
      const run = downloadWithCanvasCookie(`http://127.0.0.1:${lms.port}/files/1`, "c=1", join(dir, "f.pdf"), 5, new Set(["127.0.0.1"]), () => false);
      await expect(run).rejects.toThrow("outside the allowlist: 127.0.0.2");
      expect(storageHits).toBe(0);
    } finally {
      lms.stop(true);
      storage.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the app allows school hosts and the observed storage host only", () => {
    expect(isDownloadHost("mylms.korea.ac.kr")).toBe(true);
    expect(isDownloadHost("kr.object.gov-ncloudstorage.com")).toBe(true);
    expect(isDownloadHost("evil.example.com")).toBe(false);
    expect(isDownloadHost("kr.object.gov-ncloudstorage.com.evil.example")).toBe(false);
  });
});
