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
