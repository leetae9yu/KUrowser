import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kurowser", {
  ping: () => ipcRenderer.invoke("ping"),
});
