/** Small helpers that reproduce Python semantics the original CLI relies on. */
import { homedir } from "node:os";
import { join } from "node:path";

/** Python repr() for JSON-like values. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : value > 0 ? "inf" : value < 0 ? "-inf" : "nan";
  if (typeof value === "string") return reprString(value);
  if (Array.isArray(value)) return "[" + value.map(pyRepr).join(", ") + "]";
  if (value instanceof Set) return pyRepr([...value]);
  if (typeof value === "object") {
    return "{" + Object.entries(value as Record<string, unknown>).map(([k, v]) => `${reprString(k)}: ${pyRepr(v)}`).join(", ") + "}";
  }
  return String(value);
}

function reprString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let body = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  if (quote === "'") body = body.replace(/'/g, "\\'");
  return quote + body + quote;
}

/** Python str(): strings unchanged, everything else through repr. */
export function pyStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return pyRepr(value);
}

/** json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True). */
export function jsonDumpsSorted(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, indent);
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** str.strip(chars): remove any of chars from both ends. */
export function stripChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start]!)) start++;
  while (end > start && chars.includes(value[end - 1]!)) end--;
  return value.slice(start, end);
}

export function casefold(value: string): string {
  return value.toLowerCase();
}

/** Path.expanduser(). */
export function expandUser(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

/** datetime.now(timezone.utc).isoformat(). */
export function pyIsoUtc(date: Date = new Date()): string {
  const iso = date.toISOString();
  const ms = date.getUTCMilliseconds();
  return iso.slice(0, 19) + (ms ? "." + String(ms).padStart(3, "0") + "000" : "") + "+00:00";
}

export interface ParsedIso {
  /** Epoch milliseconds; naive values are interpreted as UTC. */
  epochMs: number;
  aware: boolean;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?)?$/;

/** datetime.fromisoformat() for the shapes Canvas returns; null where Python raises ValueError. */
export function parseIsoDatetime(raw: string): ParsedIso | null {
  const match = ISO_RE.exec(raw.trim() === raw ? raw : "\u0000");
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0", tz] = match;
  const year = Number(y), month = Number(mo), day = Number(d), hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, Math.floor(Number(frac.padEnd(6, "0")) / 1000));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  if (!tz) return { epochMs: utc, aware: false };
  if (tz === "Z") return { epochMs: utc, aware: true };
  const sign = tz[0] === "-" ? -1 : 1;
  const digits = tz.slice(1).replace(/:/g, "");
  const offset = (Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4) || "0") * 60 + Number(digits.slice(4, 6) || "0")) * 1000;
  return { epochMs: utc - sign * offset, aware: true };
}

export const sleep = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
