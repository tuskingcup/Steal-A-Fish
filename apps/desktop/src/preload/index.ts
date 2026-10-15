import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type SafApi } from "../shared/api";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: SafApi = {
  getRules: () => ipcRenderer.invoke(IPC.rulesGet),
  saveRules: (config) => ipcRenderer.invoke(IPC.rulesSave, config),
  connectTikTok: (input) => ipcRenderer.invoke(IPC.liveConnect, input),
  disconnectLive: () => ipcRenderer.invoke(IPC.liveDisconnect),
  simulateGift: (input) => ipcRenderer.invoke(IPC.simGift, input),
  simulateLikes: (count) => ipcRenderer.invoke(IPC.simLikes, count),
  simulateComment: (text) => ipcRenderer.invoke(IPC.simComment, text),
  simulateFollow: () => ipcRenderer.invoke(IPC.simFollow),
  simulateCrowd: (count) => ipcRenderer.invoke(IPC.simCrowd, count),
  onLiveState: (listener) => subscribe(IPC.liveState, listener),
  onGameAction: (listener) => subscribe(IPC.gameAction, listener),
  onPodium: (listener) => subscribe(IPC.gamePodium, listener),
  onRound: (listener) => subscribe(IPC.gameRound, listener),
  onCatch: (listener) => subscribe(IPC.gameCatch, listener),
  onJoined: (listener) => subscribe(IPC.gameJoined, listener),
  onSummary: (listener) => subscribe(IPC.gameSummary, listener),
  startRound: () => ipcRenderer.invoke(IPC.roundStart),
  endRound: () => ipcRenderer.invoke(IPC.roundEnd),
  onLog: (listener) => subscribe(IPC.logEntry, listener),
};

contextBridge.exposeInMainWorld("saf", api);
