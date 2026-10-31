import { AMS, AMS_LOOKUP_PATHS } from "./ams-data.ts";
import { schoolSession } from "./school.ts";
import { nextHop, SiteError, siteUrl, type SiteResponse } from "./site-text.ts";

const MAX_REDIRECTS = 6;

/**
 * One read from a school site. Only GET leaves the app here. Redirects are followed one hop at a time (Electron's
 * fetch does not report where it ended), and every hop is held to the same site hosts as the first request before it
 * is sent. The caller gets the page text to parse. Values never go into errors or logs.
 */
export async function siteGet(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<SiteResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = siteUrl(url).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await schoolSession().fetch(current, { credentials: "include", headers, redirect: "manual", signal });
    } catch {
      throw new SiteError("학교 사이트가 답하지 않아요");
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { status: res.status, url: current, text: await res.text() };
    current = nextHop(current, location);
  }
  throw new SiteError("학교 사이트가 너무 여러 번 넘겨서 멈췄어요");
}

/**
 * The only POST the app sends to a school site: an academic-system lookup (Nexacro answers reads only by POST). The
 * path must be one of the listed read lookups, and a redirect is never followed (it means the session ended).
 */
export async function amsPost(path: string, form: URLSearchParams, timeoutMs = 30_000): Promise<SiteResponse> {
  if (!AMS_LOOKUP_PATHS.has(path)) throw new SiteError("허용하지 않은 학사시스템 요청이에요");
  let res: Response;
  try {
    res = await schoolSession().fetch(`${AMS}${path}`, {
      method: "POST",
      credentials: "include",
      redirect: "manual",
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", referer: `${AMS}/index.html`, origin: AMS, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SiteError("학사시스템이 답하지 않아요");
  }
  return { status: res.status, url: `${AMS}${path}`, text: res.status >= 300 && res.status < 400 ? "" : await res.text() };
}
