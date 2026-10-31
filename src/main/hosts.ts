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

// Observed on the live LMS: Canvas file downloads redirect to this NAVER Cloud (government) object storage host.
export const DOWNLOAD_HOSTS: ReadonlySet<string> = new Set<string>(["kr.object.gov-ncloudstorage.com"]);

export function isDownloadHost(hostname: string): boolean {
  return isSchoolHost(hostname) || DOWNLOAD_HOSTS.has(hostname);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const DOCUMENT_TYPES = new Set(["mainFrame", "subFrame"]);
const LTI_LAUNCH = /^\/learningx\/lti\/[a-z_]+\/course_menu$/;
const CANVAS_LOGIN = /^\/login(\/|$)/;

/**
 * The hidden engine window only reads. It may still submit, as page navigations, the LearningX
 * LTI launch form that opens a course tool and the SSO login hand-off; script requests (xhr, fetch)
 * that write are always cancelled. Observed on the live LMS: the attendance tab posts only
 * /learningx/lti/lecture_attendance/course_menu.
 */
export function engineRequestAllowed(method: string, url: string, resourceType: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return true;
  if (!DOCUMENT_TYPES.has(resourceType)) return false;
  const u = parse(url);
  if (!u || u.protocol !== "https:" || !isSchoolHost(u.hostname)) return false;
  if (u.hostname === "sso.korea.ac.kr") return true;
  if (u.hostname !== "mylms.korea.ac.kr" && u.hostname !== "canvas.korea.ac.kr") return false;
  return LTI_LAUNCH.test(u.pathname) || CANVAS_LOGIN.test(u.pathname);
}
