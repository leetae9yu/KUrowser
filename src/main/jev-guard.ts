import type { AiFailure, FailStatus } from "../shared/types.ts";

export const JEV_MODEL = "jev-latest";

export class GatewayError extends Error {
  constructor(
    readonly status: FailStatus,
    readonly detail = "",
  ) {
    super(status === "timeout" ? "AI 호출이 시간 안에 끝나지 않았어요" : status === "network" ? "AI 서버에 닿지 못했어요" : `AI 호출이 실패했어요 (HTTP ${status})`);
  }
}

/** Jev is skipped this long after two server-side failures in a row, so an outage does not bill every sentence. */
export const JEV_PAUSE_MS = 10 * 60_000;

/** A failure on the Gateway's side (5xx, no answer in time, no answer at all), not one of the request. */
export const serverSide = (status: FailStatus): boolean => typeof status !== "number" || status >= 500;

const statusOf = (error: unknown): FailStatus => (error instanceof GatewayError ? error.status : "network");
const detailOf = (error: unknown): string => (error instanceof GatewayError ? error.detail : error instanceof Error ? error.message : String(error)).slice(0, 200);

/**
 * Counts Jev failures and pauses Jev after two server-side ones in a row. The first call after the pause tries Jev
 * once again; if that one fails on the server side too, Jev pauses for another round.
 */
export class JevGuard {
  private streak = 0;
  private until = 0;
  failures = 0;
  last: AiFailure | null = null;

  constructor(
    private readonly onFailure: (failure: AiFailure) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  /** When the pause ends, as an ISO time; null while Jev is called normally. */
  pausedUntil(): string | null {
    return this.now() < this.until ? new Date(this.until).toISOString() : null;
  }

  /** One Jev call unless paused. Failures are recorded and returned, never thrown. */
  async run(model: string, call: () => Promise<unknown>): Promise<{ ok: true; body: unknown } | { ok: false; status: FailStatus | "paused" }> {
    if (this.pausedUntil()) return { ok: false, status: "paused" };
    try {
      const body = await call();
      this.streak = 0;
      return { ok: true, body };
    } catch (error) {
      const status = statusOf(error);
      this.record(model, error);
      if (!serverSide(status)) this.streak = 0;
      else if (++this.streak >= 2) {
        this.until = this.now() + JEV_PAUSE_MS;
        this.streak = 1;
      }
      return { ok: false, status };
    }
  }

  /** Records a failed AI call (Jev or the chat model) without touching the pause. */
  record(model: string, error: unknown): void {
    this.failures++;
    this.last = { at: new Date(this.now()).toISOString(), status: statusOf(error), model, detail: detailOf(error) };
    this.onFailure(this.last);
  }
}

/**
 * Classifies a sentence with Jev, or with the chat model when Jev failed on the server side or is paused. A request
 * Jev refused (4xx) or an answer that does not parse gives null, and the chat offers its common requests as buttons.
 */
export async function classify<R>(
  guard: JevGuard,
  jevModel: string,
  jev: () => Promise<unknown>,
  parseJev: (body: unknown) => R | null,
  luna: { model: () => string; call: () => Promise<string>; parse: (raw: string) => R | null },
): Promise<{ route: R | null; via: "jev" | "luna" | null }> {
  const result = await guard.run(jevModel, jev);
  if (result.ok) return { route: parseJev(result.body), via: "jev" };
  if (result.status !== "paused" && !serverSide(result.status)) return { route: null, via: null };
  try {
    return { route: luna.parse(await luna.call()), via: "luna" };
  } catch (error) {
    guard.record(luna.model(), error);
    return { route: null, via: null };
  }
}
