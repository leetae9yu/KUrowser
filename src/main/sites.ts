import type { PortalNotice, SitesSnapshot } from "../shared/types.ts";
import type { DiskCache } from "./cache.ts";
import { academicSchedule, portalBody, portalNotices, SCHOOL_MENUS } from "./portal.ts";
import { SiteError, type SiteGet } from "./site-text.ts";

/** Portal posts older than this count as read; the board gets several posts a day. */
const NOTICE_NEW_DAYS = 3;
/** Bodies are read for the newest posts only, a few at a time. */
const BODY_POSTS = 8;
const BODY_LANES = 3;

export type SitesCache = Omit<SitesSnapshot, "menus">;

const empty = (): SitesCache => ({ portal: { data: { notices: [], schedule: [] }, fetchedAt: null, error: null } });

const friendly = (error: unknown): string => (error instanceof SiteError ? error.message : "학교 사이트를 읽지 못했어요");

export interface SitesDeps {
  get: SiteGet;
  cache: DiskCache<SitesCache>;
  readNotices: () => ReadonlySet<string>;
}

/**
 * Portal and the other school sites, read with the session the student signed in with. Reads are plain GETs over the
 * app's school session, so they need no window of their own. The last result shows first and is replaced part by part.
 */
export class SitesService {
  private state: SitesCache;
  private listeners = new Set<(s: SitesSnapshot) => void>();
  private refreshing: Promise<void> | null = null;

  constructor(private readonly deps: SitesDeps) {
    this.state = { ...empty(), ...deps.cache.read() };
  }

  snapshot(): SitesSnapshot {
    const read = this.deps.readNotices();
    const newSince = Date.now() - NOTICE_NEW_DAYS * 86_400_000;
    const notices = this.state.portal.data.notices.map((n) => ({ ...n, read: read.has(n.id) || Date.parse(n.postedAt) < newSince }));
    return { ...this.state, portal: { ...this.state.portal, data: { ...this.state.portal.data, notices } }, menus: [...SCHOOL_MENUS] };
  }

  subscribe(fn: (s: SitesSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private set(change: Partial<SitesCache>): void {
    const next = { ...this.state, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.deps.cache.write(this.state);
    this.emit();
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.loadPortal().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  noticeUrl(id: string): string | null {
    return this.state.portal.data.notices.find((n) => n.id === id)?.url || null;
  }

  private async loadPortal(): Promise<void> {
    const old = this.state.portal;
    const get = this.deps.get;
    const [notices, schedule] = await Promise.allSettled([portalNotices(get), academicSchedule(get)]);
    const known = new Map(old.data.notices.map((n) => [n.id, n.body]));
    const list: PortalNotice[] = notices.status === "fulfilled" ? notices.value.map((n) => ({ ...n, body: known.get(n.id) ?? "" })) : old.data.notices;
    const failed = [notices, schedule].find((r): r is PromiseRejectedResult => r.status === "rejected");
    this.set({
      portal: {
        data: { notices: list, schedule: schedule.status === "fulfilled" ? schedule.value : old.data.schedule },
        fetchedAt: failed ? old.fetchedAt : new Date().toISOString(),
        error: failed ? friendly(failed.reason) : null,
      },
    });
    const missing = list.slice(0, BODY_POSTS).filter((n) => !n.body);
    const queue = [...missing];
    const bodies = new Map<string, string>();
    await Promise.all(
      Array.from({ length: BODY_LANES }, async () => {
        for (let n = queue.shift(); n; n = queue.shift()) bodies.set(n.id, await portalBody(get, n).catch(() => ""));
      }),
    );
    if (!bodies.size) return;
    const current = this.state.portal;
    this.set({ portal: { ...current, data: { ...current.data, notices: current.data.notices.map((n) => (bodies.get(n.id) ? { ...n, body: bodies.get(n.id)! } : n)) } } });
  }

  clear(): void {
    this.deps.cache.clear();
    this.state = empty();
    this.emit();
  }
}
