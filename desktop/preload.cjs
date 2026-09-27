const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("taffyDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  loadVoiceSettings: () => ipcRenderer.invoke("taffy:voice-settings:load"),
  saveVoiceSettings: (settings) => ipcRenderer.invoke("taffy:voice-settings:save", settings)
}));
