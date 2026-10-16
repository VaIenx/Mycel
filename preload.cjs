const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mycel", {
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  createProject: (name) => ipcRenderer.invoke("project:create", name),
  currentProject: () => ipcRenderer.invoke("project:current"),
  recentProjects: () => ipcRenderer.invoke("project:recent"),
  forgetRecentProject: (root) =>
    ipcRenderer.invoke("project:forget-recent", root),
  openRecentProject: (root) => ipcRenderer.invoke("project:open-recent", root),
  saveChapter: (chapter) => ipcRenderer.invoke("chapter:save", chapter),
  deleteChapter: (id) => ipcRenderer.invoke("chapter:delete", id),
  saveCharacter: (character) => ipcRenderer.invoke("character:save", character),
  chooseCharacterImage: () => ipcRenderer.invoke("character:choose-image"),
  deleteCharacter: (id) => ipcRenderer.invoke("character:delete", id),
  savePlace: (place) => ipcRenderer.invoke("place:save", place),
  choosePlaceImage: () => ipcRenderer.invoke("place:choose-image"),
  deletePlace: (id) => ipcRenderer.invoke("place:delete", id),
  saveSettings: (settings) => ipcRenderer.invoke("project:settings", settings),
  saveSession: (entry) => ipcRenderer.invoke("project:session", entry),
});
