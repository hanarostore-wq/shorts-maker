const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("concatWorker", {
  onProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("concat-worker:progress", listener);
    return () => ipcRenderer.removeListener("concat-worker:progress", listener);
  },
});
