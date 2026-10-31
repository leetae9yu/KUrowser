import { Bell, CalendarDays, Download, ExternalLink, Megaphone, Play, School } from "lucide-react";
import { useMemo } from "react";
import { courseOf, type CourseId, type FileItem, type Notice } from "./data";
import { humanTime } from "./format";
import { jobFor, useStore } from "./store";

export type TaskKind = "assignment" | "lecture" | "files" | "notices" | "remind" | "portal" | "schedule";

export interface Task {
  id: string;
  kind: TaskKind;
  courseId?: CourseId;
  headline: string;
  detail: string;
  action: string;
  icon: typeof Bell;
  doneLine: string;
  doing: string;
  auto: boolean;
  files?: FileItem[];
  summary?: Notice[];
  run: () => void | Promise<void>;
}

const DAY = 86_400_000;

export function useTasks(): Task[] {
  const { data, sites, settings, opened, watched, read, reminders, jobs, openAssignment, watch, download, markRead, summarize, remind, openSchoolPage } = useStore();
  return useMemo(() => {
    const now = Date.now();
    const list: (Task & { rank: number; at: number })[] = [];
    const due = data.assignments.filter((a) => !a.submitted && a.due.getTime() > now && a.due.getTime() - now < 7 * DAY);

    for (const a of due) {
      if (opened.has(a.id)) continue;
      const c = courseOf(data, a.courseId);
      list.push({
        id: `a-${a.id}`,
        kind: "assignment",
        courseId: a.courseId,
        headline: `${c.name} 과제, ${humanTime(a.due)}까지 내야 해요`,
        detail: `${a.title}\n내는 건 학교 화면에서 해요`,
        action: "과제 화면 열기",
        icon: ExternalLink,
        doneLine: "과제 화면을 열었어요",
        doing: "과제 화면 여는 중",
        auto: false,
        run: () => openAssignment(a),
        rank: a.due.getTime() - now < DAY ? 0 : 2,
        at: a.due.getTime(),
      });
    }

    for (const l of data.lectures) {
      if (watched.has(l.id)) continue;
      const c = courseOf(data, l.courseId);
      const until = l.until;
      list.push({
        id: `l-${l.id}`,
        kind: "lecture",
        courseId: l.courseId,
        headline: until ? `${c.name} 강의, ${humanTime(until).replace(/\s자정\s전$/, "")}까지 봐야 출석 인정돼요` : `${c.name} 강의를 아직 안 봤어요`,
        detail: l.week ? `${l.week}주차 ${l.title}` : l.title,
        action: "강의 화면 열기",
        icon: Play,
        doneLine: "강의 화면을 열었어요",
        doing: "강의 화면 여는 중",
        auto: false,
        run: () => watch(l),
        rank: until && until.getTime() - now < 2 * DAY ? 0 : 2,
        at: until?.getTime() ?? now + 30 * DAY,
      });
    }

    const unread = data.notices.filter((n) => !read.has(n.id));
    if (unread.length) {
      const ai = !!settings?.aiConnected;
      const summarized = unread.every((n) => n.summary);
      list.push({
        id: "notices",
        kind: "notices",
        headline: summarized ? `새 공지 ${unread.length}개, 한 줄씩 줄였어요` : `새 공지 ${unread.length}개가 올라왔어요`,
        detail: "",
        action: "다 읽었어요",
        icon: Megaphone,
        doneLine: ai ? `공지 ${unread.length}개를 한 줄씩 줄였어요` : `공지 ${unread.length}개를 확인했어요`,
        doing: ai ? `공지 ${unread.length}개 줄이는 중` : `공지 ${unread.length}개 확인하는 중`,
        auto: true,
        summary: unread,
        run: async () => {
          if (ai) await summarize(unread.map((n) => n.id));
          markRead(unread.map((n) => n.id));
        },
        rank: 1,
        at: 0,
      });
    }

    const byCourse = new Map<CourseId, FileItem[]>();
    for (const f of data.files) {
      if (!f.isNew || jobFor(jobs, f.id)) continue;
      byCourse.set(f.courseId, [...(byCourse.get(f.courseId) ?? []), f]);
    }
    for (const [courseId, group] of byCourse) {
      const name = courseOf(data, courseId).name;
      list.push({
        id: `f-${courseId}`,
        kind: "files",
        courseId,
        headline: `${name}에 새 자료 ${group.length}개가 올라왔어요`,
        detail: group.map((f) => f.name).join("\n"),
        action: `${group.length}개 받기`,
        icon: Download,
        doneLine: `${name} 자료 ${group.length}개를 받았어요`,
        doing: `${name} 자료 ${group.length}개 받는 중`,
        auto: true,
        files: group,
        run: () => {
          download(group);
        },
        rank: 1,
        at: 1,
      });
    }

    const portalNew = sites.portal.data.notices.filter((n) => !n.read && !read.has(n.id));
    if (portalNew.length) {
      list.push({
        id: "portal",
        kind: "portal",
        headline: `학교 공지 ${portalNew.length}개가 새로 올라왔어요`,
        detail: portalNew.slice(0, 3).map((n) => n.title).join("\n"),
        action: "다 읽었어요",
        icon: School,
        doneLine: `학교 공지 ${portalNew.length}개를 확인했어요`,
        doing: `학교 공지 ${portalNew.length}개 확인하는 중`,
        auto: true,
        run: () => markRead(portalNew.map((n) => n.id)),
        rank: 1,
        at: 3,
      });
    }

    // An academic calendar line starting within three days, shown once until the student opens it.
    const soon = sites.portal.data.schedule.find((e) => {
      const start = new Date(`${e.start}T00:00:00`).getTime();
      return start >= now - DAY && start - now < 3 * DAY && !opened.has(`s-${e.start}-${e.event}`);
    });
    if (soon) {
      list.push({
        id: `s-${soon.start}-${soon.event}`,
        kind: "schedule",
        headline: `학사 일정: ${soon.event}`,
        detail: `${Number(soon.start.slice(5, 7))}월 ${soon.label}`,
        action: "학사 일정 보기",
        icon: CalendarDays,
        doneLine: "학사 일정 화면을 열었어요",
        doing: "학사 일정 여는 중",
        auto: false,
        run: () => openSchoolPage("calendar", `s-${soon.start}-${soon.event}`),
        rank: 2,
        at: new Date(`${soon.start}T00:00:00`).getTime(),
      });
    }

    const noAlarm = due.filter((a) => !reminders.has(a.id));
    if (noAlarm.length && settings?.notifyDue !== false) {
      list.push({
        id: "remind",
        kind: "remind",
        headline: `마감 ${noAlarm.length}개, 하루 전에 알려 드릴까요?`,
        detail: [...new Set(noAlarm.map((a) => courseOf(data, a.courseId).name))].join(", "),
        action: "알림 켜기",
        icon: Bell,
        doneLine: `마감 ${noAlarm.length}개에 하루 전 알림을 켰어요`,
        doing: `마감 ${noAlarm.length}개에 알림 켜는 중`,
        auto: true,
        run: () => remind(noAlarm.map((a) => a.id)),
        rank: 1,
        at: 2,
      });
    }

    return list.sort((a, b) => a.rank - b.rank || a.at - b.at);
  }, [data, sites, settings, opened, watched, read, reminders, jobs, openAssignment, watch, download, markRead, summarize, remind, openSchoolPage]);
}
