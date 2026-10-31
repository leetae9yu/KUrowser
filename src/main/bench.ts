import { readFileSync, writeFileSync } from "node:fs";

import type { GatewayClient } from "./ai.ts";
import { CHAT_PROMPT, chatUserPrompt, jevRequest, parseJev, parseLlmRoute, ROUTE_PROMPT, routeUserPrompt, type Route } from "./route.ts";

interface Item {
  text: string;
  kind: Route["kind"];
  topic?: Route["topic"];
  course?: string;
  facts?: string[];
}
interface Data {
  courses: string[];
  context: string;
  items: Item[];
}
interface Row {
  i: number;
  kindOk: boolean;
  slotOk: boolean | null;
  confidence: number;
  ms: number;
  chatOk?: boolean;
  chatMs?: number;
  error?: string;
}

const log = (label: string, value: unknown): void => console.log(`BENCH ${label} ${JSON.stringify(value)}`);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const factsOk = (reply: string, facts: string[]): boolean => reply.length > 0 && facts.every((f) => f.split("|").some((alt) => reply.includes(alt)));

/**
 * Dev-only: compares Jev and cheap chat models on the labelled sentences. KUROWSER_BENCH = "pilot" (first 5 items)
 * or "full"; KUROWSER_BENCH_MODELS = comma list ("jev-latest" is the decisions model). Credits are read before and
 * after each model so the spend is measured, not estimated; no further model starts once the run has spent KUROWSER_BENCH_BUDGET.
 */
const BATCH_ROUTE_PROMPT = `${ROUTE_PROMPT}
여러 문장이 번호와 함께 주어져. 문장 순서대로 위 JSON을 담은 JSON 배열 하나만 써.`;
const BATCH_CHAT_PROMPT = `${CHAT_PROMPT}
학생 질문이 번호와 함께 여러 개 주어져. 질문마다 따로 답하고, 답을 질문 순서대로 담은 JSON 문자열 배열 하나만 써.`;
const JEV_BATCH = 10;

