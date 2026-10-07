const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("videoConcat", {
  selectSources: () => ipcRenderer.invoke("video-concat:select-sources"),
  run: (paths) => ipcRenderer.invoke("video-concat:run", paths),
  showInFolder: (filePath) => ipcRenderer.send("video-concat:show-in-folder", filePath),
  onProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("video-concat:progress", listener);
    return () => ipcRenderer.removeListener("video-concat:progress", listener);
  },
});
