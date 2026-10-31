import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { KurowserApi } from "../shared/types.ts";

function listen<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: KurowserApi = {
  snapshot: () => ipcRenderer.invoke("snapshot"),
  refresh: () => ipcRenderer.invoke("refresh"),
  onSnapshot: (fn) => listen("snapshot", fn),
  login: () => ipcRenderer.invoke("login"),
  logout: () => ipcRenderer.invoke("logout"),
  openAssignment: (id) => ipcRenderer.invoke("openAssignment", id),
  openLecture: (id) => ipcRenderer.invoke("openLecture", id),
  openNotice: (id) => ipcRenderer.invoke("openNotice", id),
  markRead: (ids) => ipcRenderer.invoke("markRead", ids),
  summarize: (ids) => ipcRenderer.invoke("summarize", ids),
  remind: (ids) => ipcRenderer.invoke("remind", ids),
  download: (ids) => ipcRenderer.invoke("download", ids),
  cancelDownloads: () => ipcRenderer.invoke("cancelDownloads"),
  onDownload: (fn) => listen("download", fn),
  openDownloads: () => ipcRenderer.invoke("openDownloads"),
  settings: () => ipcRenderer.invoke("settings"),
  setNotifyDue: (on) => ipcRenderer.invoke("setNotifyDue", on),
  connectAi: () => ipcRenderer.invoke("connectAi"),
  onAiStatus: (fn) => listen("aiStatus", fn),
  onSettings: (fn) => listen("settings", fn),
  paneState: () => ipcRenderer.invoke("paneState"),
  onPane: (fn) => listen("pane", fn),
  paneBack: () => ipcRenderer.invoke("paneBack"),
  paneClose: () => ipcRenderer.invoke("paneClose"),
  paneWiden: () => ipcRenderer.invoke("paneWiden"),
  interpret: (text) => ipcRenderer.invoke("interpret", text),
  chat: (text) => ipcRenderer.invoke("chat", text),
  sttPlan: (id) => ipcRenderer.invoke("sttPlan", id),
  sttRun: (id) => ipcRenderer.invoke("sttRun", id),
  onStt: (fn) => listen("stt", fn),
  openFolder: (path) => ipcRenderer.invoke("openFolder", path),
};

contextBridge.exposeInMainWorld("kurowser", api);
