const DAY_MS = 86_400_000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const today0 = startOfDay(new Date());

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** A moment relative to today: at(1, 18) = tomorrow 18:00. */
export function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = addDays(today0, dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** A moment relative to now, in minutes ago. */
export function minutesAgo(m: number): Date {
  return new Date(Date.now() - m * 60_000);
}

export function dayDiff(d: Date): number {
  return Math.round((startOfDay(d).getTime() - today0.getTime()) / DAY_MS);
}

export function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function dateLabel(d: Date): string {
  const n = dayDiff(d);
  if (n === 0) return "오늘";
  if (n === 1) return "내일";
  if (n === -1) return "어제";
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAYS[d.getDay()]})`;
}

export function dueLabel(d: Date): string {
  return `${dateLabel(d)} ${hm(d)}`;
}

export function fullDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
}

export function weekdayShort(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

export function ago(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}분 전`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

export type Urgency = "urgent" | "soon" | "later";

export function urgency(d: Date): Urgency {
  const hours = (d.getTime() - Date.now()) / 3_600_000;
  if (hours < 24) return "urgent";
  if (hours < 72) return "soon";
  return "later";
}

/** Monday of the week that is offsetWeeks away from the current week. */
export function weekStart(offsetWeeks = 0): Date {
  const mondayIndex = (today0.getDay() + 6) % 7;
  return addDays(today0, -mondayIndex + offsetWeeks * 7);
}

export function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${mb.toFixed(1)}MB`;
}

/** Plain-language time: "오늘 자정 전", "내일 저녁 6시", "11월 3일 화요일 자정 전". */
export function humanTime(d: Date): string {
  const n = dayDiff(d);
  const day =
    n === 0 ? "오늘" : n === 1 ? "내일" : n === 2 ? "모레" : `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
  const h = d.getHours();
  const m = d.getMinutes();
  const part = h < 12 ? "오전" : h < 18 ? "오후" : h < 21 ? "저녁" : "밤";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const text = h === 23 && m === 59 ? `${day} 자정 전` : `${day} ${part} ${h12}시${m ? ` ${m}분` : ""}`;
  // One time phrase never breaks across lines.
  return text.replace(/ /g, "\u00a0");
}
