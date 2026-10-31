import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";

import type { KuLmsConfig } from "../engine/config.ts";

const NO_CREDENTIALS: KuLmsConfig = { userId: "", password: "" };

/** Unpackaged dev runs may sign the hidden engine in from an env file; the shipped app never reads one. */
export function devConfig(): KuLmsConfig {
  const path = process.env.KUROWSER_DEV_ENV_FILE;
  if (app.isPackaged || !path || !existsSync(path)) return NO_CREDENTIALS;
  const values: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    const index = line.indexOf("=");
    if (!line || line.startsWith("#") || index < 0) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { userId: values.KU_LMS_ID ?? "", password: values.KU_LMS_PWD ?? "" };
}
