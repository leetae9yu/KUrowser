import { Notification } from "electron";

import { fireTime, HOUR } from "./fire-time.ts";
import type { Reminder, StateStore } from "./state.ts";

const MAX_TIMER = 2 ** 31 - 1;

function timeLeft(due: string, at: number): string {
  const hours = Math.round((Date.parse(due) - at) / HOUR);
  return hours >= 20 ? "내일 이맘때" : `${hours}시간 뒤`;
}

export class ReminderScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly store: StateStore) {}

  start(): void {
    for (const reminder of this.store.get().reminders) this.schedule(reminder);
  }

  add(reminders: Reminder[]): number {
    const fresh = reminders.filter((r) => fireTime(r.due) !== null);
    this.store.update((s) => {
      const others = s.reminders.filter((r) => !fresh.some((f) => f.id === r.id));
      s.reminders = [...others, ...fresh];
      s.firedReminders = s.firedReminders.filter((id) => !fresh.some((f) => f.id === id));
    });
    for (const reminder of fresh) this.schedule(reminder);
    // Show one notification now: the student sees what the reminder looks like, and macOS asks for
    // notification permission while the student is here instead of a day before the deadline.
    if (fresh.length && Notification.isSupported()) {
      new Notification({ title: `마감 ${fresh.length}개에 알림을 켰어요`, body: "마감 하루 전에 이렇게 알려 드려요. 그때 앱이 켜져 있어야 해요." }).show();
    }
    return fresh.length;
  }

  stopAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(reminder: Reminder): void {
    clearTimeout(this.timers.get(reminder.id));
    if (this.store.get().firedReminders.includes(reminder.id)) return;
    const at = fireTime(reminder.due);
    if (at === null) return;
    const wait = at - Date.now();
    const timer = setTimeout(() => (wait > MAX_TIMER ? this.schedule(reminder) : this.fire(reminder)), Math.min(Math.max(wait, 0), MAX_TIMER));
    this.timers.set(reminder.id, timer);
  }

  private fire(reminder: Reminder): void {
    this.timers.delete(reminder.id);
    if (!this.store.get().notifyDue) return;
    this.store.update((s) => {
      s.firedReminders = [...s.firedReminders, reminder.id];
    });
    if (!Notification.isSupported()) return;
    new Notification({
      title: `${reminder.course} 마감, ${timeLeft(reminder.due, Date.now())}`,
      body: `「${reminder.title}」 제출은 학교 화면에서 해요`,
    }).show();
  }
}
