import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { request as httpsRequest } from "node:https";

import type { Session } from "electron";

import { isSchoolHost } from "./hosts.ts";

export const STT_MODEL = "stt-async-v5";
export const STT_CREDITS_PER_MINUTE = 6;
// Measured on lecture clips: 1.5x cost a third less with a 0.2% character error rate against 1x (2x: 4.8%). Cutting
// silence saved 1-8% but raised errors to 0.9-2.9%, so the app normalises loudness and does not cut silence.
export const STT_SPEED = 1.5;
// Observed on the live LMS: Commons serves the lecture file from this CMS CDN and answers 403 without a Commons referer.
export const MEDIA_HOSTS: ReadonlySet<string> = new Set(["korea-cms-object.cdn.gov-ntruss.com"]);
const COMMONS_REFERER = "https://kucom.korea.ac.kr/";

export interface ContentData {
  content_id?: unknown;
  view_url?: unknown;
  duration?: unknown;
}

export interface LectureMedia {
  mediaUrl: string;
  duration: number;
  captionUrls: string[];
}

const isMediaUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (MEDIA_HOSTS.has(u.hostname) || isSchoolHost(u.hostname));
  } catch {
    return false;
  }
};

const tagValues = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}(?=[\\s>])[^>]*>\\s*(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?\\s*</${tag}>`, "gs"))].map((m) => m[1]!.trim());

/**
 * Reads the Commons content description (a plain GET, the same file the player reads before anything plays) and
 * picks the main video. The player's own intro clip lives under /uniplayer/ and is not part of the content, so it
 * is never chosen; stories that are not videos are skipped.
 */
export async function resolveMedia(ses: Session, data: ContentData): Promise<LectureMedia> {
  const view = new URL(String(data.view_url ?? ""));
  if (view.protocol !== "https:" || !isSchoolHost(view.hostname)) throw new Error("강의 콘텐츠 주소가 학교 주소가 아니에요");
  const res = await ses.fetch(`${view.origin}/viewer/ssplayer/uniplayer_support/content.php?content_id=${encodeURIComponent(String(data.content_id ?? ""))}`, {
    credentials: "include",
    redirect: "error",
  });
  if (res.status !== 200) throw new Error(`강의 정보를 받지 못했어요 (HTTP ${res.status})`);
  const xml = await res.text();
  const stories = [...xml.matchAll(/<story(?=[\s>])[^>]*>(.*?)<\/story>/gs)].map((m) => m[1]!);
  const story = stories.find((s) => /^video/i.test(tagValues(s, "story_type")[0] ?? "")) ?? stories[0] ?? xml;
  const file = tagValues(story, "main_media").find((v) => v && !v.includes("<"));
  const template = tagValues(xml, "media_uri").find((u) => !u.includes("_pseudo") && isMediaUrl(u.replace("[MEDIA_FILE]", "x")));
  if (!file || !template) throw new Error("강의 영상 파일을 찾지 못했어요");
  const mediaUrl = template.replace("[MEDIA_FILE]", encodeURIComponent(file));
  const captionUrls = [...xml.matchAll(/(https:\/\/[^\s"'<\]]+\.(?:vtt|srt|smi))/gi)].map((m) => m[1]!).filter(isMediaUrl);
  const storySeconds = Number(tagValues(story, "story_duration")[0]);
  const duration = storySeconds > 0 ? storySeconds : Number(data.duration);
  return { mediaUrl, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, captionUrls };
}

/** Billing is per second of the uploaded audio (measured: 120.096 s cost 12.0096). */
export function estimateCredits(seconds: number, speed = 1): number {
  return Math.ceil(((seconds / speed) / 60) * STT_CREDITS_PER_MINUTE * 100) / 100;
}

/**
 * ffmpeg filters, in this order: loudness normalisation (quiet speakers get louder before anything is cut), then a
 * conservative silence cut, then a pitch-keeping speed-up (atempo takes at most 2.0 per stage).
 */
export function audioFilters(speed: number, cutSilence: boolean, normalize = false): string {
  const filters: string[] = [];
  if (normalize) filters.push("dynaudnorm=f=250:g=15:m=10");
  if (cutSilence) filters.push(`silenceremove=stop_periods=-1:stop_duration=${normalize ? "1.0" : "0.7"}:stop_threshold=${normalize ? "-45dB" : "-40dB"}`);
  for (let left = speed; left > 1.0001; left /= Math.min(left, 2)) filters.push(`atempo=${Math.min(left, 2).toFixed(3)}`);
  return filters.join(",") || "anull";
}

/**
 * Relays the lecture file to ffmpeg over 127.0.0.1 with the Commons referer, so the bundled ffmpeg needs no TLS or
 * DNS of its own and reads with HTTP ranges. The CDN wants no cookie, only the referer; only the media host is reachable.
 */
function relay(mediaUrl: string): Promise<{ url: string; server: Server }> {
  if (!isMediaUrl(mediaUrl)) return Promise.reject(new Error("허용하지 않은 주소예요"));
  const server = createServer((req, res) => {
    const headers: Record<string, string> = { Referer: COMMONS_REFERER };
    if (req.headers.range) headers.Range = String(req.headers.range);
    const up = httpsRequest(mediaUrl, { method: req.method === "HEAD" ? "HEAD" : "GET", headers }, (upRes) => {
      const out: Record<string, string> = {};
      for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upRes.headers[k];
        if (typeof v === "string") out[k] = v;
      }
      res.writeHead(upRes.statusCode ?? 502, out);
      upRes.pipe(res);
    });
    // ffmpeg stops reading once it has the clip; the upstream download must stop with it.
    res.on("close", () => up.destroy());
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    up.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/media.mp4`, server })));
}

