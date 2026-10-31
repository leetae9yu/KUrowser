import { fetchCourses, fetchRecordingPages, recordingCandidates } from "../engine/live.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { redactData } from "../engine/redaction.ts";
import type { ElectronBrowserSession } from "./electron-cdp.ts";
import { GatewayClient } from "./ai.ts";
import { keepLogin } from "./school.ts";
import { SUMMARY_LECTURE_PROMPT } from "./sentence.ts";
import { cer, estimateCredits, extractAudio, resolveMedia, STT_MODEL, toSrt, transcode } from "./stt.ts";

type Raw = Record<string, any>;
const keys = (rows: unknown): string[] => (Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]).sort() : []);
const out = (label: string, value: unknown): void => console.log(`PROBE ${label} ${JSON.stringify(redactData(value))}`);

const ATTENDED = new Set(["attendance", "late", "excused"]);
const shape = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/[0-9a-f]{8,}|\d+/gi, "N")}${u.search ? "?" + [...u.searchParams.keys()].join(",") : ""}`;
  } catch {
    return url.slice(0, 40);
  }
};

async function silenceSeconds(ffmpeg: string, wav: string): Promise<number> {
  const { spawnSync } = await import("node:child_process");
  const p = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-i", wav, "-af", "silencedetect=noise=-40dB:d=0.7", "-f", "null", "-"], { encoding: "utf8" });
  return [...String(p.stderr).matchAll(/silence_duration: ([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
}

/**
 * Silence-cut at 1.5x: the clip used before (its 1x transcript is the reference) plus the attended lecture whose first
 * two minutes hold the most silence (1.5x transcript is the reference there). Attendance is compared before and after.
 */
async function silenceProbe(session: ElectronBrowserSession): Promise<void> {
  const ses = session.webContents!.session;
  const dir = process.env.KUROWSER_PROBE_DIR!;
  const ffmpeg = process.env.KUROWSER_FFMPEG!;
  const attended: Array<{ courseId: unknown; itemId: string; data: Raw; before: string }> = [];
  for (const course of await fetchCourses(session)) {
    const attendance = await session.fetchAttendance(course.id).catch(() => null);
    const summaries: Raw = attendance?.summary?.attendance_summaries ?? {};
    for (const i of (attendance?.attendance_items?.attendance_items ?? []) as Raw[]) {
      const s = summaries[String(i.item_id)];
      if (i.item_content_type === "commons" && i.use_attendance && ATTENDED.has(s?.attendance_status) && i.item_content_data?.content_id && Number(i.item_content_data.duration) >= 150) {
        attended.push({ courseId: course.id, itemId: String(i.item_id), data: i.item_content_data, before: JSON.stringify(s) });
      }
    }
  }
  const first = attended.find((a) => Number(a.data.duration) > 180 && Number(a.data.duration) < 190) ?? attended[0]!;
  let pausy: { a: (typeof attended)[number]; silence: number; wav: string } | null = null;
  for (const [n, a] of attended.filter((x) => x !== first).slice(0, 8).entries()) {
    const wav = join(dir, `scan-${n}.wav`);
    const media = await resolveMedia(ses, a.data).catch(() => null);
    if (!media) continue;
    await extractAudio(ffmpeg, media.mediaUrl, wav, { clipSeconds: 120 }).catch(() => 0);
    const silence = await silenceSeconds(ffmpeg, wav);
    out("scan", { n, lectureSeconds: Number(a.data.duration), silence: Math.round(silence * 10) / 10 });
    if (!pausy || silence > pausy.silence) pausy = { a, silence, wav };
  }
  const gateway = new GatewayClient((job) => job(session.webContents!));
  await gateway.restore();
  const runs: Array<{ label: string; wav: string; speed: number; cut: boolean; norm: boolean; ref: string }> = [
    { label: "A silence+1.5x", wav: join(dir, "clip-source.wav"), speed: 1.5, cut: true, norm: false, ref: "clip-1x.txt" },
  ];
  if (pausy) {
    runs.push({ label: "B 1.5x", wav: pausy.wav, speed: 1.5, cut: false, norm: false, ref: "" });
    runs.push({ label: "B silence+1.5x", wav: pausy.wav, speed: 1.5, cut: true, norm: false, ref: "B-1.5x.txt" });
    runs.push({ label: "B norm+silence+1.5x", wav: pausy.wav, speed: 1.5, cut: true, norm: true, ref: "B-1.5x.txt" });
  }
  const files = [];
  for (const r of runs) {
    const file = join(dir, `${r.label.replace(/\s+/g, "-")}.mp3`);
    files.push({ ...r, file, seconds: await transcode(ffmpeg, r.wav, file, { speed: r.speed, cutSilence: r.cut, normalize: r.norm }) });
  }
  const total = files.reduce((s, f) => s + estimateCredits(f.seconds), 0);
  const remaining = await gateway.credits();
  out("plan", { runs: files.map((f) => ({ label: f.label, seconds: f.seconds })), total, remaining });
  if (remaining === null || remaining < total || total > Number(process.env.KUROWSER_STT_BUDGET ?? "0")) return out("error", "budget or balance too low; not started");
  for (const f of files) {
    const before = await gateway.credits();
    const result = await gateway.transcribe(f.file, STT_MODEL);
    const after = await gateway.credits();
    const name = f.label.startsWith("B 1.5x") ? "B-1.5x.txt" : `${f.label.replace(/\s+/g, "-")}.txt`;
    writeFileSync(join(dir, name), result.text, { mode: 0o600 });
    const ref = f.ref ? readFileSync(join(dir, f.ref), "utf8") : "";
    out("stt", { label: f.label, seconds: f.seconds, charged: result.charged, balanceDelta: before !== null && after !== null ? Math.round((before - after) * 100) / 100 : null, cer: f.ref ? Math.round(cer(ref, result.text) * 1000) / 1000 : 0 });
  }
  for (const a of [first, pausy?.a].filter(Boolean) as Array<(typeof attended)[number]>) {
    const after = await session.fetchAttendance(a.courseId).catch(() => null);
    out("attendance_unchanged", JSON.stringify(after?.summary?.attendance_summaries?.[a.itemId]) === a.before);
  }
}

async function mediaProbe(session: ElectronBrowserSession): Promise<void> {
  if (process.env.KUROWSER_PROBE_STAGE === "sil") return silenceProbe(session);
  const courses: Raw[] = await fetchCourses(session);
  for (const course of courses) {
    const attendance = await session.fetchAttendance(course.id).catch(() => null);
    const items: Raw[] = attendance?.attendance_items?.attendance_items ?? [];
    const summaries: Raw = attendance?.summary?.attendance_summaries ?? {};
    const item = items.find((i) => i.item_content_type === "commons" && i.use_attendance && ATTENDED.has(summaries[String(i.item_id)]?.attendance_status));
    if (!item) continue;
    const candidates = await recordingCandidates(session, course).catch(() => [] as Raw[]);
    const recording = candidates.find((c) => String(c.title).replace(/\s+/g, "") === String(item.title).replace(/\s+/g, ""));
    if (!recording) continue;
    const describe = (v: unknown, depth = 0): unknown => {
      if (typeof v === "string") return /^https?:/.test(v) ? `url:${shape(v)}` : `str${v.length}`;
      if (typeof v !== "object" || v === null) return typeof v;
      if (Array.isArray(v)) return depth > 2 ? "arr" : v.slice(0, 2).map((x) => describe(x, depth + 1));
      return depth > 2 ? "obj" : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, describe(x, depth + 1)]));
    };
    out("item_shape", describe(item));
    if (process.env.KUROWSER_PROBE_STAGE === "meta") {
      const data: Raw = item.item_content_data ?? {};
      const origin = new URL(String(data.view_url)).origin;
      for (const path of [`/viewer/ssplayer/uniplayer_support/content.php?content_id=${data.content_id}`]) {
        const res = await session.webContents!.session.fetch(`${origin}${path}`, { credentials: "include" }).catch((e: Error) => e);
        if (res instanceof Error) {
          out("content", { path: shape(origin + path), error: res.message });
          continue;
        }
        const text = await res.text();
        const tags = [...new Set([...text.matchAll(/<([a-zA-Z_][\w:-]*)/g)].map((m) => m[1]))];
        const urls = [...text.matchAll(/(https?:\/\/[^\s"'<\]]+)/g)].map((m) => shape(m[1]!));
        const media = [...text.matchAll(/<(main_media|intro_media|media_uri|outro_media|[a-z_]*media[a-z_]*)[^>]*>([^<]{0,300})</g)].map((m) => ({ tag: m[1], value: /^https?:|\//.test(m[2]!.trim()) ? shape(m[2]!.trim().startsWith("http") ? m[2]!.trim() : origin + "/" + m[2]!.trim()) : `str${m[2]!.trim().length}` }));
        const pick = (tag: string) => [...text.matchAll(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([^<\\]]{0,120})`, "g"))].map((m) => m[1]!.trim());
        out("stories", { story_type: pick("story_type"), story_duration: pick("story_duration"), main_media: pick("main_media"), content_duration: pick("content_duration"), content_type: pick("content_type"), playing_info: text.match(/<content_playing_info[^>]*>/)?.[0]?.replace(/\d{3,}/g, "N") });
        const file = pick("main_media").find(Boolean);
        const cdn = [...text.matchAll(/<media_uri[^>]*>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/media_uri>/g)].map((m) => m[1]!.trim()).find((u) => !u.includes("_pseudo"));
        if (file && cdn && process.env.KUROWSER_PROBE_OUT) {
          writeFileSync(process.env.KUROWSER_PROBE_OUT, JSON.stringify({ media: cdn.replace("[MEDIA_FILE]", file), duration: data.duration, viewUrl: data.view_url }), { mode: 0o600 });
        }
        out("content", { status: res.status, type: res.headers.get("content-type"), bytes: text.length, tags: tags.slice(0, 60), urls: urls.slice(0, 20), media: media.slice(0, 20), duration: data.duration });
      }
      return;
    }
    const before = JSON.stringify(summaries[String(item.item_id)]);
    if (process.env.KUROWSER_PROBE_STAGE === "stt") {
      await sttProbe(session, item.item_content_data ?? {});
      const after = await session.fetchAttendance(course.id).catch(() => null);
      out("attendance_unchanged", JSON.stringify(after?.summary?.attendance_summaries?.[String(item.item_id)]) === before);
      return;
    }
    return;
  }
  out("error", "no attended commons lecture with a module page");
}

