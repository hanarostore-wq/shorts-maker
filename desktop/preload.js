const { contextBridge, ipcRenderer } = require("electron");

// 셸 UI(탭바·주소창)만 이 통로를 쓴다. 탭 안에 로드되는 외부 사이트에는
// 이 preload가 붙지 않으므로, 쇼핑몰 페이지가 탭을 조작할 수는 없다.
contextBridge.exposeInMainWorld("shell", {
  list: () => ipcRenderer.invoke("tabs:list"),
  newTab: (url) => ipcRenderer.invoke("tabs:new", url),
  activate: (id) => ipcRenderer.invoke("tabs:activate", id),
  close: (id) => ipcRenderer.invoke("tabs:close", id),
  navigate: (id, url) => ipcRenderer.invoke("tabs:navigate", { id, url }),
  back: (id) => ipcRenderer.invoke("tabs:back", id),
  forward: (id) => ipcRenderer.invoke("tabs:forward", id),
  reload: (id) => ipcRenderer.invoke("tabs:reload", id),
  info: () => ipcRenderer.invoke("app:info"),
  onTabs: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("tabs:state", listener);
    return () => ipcRenderer.removeListener("tabs:state", listener);
  },
});
