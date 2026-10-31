import { isSchoolUrl } from "./hosts.ts";
import { schoolSession } from "./school.ts";
import { SiteError, type SiteResponse } from "./site-text.ts";

/** School sites the app reads besides the LMS. Reads go out with the portal login cookies of the app's one session. */
export const SITE_HOSTS: ReadonlySet<string> = new Set([
  "portal.korea.ac.kr",
  "registrar.korea.ac.kr",
  "librsv.korea.ac.kr",
  "library.korea.ac.kr",
  "ams.korea.ac.kr",
]);

function siteUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:" || !SITE_HOSTS.has(u.hostname)) throw new SiteError("허용하지 않은 학교 주소예요");
  return u;
}

const MAX_REDIRECTS = 6;

/**
 * One read from a school site. Only GET leaves the app here. Redirects are followed one hop at a time (Electron's
 * fetch does not report where it ended), and a hop that leaves the school is refused before it is sent. The caller
 * gets the page text to parse. Values never go into errors or logs.
 */
export async function siteGet(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<SiteResponse> {
  siteUrl(url);
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await schoolSession().fetch(current, { credentials: "include", headers, redirect: "manual", signal });
    } catch {
      throw new SiteError("학교 사이트가 답하지 않아요");
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { status: res.status, url: current, text: await res.text() };
    current = new URL(location, current).href;
    if (!isSchoolUrl(current)) throw new SiteError("학교 밖 주소로 넘어가서 멈췄어요");
  }
  throw new SiteError("학교 사이트가 너무 여러 번 넘겨서 멈췄어요");
}
