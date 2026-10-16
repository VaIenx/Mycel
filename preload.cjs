const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mycel", {
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  createProject: (name) => ipcRenderer.invoke("project:create", name),
  currentProject: () => ipcRenderer.invoke("project:current"),
  saveChapter: (chapter) => ipcRenderer.invoke("chapter:save", chapter),
  deleteChapter: (id) => ipcRenderer.invoke("chapter:delete", id),
  saveCharacter: (character) => ipcRenderer.invoke("character:save", character),
  chooseCharacterImage: () => ipcRenderer.invoke("character:choose-image"),
  deleteCharacter: (id) => ipcRenderer.invoke("character:delete", id),
  saveSettings: (settings) => ipcRenderer.invoke("project:settings", settings),
  saveSession: (entry) => ipcRenderer.invoke("project:session", entry),
});
