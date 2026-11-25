const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  setLanguage: (language) => ipcRenderer.invoke("set-language", language),
  start: () => ipcRenderer.invoke("start-proxy"),
  stop: () => ipcRenderer.invoke("stop-proxy"),
  openLog: () => ipcRenderer.invoke("open-log"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  },
});