function jsonArray(raw: string): unknown[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  try {
    const v = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Batch bench: every Gateway call carries a flat filter fee, so each model sees all sentences in a few calls
 * (LLMs: one routing call and one chat call; Jev: 10 sentences x 3 questions per decisions call, its limit is 32).
 * Credits are read around every call and the run stops when one call costs more than KUROWSER_BENCH_CALL_MAX.
 */
async function batchBench(gateway: GatewayClient, data: Data, outPath: string): Promise<void> {
  const models = (process.env.KUROWSER_BENCH_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const callMax = Number(process.env.KUROWSER_BENCH_CALL_MAX ?? "8");
  const budget = Number(process.env.KUROWSER_BENCH_BUDGET ?? "70");
  const start = await gateway.credits();
  const results: Record<string, unknown> = {};
  let stop = false;
  const call = async <T>(label: string, fn: () => Promise<T>): Promise<{ value: T | null; ms: number; credits: number | null }> => {
    const before = await gateway.credits();
    if (start !== null && before !== null && start - before >= budget) {
      stop = true;
      return { value: null, ms: 0, credits: null };
    }
    const t0 = performance.now();
    const value = await fn().catch((e: Error) => {
      log("call_error", { label, error: e.message });
      return null;
    });
    const ms = Math.round(performance.now() - t0);
    const after = await gateway.credits();
    const credits = before !== null && after !== null ? Math.round((before - after) * 1000) / 1000 : null;
    log("call", { label, ms, credits });
    if (credits !== null && credits > callMax) stop = true;
    return { value, ms, credits };
  };
  const items = data.items;
  const numbered = (list: Item[]) => list.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
  const score = (routes: Array<Route | null>) => {
    const slots = items.map((it, i) => ({ it, r: routes[i] })).filter(({ it }) => it.kind === "command" || it.kind === "path");
    return {
      kind: `${items.filter((it, i) => routes[i]?.kind === it.kind).length}/${items.length}`,
      slots: `${slots.filter(({ it, r }) => r?.kind === it.kind && r.topic === it.topic && r.course === it.course).length}/${slots.length}`,
      write: `${items.filter((it, i) => it.kind === "write" && routes[i]?.kind === "write").length}/${items.filter((it) => it.kind === "write").length}`,
      lowConfidence: routes.filter((r) => r && r.confidence < 0.6).length,
    };
  };
  for (const model of models) {
    if (stop) break;
    if (model.startsWith("jev")) {
      const routes: Array<Route | null> = [];
      let ms = 0;
      let credits = 0;
      for (let s = 0; s < items.length && !stop; s += JEV_BATCH) {
        const chunk = items.slice(s, s + JEV_BATCH);
        const base = jevRequest("", data.courses) as { questions: Record<string, { type: string; instructions: string; criteria: unknown }> };
        const questions: Record<string, unknown> = {};
        chunk.forEach((_, i) => {
          for (const q of ["kind", "topic", "course"]) questions[`${q}_${i + 1}`] = { ...base.questions[q]!, instructions: `문장 ${i + 1}: ${base.questions[q]!.instructions}` };
        });
        const r = await call(`${model}#${s / JEV_BATCH + 1}`, () => gateway.decide({ model, state: { 이번_학기_과목: data.courses, 학생_문장들: numbered(chunk) }, questions }));
        ms += r.ms;
        credits += r.credits ?? 0;
        const answers = (r.value as { answers?: Record<string, unknown> } | null)?.answers ?? {};
        chunk.forEach((_, i) => routes.push(parseJev({ answers: { kind: answers[`kind_${i + 1}`], topic: answers[`topic_${i + 1}`], course: answers[`course_${i + 1}`] } }, data.courses)));
      }
      results[model] = { ...score(routes), msPerCall: Math.round(ms / Math.ceil(items.length / JEV_BATCH)), credits: Math.round(credits * 100) / 100, calls: Math.ceil(items.length / JEV_BATCH) };
    } else {
      const route = await call(`${model}#route`, () => gateway.complete(BATCH_ROUTE_PROMPT, `과목: ${data.courses.join(", ")}\n${numbered(items)}`, 4000, model));
      const routes = jsonArray(route.value ?? "").map((v) => parseLlmRoute(JSON.stringify(v), data.courses));
      if (stop) {
        results[model] = { ...score(routes), routeMs: route.ms, credits: route.credits };
        break;
      }
      const chats = items.filter((it) => it.kind === "chat");
      const chat = await call(`${model}#chat`, () => gateway.complete(BATCH_CHAT_PROMPT, chatUserPrompt(numbered(chats), data.context), 4000, model));
      const replies = jsonArray(chat.value ?? "").map(String);
      const chatOk = chats.filter((it, i) => factsOk(replies[i] ?? "", it.facts ?? [])).length;
      results[model] = { ...score(routes), chat: `${chatOk}/${chats.length}`, routeMs: route.ms, chatMs: chat.ms, credits: Math.round(((route.credits ?? 0) + (chat.credits ?? 0)) * 100) / 100 };
    }
    log("model", { model, ...(results[model] as object) });
  }
  const end = await gateway.credits();
  log("total_credits", start !== null && end !== null ? Math.round((start - end) * 100) / 100 : null);
  if (stop) log("stopped", "a call passed the per-call limit or the budget ran out");
  writeFileSync(outPath, JSON.stringify(results, null, 1));
}

export async function runBench(gateway: GatewayClient, dataPath: string, outPath: string): Promise<void> {
  await gateway.restore();
  if (!gateway.connected) return log("error", "no stored key");
  if (process.env.KUROWSER_BENCH === "usage") {
    log("credits", await gateway.credits());
    log("usage", await gateway.usage(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)));
    for (const type of ["decisions", "audio"]) log(`models_${type}`, await gateway.models(type));
    return;
  }
  const data = JSON.parse(readFileSync(dataPath, "utf8")) as Data;
  if (process.env.KUROWSER_BENCH === "batch") return batchBench(gateway, data, outPath);
  const items = process.env.KUROWSER_BENCH === "full" ? data.items : data.items.slice(0, 5).concat(data.items.slice(30, 32));
  const models = (process.env.KUROWSER_BENCH_MODELS ?? "jev-latest").split(",").map((m) => m.trim()).filter(Boolean);
  const budget = Number(process.env.KUROWSER_BENCH_BUDGET ?? "10");
  const available = new Set([...(await gateway.models("llm")), ...(await gateway.models("decisions"))]);
  // The decisions list names versions (jev-1.14.0); the documented alias jev-latest points at the newest one.
  if ([...available].some((m) => m.startsWith("jev-"))) available.add("jev-latest");
  log("available", models.map((m) => [m, available.has(m)]));
  const start = await gateway.credits();
  const results: Record<string, { rows: Row[]; credits: number | null }> = {};
  for (const model of models) {
    if (!available.has(model)) continue;
    const before = await gateway.credits();
    if (start !== null && before !== null && start - before >= budget) break;
    const rows: Row[] = [];
    for (const [i, item] of items.entries()) {
      const t0 = performance.now();
      let route: Route | null = null;
      let error: string | undefined;
      try {
        route =
          model === "jev-latest"
            ? parseJev(await gateway.decide(jevRequest(item.text, data.courses)), data.courses)
            : parseLlmRoute(await gateway.complete(ROUTE_PROMPT, routeUserPrompt(item.text, data.courses), 120, model), data.courses);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const ms = Math.round(performance.now() - t0);
      const kindOk = route?.kind === item.kind;
      const slotOk = item.kind === "command" || item.kind === "path" ? kindOk && route?.topic === item.topic && route?.course === item.course : null;
      const row: Row = { i, kindOk, slotOk, confidence: route?.confidence ?? 0, ms, ...(error ? { error } : {}) };
      if (item.kind === "chat" && model !== "jev-latest") {
        const c0 = performance.now();
        const reply = await gateway.complete(CHAT_PROMPT, chatUserPrompt(item.text, data.context), 200, model).catch(() => "");
        row.chatMs = Math.round(performance.now() - c0);
        row.chatOk = factsOk(reply, item.facts ?? []);
      }
      rows.push(row);
    }
    const after = await gateway.credits();
    results[model] = { rows, credits: before !== null && after !== null ? Math.round((before - after) * 1000) / 1000 : null };
    const r = results[model]!;
    const slots = rows.filter((x) => x.slotOk !== null);
    const chats = rows.filter((x) => x.chatOk !== undefined);
    log("model", {
      model,
      n: rows.length,
      kind: `${rows.filter((x) => x.kindOk).length}/${rows.length}`,
      slots: `${slots.filter((x) => x.slotOk).length}/${slots.length}`,
      chat: chats.length ? `${chats.filter((x) => x.chatOk).length}/${chats.length}` : "-",
      routeMs: median(rows.map((x) => x.ms)),
      chatMs: chats.length ? median(chats.map((x) => x.chatMs ?? 0)) : null,
      credits: r.credits,
      errors: rows.filter((x) => x.error).length,
    });
  }
  const end = await gateway.credits();
  log("total_credits", start !== null && end !== null ? Math.round((start - end) * 1000) / 1000 : null);
  writeFileSync(outPath, JSON.stringify(results, null, 1));
}
