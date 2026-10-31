export const SCHOOL_DOMAIN = "korea.ac.kr";
export const AI_HOSTS: ReadonlySet<string> = new Set(["llm.korea.ac.kr", "llmsso.korea.ac.kr", "sso.korea.ac.kr", "api.baze.co"]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isSchoolHost(hostname: string): boolean {
  return hostname === SCHOOL_DOMAIN || hostname.endsWith(`.${SCHOOL_DOMAIN}`);
}

export function isSchoolUrl(url: string): boolean {
  const u = parse(url);
  return !!u && u.protocol === "https:" && isSchoolHost(u.hostname);
}

// The KU SSO bridge for the AI site redirects through plain http on llmsso before upgrading.
export function isAiLoginUrl(url: string): boolean {
  const u = parse(url);
  if (!u) return false;
  if (u.protocol === "https:") return AI_HOSTS.has(u.hostname) && u.hostname !== "api.baze.co";
  return u.protocol === "http:" && u.hostname === "llmsso.korea.ac.kr";
}

export function isAllowedPage(url: string): boolean {
  if (url === "about:blank") return true;
  return isSchoolUrl(url);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The hidden engine window only reads. It may still submit the LTI launch forms and SSO hand-offs
 * that opening a school page needs; every other write-shaped request is cancelled.
 */
export function engineRequestAllowed(method: string, url: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return true;
  const u = parse(url);
  if (!u || !isSchoolHost(u.hostname)) return false;
  const path = u.pathname.toLowerCase();
  if (path.includes("/external_tools/") || path.includes("/lti/") || path.includes("/login") || path.includes("/sso")) return true;
  if (u.hostname === "sso.korea.ac.kr") return true;
  return false;
}
