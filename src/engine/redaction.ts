/** Redaction helpers for secrets and LMS-private artifacts. */
import { pyStr } from "./util.ts";

export const REDACTION = "[REDACTED]";
export const SENSITIVE_KEY_PATTERNS = [
  "consumer_key",
  "pwd",
  "password",
  "pass",
  "secret",
  "token",
  "cookie",
  "session",
  "authorization",
  "auth",
  "credential",
  "secure_params",
  "oauth",
  "signature",
  "nonce",
  "saml",
  "relaystate",
  "email",
  "e_mail",
  "mail",
  "lis_person",
  "custom_user",
  "user_login",
  "sourcedid",
  "person_name",
] as const;

/** [pattern, keepsPrefixGroup] in the original order. */
const VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, boolean]> = [
  [/(KU_LMS_(?:ID|PWD)\s*=\s*)([^\s#]+)/gi, true],
  [/()([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, true],
  [/(authorization\s*[:=]\s*bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, true],
  [/((?:access|refresh|id)?_?token\s*[:=]\s*)([A-Za-z0-9._~+/=-]{8,})/gi, true],
  [/(cookie\s*[:=]\s*)([^\n;]+(?:;[^\n]+)?)/gi, true],
  [/((?:session|sess)[-_]?(?:id|key)?\s*[:=]\s*)([A-Za-z0-9._~+/=-]{8,})/gi, true],
  [
    /([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|pwd|session|sid|SAMLResponse|SAMLRequest|RelayState|oauth[_-]?(?:signature|nonce|token|consumer[_-]?key))=)([^&#\s]+)/gi,
    true,
  ],
  [/(\/feeds\/calendars\/)([^/\s?#[]+\.ics)/gi, true],
  [/(?<![A-Za-z])\p{Nd}{8,}(?![A-Za-z])/gu, false],
];

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/** Return a string with common credentials/tokens and explicit values removed. */
export function redactText(text: unknown, extraValues?: readonly string[] | null): string {
  let result = pyStr(text);
  for (const [pattern, keepPrefix] of VALUE_PATTERNS) {
    result = keepPrefix ? result.replace(pattern, (_match, prefix: string) => `${prefix}${REDACTION}`) : result.replace(pattern, REDACTION);
  }
  for (const value of extraValues ?? []) {
    if (value) result = result.replaceAll(String(value), REDACTION);
  }
  return result;
}

/** Recursively redact mappings/sequences while preserving shape. */
export function redactData(value: unknown, extraValues?: readonly string[] | null): unknown {
  if (Array.isArray(value) || value instanceof Set) {
    return [...value].map((child) => redactData(child, extraValues));
  }
  if (value instanceof Uint8Array) {
    return redactText(new TextDecoder().decode(value), extraValues);
  }
  if (typeof value === "string") return redactText(value, extraValues);
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = isSensitiveKey(key) ? REDACTION : redactData(child, extraValues);
    }
    return redacted;
  }
  return value;
}