/**
 * Speed comparison on the first two minutes of one attended lecture: 1x, 1.5x, 2x and silence-cut 2x, each sent to
 * the Gateway STT once. Refuses to start when the estimate passes KUROWSER_STT_BUDGET or the balance. Transcripts
 * stay in KUROWSER_PROBE_DIR; only lengths, credits and error rates are printed.
 */
async function sttProbe(session: ElectronBrowserSession, data: Raw): Promise<void> {
  const ses = session.webContents!.session;
  const dir = process.env.KUROWSER_PROBE_DIR!;
  const ffmpeg = process.env.KUROWSER_FFMPEG!;
  const media = await resolveMedia(ses, data);
  out("media", { lmsSeconds: data.duration, storySeconds: media.duration, captions: media.captionUrls.length });
  const variants = [
    { name: "1x", speed: 1, cutSilence: false },
    { name: "1.5x", speed: 1.5, cutSilence: false },
    { name: "2x", speed: 2, cutSilence: false },
    { name: "silence+2x", speed: 2, cutSilence: true },
  ];
  const only = process.env.KUROWSER_STT_VARIANTS?.split(",");
  const clips = [];
  const base = join(dir, "clip-source.wav");
  out("source_seconds", await extractAudio(ffmpeg, media.mediaUrl, base, { clipSeconds: 120 }));
  for (const v of variants.filter((x) => !only || only.includes(x.name))) {
    const file = join(dir, `clip-${v.name}.mp3`);
    const seconds = await transcode(ffmpeg, base, file, { speed: v.speed, cutSilence: v.cutSilence });
    clips.push({ ...v, file, seconds, estimate: estimateCredits(seconds) });
  }
  const gateway = new GatewayClient((job) => job(session.webContents!));
  await gateway.restore();
  const remaining = await gateway.credits();
  const total = clips.reduce((s, c) => s + c.estimate, 0);
  out("plan", { clips: clips.map((c) => ({ name: c.name, seconds: c.seconds, estimate: c.estimate })), total, remaining });
  if (remaining === null || remaining < total || total > Number(process.env.KUROWSER_STT_BUDGET ?? "0")) return out("error", "budget or balance too low; not started");
  const texts: Record<string, string> = {};
  try {
    texts["1x"] = readFileSync(join(dir, "clip-1x.txt"), "utf8");
  } catch {
    // No earlier 1x transcript: this run makes it.
  }
  for (const c of clips.filter((x) => !(x.name === "1x" && texts["1x"]))) {
    const before = await gateway.credits();
    const t0 = performance.now();
    const result = await gateway.transcribe(c.file, STT_MODEL);
    const after = await gateway.credits();
    texts[c.name] = result.text;
    writeFileSync(join(dir, `clip-${c.name}.txt`), result.text, { mode: 0o600 });
    writeFileSync(join(dir, `clip-${c.name}.srt`), toSrt(result.segments), { mode: 0o600 });
    out("stt", { name: c.name, seconds: c.seconds, billedSeconds: result.durationSeconds, charged: result.charged, balanceDelta: before !== null && after !== null ? Math.round((before - after) * 100) / 100 : null, sec: Math.round((performance.now() - t0) / 1000), chars: [...result.text].length, cer: c.name === "1x" ? 0 : Math.round(cer(texts["1x"] ?? "", result.text) * 1000) / 1000 });
  }
  if (process.env.KUROWSER_STT_SUMMARY !== "1") return;
  const b = await gateway.credits();
  const summary = await gateway.complete(SUMMARY_LECTURE_PROMPT, texts["1x"] ?? "", 400);
  const a = await gateway.credits();
  writeFileSync(join(dir, "clip-summary.md"), summary, { mode: 0o600 });
  out("summary", { chars: [...summary].length, balanceDelta: b !== null && a !== null ? Math.round((b - a) * 100) / 100 : null });
}

