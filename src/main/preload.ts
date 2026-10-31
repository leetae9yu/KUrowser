import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kurowser", {
  version: () => ipcRenderer.invoke("version"),
});
