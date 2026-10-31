// Prints the release line for the latest app start in perf.log: seconds to the first screen and memory, with a mark
// when either passes its guide (3 s, 600 MB). The mark only flags; nothing is blocked.
// Usage: bun scripts/perf-report.ts [path to perf.log]
import { homedir } from "node:os";
import { join } from "node:path";

const FIRST_SCREEN_SECONDS = 3;
const MEMORY_MB = 600;

const defaultLog = (): string => {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "KUrowser", "perf.log");
  if (process.platform === "win32") return join(process.env.APPDATA ?? homedir(), "KUrowser", "perf.log");
  return join(homedir(), ".config", "KUrowser", "perf.log");
};

type Line = { version: string; event: "firstScreen" | "loaded"; seconds: number; memoryMb: number; cached: boolean };
const lines = (await Bun.file(process.argv[2] ?? defaultLog()).text())
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Line);
const first = lines.findLast((l) => l.event === "firstScreen");
if (!first) throw new Error("perf.log has no first-screen line yet");
const loaded = lines.slice(lines.lastIndexOf(first)).find((l) => l.event === "loaded");
const over = [first.seconds > FIRST_SCREEN_SECONDS && `첫 화면 ${FIRST_SCREEN_SECONDS}초 넘음`, first.memoryMb > MEMORY_MB && `메모리 ${MEMORY_MB}MB 넘음`].filter(Boolean);
console.log(
  `KUR PERF ${first.seconds.toFixed(2)}초, ${first.memoryMb}MB (v${first.version}, ${first.cached ? "지난 결과 있음" : "첫 실행"}` +
    `${loaded ? `, 다 불러온 뒤 ${loaded.seconds.toFixed(1)}초 ${loaded.memoryMb}MB` : ""})${over.length ? ` [${over.join(", ")}]` : ""}`,
);