export async function runProbe(make: () => ElectronBrowserSession): Promise<void> {
  const session = make();
  const started = performance.now();
  try {
    await session.enter();
    await session.login();
    out("login_ms", Math.round(performance.now() - started));
    await keepLogin();
    if (process.env.KUROWSER_PROBE === "media") return await mediaProbe(session);
    const courses: Raw[] = await fetchCourses(session);
    out("courses", { count: courses.length, keys: keys(courses), states: courses.map((c) => c.workflow_state) });
    const mode = process.env.KUROWSER_PROBE ?? "";
    for (const course of courses.slice(0, mode.includes("all") ? courses.length : 1)) {
      const t0 = performance.now();
      const assignments = await session.fetchJson(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission`).catch((e: Error) => e.message);
      out("assignments", { n: Array.isArray(assignments) ? assignments.length : assignments, keys: keys(assignments), sample: Array.isArray(assignments) && assignments[0] ? { html_url: typeof assignments[0].html_url, due_at: assignments[0].due_at, sub: keys([assignments[0].submission]) } : null });
      const topics = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/discussion_topics?only_announcements=true&per_page=100`).catch((e: Error) => e.message);
      out("announcements", { n: Array.isArray(topics) ? topics.length : topics, keys: keys(topics), read_state: Array.isArray(topics) ? topics.map((t: Raw) => t.read_state) : null });
      if (mode.includes("attendance")) {
        const attendance = await session.fetchAttendance(course.id).catch((e: Error) => ({ error: e.message }) as Raw);
        const items: Raw[] = attendance.attendance_items?.attendance_items ?? [];
        out("attendance", { n: items.length, keys: keys(items), sample: items.slice(0, 3).map((i) => ({ type: i.item_content_type, use: i.use_attendance, item_id: typeof i.item_id, extra: Object.fromEntries(Object.entries(i).filter(([k]) => /url|id|module/.test(k)).map(([k, v]) => [k, typeof v === "string" ? v.replace(/\d+/g, "N") : typeof v])) })), summaryKeys: Object.keys(attendance.summary ?? {}) });
      }
      if (mode.includes("attendance")) {
        const attendance = await session.fetchAttendance(course.id).catch(() => ({} as Raw));
        const ids = new Set((attendance.attendance_items?.attendance_items ?? []).map((i: Raw) => i.item_id));
        const modules: Raw[] = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/modules?per_page=100&include[]=items`).catch(() => []);
        const moduleItemIds = modules.flatMap((m) => (m.items ?? []).map((i: Raw) => i.id));
        out("match", { attendanceIds: ids.size, moduleItems: moduleItemIds.length, matched: moduleItemIds.filter((id) => ids.has(id)).length, itemKeys: keys(modules[0]?.items ?? []) });
      }
      out("course_ms", Math.round(performance.now() - t0));
    }
  } catch (error) {
    out("error", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  } finally {
    await session.exit();
  }
}
