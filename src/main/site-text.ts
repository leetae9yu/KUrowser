export interface SiteResponse {
  status: number;
  url: string;
  text: string;
}

/** One GET to an allowed school site; `site-fetch.ts` gives the app's real one. */
export type SiteGet = (url: string, headers?: Record<string, string>) => Promise<SiteResponse>;

export class SiteError extends Error {
  override name = "SiteError";
}

/** School sites the app reads besides the LMS. Reads go out with the portal login cookies of the app's one session. */
export const SITE_HOSTS: ReadonlySet<string> = new Set([
  "portal.korea.ac.kr",
  "registrar.korea.ac.kr",
  "librsv.korea.ac.kr",
  "library.korea.ac.kr",
  "ams.korea.ac.kr",
]);

/** An https address on one of the site hosts; anything else is refused before it is sent. */
export function siteUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SiteError("허용하지 않은 학교 주소예요");
  }
  if (u.protocol !== "https:" || !SITE_HOSTS.has(u.hostname) || u.username || u.password || u.port) throw new SiteError("허용하지 않은 학교 주소예요");
  return u;
}

/** The next address of a redirect, held to the same site hosts as the first request. */
export function nextHop(current: string, location: string): string {
  let next: string;
  try {
    next = new URL(location, current).href;
  } catch {
    throw new SiteError("허용하지 않은 학교 주소예요");
  }
  return siteUrl(next).href;
}

/** Text inside the element whose opening tag carries `marker` (a class or id), counting nested tags of its kind. */
export function innerHtml(html: string, marker: string): string | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const open = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(open))?.[1]?.toLowerCase();
  if (!tag) return null;
  const start = html.indexOf(">", at) + 1;
  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  token.lastIndex = start;
  let depth = 1;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(start, m.index);
  }
  return html.slice(start);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };

/** Visible text of an HTML fragment: block ends become line breaks, entities are decoded, blank runs collapse. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
