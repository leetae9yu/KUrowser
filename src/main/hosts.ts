export const SCHOOL_DOMAIN = "korea.ac.kr";
export const AI_HOSTS: ReadonlySet<string> = new Set(["llm.korea.ac.kr", "llmsso.korea.ac.kr", "sso.korea.ac.kr", "api.baze.co"]);
const AI_SITE_HOSTS: ReadonlySet<string> = new Set(["llm.korea.ac.kr", "llmsso.korea.ac.kr"]);

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
/** The SSO page's own mail-code steps for the academic system: user check, switch to mail, send, verify. */
const SSO_MAIL_CODE = new Set(["/korea/auth/IOPUserStatusChk.eps", "/korea/EmailMasking.eps", "/korea/auth/IOPOtpReq.eps", "/korea/auth/IOPOtpVerify.eps"]);
/** The academic system's sign-in relay pages, posted as page navigations after the SSO step. */
const AMS_RELAY = /^\/exsignon\/sso\/sso_(identify|idp_login)\.jsp$/;
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
  const u = parse(url);
  // The AI site signs in inside the same hidden window; its own login hand-off posts are not school writes.
  if (u && AI_SITE_HOSTS.has(u.hostname) && isAiLoginUrl(url)) return true;
  if (method.toUpperCase() === "POST" && u?.protocol === "https:" && u.hostname === "sso.korea.ac.kr" && SSO_MAIL_CODE.has(u.pathname)) return true;
  if (!DOCUMENT_TYPES.has(resourceType)) return false;
  if (u?.protocol === "https:" && u.hostname === "ams.korea.ac.kr") return AMS_RELAY.test(u.pathname);
  // The LMS sign-in relay the SSO posts back to (observed on a password sign-in in the hidden window).
  if (u?.protocol === "https:" && u.hostname === "lms.korea.ac.kr") return u.pathname === "/exsignon_new/sso/sso_identify.php";
  if (!u || u.protocol !== "https:" || !isSchoolHost(u.hostname)) return false;
  if (u.hostname === "sso.korea.ac.kr") return true;
  if (u.hostname !== "mylms.korea.ac.kr" && u.hostname !== "canvas.korea.ac.kr") return false;
  return LTI_LAUNCH.test(u.pathname) || CANVAS_LOGIN.test(u.pathname);
}
