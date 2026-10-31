export const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function fireTime(due: string, now = Date.now()): number | null {
  const dueMs = Date.parse(due);
  if (!Number.isFinite(dueMs) || dueMs <= now) return null;
  if (dueMs - DAY > now) return dueMs - DAY;
  if (dueMs - HOUR > now) return dueMs - HOUR;
  return null;
}

