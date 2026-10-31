/** Caption helpers shared by CLI and live LMS extraction. */

/** Return whether a caption track is Korean by language code or LMS label. */
export function isKoreanCaptionTrack(track: Record<string, unknown>): boolean {
  const language = String(track.language || "").trim().toLowerCase();
  const label = String(track.label || "").trim().toLowerCase();
  const normalizedLanguage = language.replaceAll("_", "-");
  return (
    ["ko", "kor", "kr", "ko-kr"].includes(normalizedLanguage) ||
    normalizedLanguage.startsWith("ko-") ||
    ["korean", "한국", "한글", "국문"].some((token) => `${language} ${label}`.includes(token))
  );
}
