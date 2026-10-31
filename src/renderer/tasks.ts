import { Bell, Download, ExternalLink, Megaphone, Play } from "lucide-react";
import { useMemo } from "react";
import { assignments, courseById, files, lectures, notices, type CourseId, type FileItem, type Notice } from "./data";
import { humanTime } from "./format";
import { jobFor, useStore } from "./store";

export type TaskKind = "assignment" | "lecture" | "files" | "notices" | "remind";

export interface Task {
  id: string;
  kind: TaskKind;
  courseId?: CourseId;
  headline: string;
  detail: string;
  action: string;
  icon: typeof Bell;
  doneLine: string;
  /** Shown while the do-everything run is working on this task. */
  doing: string;
  /** Tasks the app can finish without the student (files, notices, reminders). */
  auto: boolean;
  files?: FileItem[];
  summary?: Notice[];
  run: () => void;
}

const DAY = 86_400_000;

/** Everything the student should do now, most urgent first, in plain words. */
export function useTasks(): Task[] {
  const { opened, watched, read, reminders, jobs, openAssignment, watch, download, markRead, remind, showToast } = useStore();
  return useMemo(() => {
    const now = Date.now();
    const list: (Task & { rank: number; at: number })[] = [];

    const due = assignments.filter((a) => !a.submitted && a.due.getTime() > now && a.due.getTime() - now < 7 * DAY);
    for (const a of due) {
      if (opened.has(a.id)) continue;
      const [label, ...rest] = a.title.split(":");
      const c = courseById[a.courseId];
      list.push({
        id: `a-${a.id}`,
        kind: "assignment",
        courseId: a.courseId,
        headline: `${c.name} ${label}, ${humanTime(a.due)}까지 내야 해요`,
        detail: `${rest.join(":").trim() || label}\n내는 건 학교 화면에서 해요`,
        action: "과제 페이지 열기",
        icon: ExternalLink,
        doneLine: "과제 페이지를 열었어요",
        doing: "과제 페이지 여는 중",
        auto: false,
        run: () => openAssignment(a),
        rank: a.due.getTime() - now < DAY ? 0 : 2,
        at: a.due.getTime(),
      });
    }

    for (const l of lectures) {
      if (l.watchedAtStart || watched.has(l.id)) continue;
      const c = courseById[l.courseId];
      list.push({
        id: `l-${l.id}`,
        kind: "lecture",
        courseId: l.courseId,
        headline: `${c.name} 강의, ${humanTime(l.until).replace(/\s자정\s전$/, "")}까지 봐야 출석 인정돼요`,
        detail: `${l.title} · ${l.minutes}분`,
        action: "강의 틀기",
        icon: Play,
        doneLine: "강의를 틀었어요",
        doing: "강의 트는 중",
        auto: false,
        run: () => watch(l),
        rank: l.until.getTime() - now < 2 * DAY ? 0 : 2,
        at: l.until.getTime(),
      });
    }

    const unread = notices.filter((n) => !n.readAtStart && !read.has(n.id));
    if (unread.length) {
      list.push({
        id: "notices",
        kind: "notices",
        headline: `새 공지 ${unread.length}개, 한 줄씩 줄였어요`,
        detail: "",
        action: "다 읽었어요",
        icon: Megaphone,
        doneLine: `공지 ${unread.length}개를 한 줄씩 줄였어요`,
        doing: `공지 ${unread.length}개 줄이는 중`,
        auto: true,
        summary: unread,
        run: () => markRead(unread.map((n) => n.id)),
        rank: 1,
        at: 0,
      });
    }

    const byCourse = new Map<CourseId, FileItem[]>();
    for (const f of files) {
      if (!f.isNew || jobFor(jobs, f.id)) continue;
      byCourse.set(f.courseId, [...(byCourse.get(f.courseId) ?? []), f]);
    }
    for (const [courseId, group] of byCourse) {
      list.push({
        id: `f-${courseId}`,
        kind: "files",
        courseId,
        headline: `${courseById[courseId].name}에 새 자료 ${group.length}개가 올라왔어요`,
        detail: group.map((f) => f.name).join("\n"),
        action: `${group.length}개 받기`,
        icon: Download,
        doneLine: `${courseById[courseId].name} 자료 ${group.length}개를 받았어요`,
        doing: `${courseById[courseId].name} 자료 ${group.length}개 받는 중`,
        auto: true,
        files: group,
        run: () => download(group),
        rank: 1,
        at: 1,
      });
    }

    const noAlarm = due.filter((a) => !reminders.has(a.id));
    if (noAlarm.length) {
      list.push({
        id: "remind",
        kind: "remind",
        headline: `마감 ${noAlarm.length}개, 하루 전에 알려 드릴까요?`,
        detail: noAlarm.map((a) => courseById[a.courseId].name).join(", "),
        action: "알림 켜기",
        icon: Bell,
        doneLine: `마감 ${noAlarm.length}개에 하루 전 알림을 켰어요`,
        doing: `마감 ${noAlarm.length}개에 알림 켜는 중`,
        auto: true,
        run: () => {
          remind(noAlarm.map((a) => a.id));
          showToast(`마감 ${noAlarm.length}개에 하루 전 알림을 켰어요`);
        },
        rank: 1,
        at: 2,
      });
    }

    return list.sort((a, b) => a.rank - b.rank || a.at - b.at);
  }, [opened, watched, read, reminders, jobs, openAssignment, watch, download, markRead, remind, showToast]);
}
