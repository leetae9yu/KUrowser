// Waits for the installed app's first window over CDP and saves a screenshot. No school login.
import { writeFileSync } from "node:fs";

const port = Number(process.env.SMOKE_PORT || 9333);
const out = process.env.SMOKE_SHOT || "smoke.png";
const deadline = Date.now() + 120_000;

async function appTarget() {
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === "page" && t.url.startsWith("app://kurowser/"));
      if (target) return target;
    } catch {
      // The app is still starting.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("no KUrowser window within 120 s");
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = async (method, params = {}) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    const reply = await new Promise((resolve) => pending.set(n, resolve));
    if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  };
  return { send, close: () => ws.close() };
}

const target = await appTarget();
const page = cdp(target.webSocketDebuggerUrl);
let text = "";
while (Date.now() < deadline && !text.trim()) {
  const r = await page.send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true });
  text = String(r.result.value || "");
  if (!text.trim()) await new Promise((r) => setTimeout(r, 1000));
}
const shot = await page.send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
page.close();
console.log(`window: ${target.title} ${target.url}`);
console.log(`first screen text: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
if (!text.trim()) throw new Error("the first window stayed empty");