type AudioOptions = { clipSeconds?: number; speed?: number; cutSilence?: boolean; normalize?: boolean };

/** Encodes `input` (a file or the relay URL) to mono 16 kHz audio; returns the output length in seconds. */
export async function transcode(ffmpeg: string, input: string, out: string, options: AudioOptions = {}): Promise<number> {
  const args = ["-hide_banner", "-nostdin", "-y", ...(options.clipSeconds ? ["-t", String(options.clipSeconds)] : []), "-i", input, "-vn", "-ac", "1", "-ar", "16000"];
  args.push("-af", audioFilters(options.speed ?? 1, !!options.cutSilence, !!options.normalize), ...(out.endsWith(".wav") ? [] : ["-b:a", "32k"]), out);
  const stderr = await new Promise<string>((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + String(d)).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`음성을 뽑지 못했어요 (ffmpeg ${code})`))));
  });
  const times = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  return times.at(-1) ?? 0;
}

/** Reads the lecture audio straight from the school's CDN through the relay. */
export async function extractAudio(ffmpeg: string, mediaUrl: string, out: string, options: AudioOptions = {}): Promise<number> {
  const { url, server } = await relay(mediaUrl);
  try {
    return await transcode(ffmpeg, url, out, options);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/** Downloads an official caption file from the school or its media CDN. */
export function fetchCaption(url: string): Promise<string> {
  if (!isMediaUrl(url)) return Promise.reject(new Error("허용하지 않은 주소예요"));
  return new Promise((resolve, reject) => {
    httpsRequest(url, { headers: { Referer: COMMONS_REFERER } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`자막을 받지 못했어요 (HTTP ${res.statusCode})`));
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve(text));
    })
      .on("error", reject)
      .end();
  });
}

/** Caption text without numbering, timestamps or markup, for the summary prompt. */
export function captionText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/.test(l))
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .join(" ");
}

export interface Transcript {
  text: string;
  segments: Array<{ start_ms: number; end_ms: number; text: string }>;
  charged: number | null;
  durationSeconds: number | null;
}

export function toSrt(segments: Transcript["segments"]): string {
  const ts = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return segments.map((s, i) => `${i + 1}\n${ts(s.start_ms)} --> ${ts(s.end_ms)}\n${s.text.trim()}\n`).join("\n");
}

/** Character error rate of `hyp` against `ref`, ignoring spaces and punctuation. */
export function cer(ref: string, hyp: string): number {
  const norm = (s: string) => [...s.replace(/[\s.,!?·…"'()\-:;~]/g, "")];
  const a = norm(ref);
  const b = norm(hyp);
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]! / a.length;
}
