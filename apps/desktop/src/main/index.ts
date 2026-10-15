import { join } from "node:path";
import { BrowserWindow, app, ipcMain, shell } from "electron";
import { Leaderboard, RuleEngine, type FiredAction, type LiveEvent } from "@saf/core";
import { SimulatedLiveSource, TikTokLiveSource, type LiveSource } from "@saf/live";
import { IPC, type Champion, type ConnectInput, type LogEntry, type SimGiftInput } from "../shared/api";
import { RulesStore } from "./rulesStore";

let gameWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

const simulator = new SimulatedLiveSource();
let live: LiveSource = simulator;
let unsubscribeLive: Array<() => void> = [];

const leaderboard = new Leaderboard();
/** Latest display name per userId (names change; ids don't). */
const names = new Map<string, string>();

function currentChampion(): Champion | null {
  const id = leaderboard.champion();
  return id === null ? null : { userId: id, name: names.get(id) ?? id };
}

/** Placeholder scoring until GameCore: one point per fish caught. */
function score(fired: FiredAction): void {
  const { action, viewer, times } = fired;
  names.set(viewer.userId, viewer.nickname || viewer.uniqueId);
  const fish = action.type === "cast" || action.type === "net" ? action.count * times : 0;
  if (fish > 0 && leaderboard.add(viewer.userId, fish)) {
    gameWindow?.webContents.send(IPC.gameChampion, currentChampion());
  }
}

function rendererUrl(page: "game" | "settings"): { url?: string; file?: string } {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServer) return { url: `${devServer}/${page}/index.html` };
  return { file: join(__dirname, `../renderer/${page}/index.html`) };
}

function createWindow(page: "game" | "settings", opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    ...opts,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  const target = rendererUrl(page);
  if (target.url) void win.loadURL(target.url);
  else if (target.file) void win.loadFile(target.file);
  return win;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of [gameWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function dispatch(engine: RuleEngine, event: LiveEvent): void {
  const fired = engine.handle(event);
  for (const action of fired) {
    gameWindow?.webContents.send(IPC.gameAction, action);
    score(action);
  }
  const entry: LogEntry = { at: Date.now(), event, fired };
  settingsWindow?.webContents.send(IPC.logEntry, entry);
}

function useLiveSource(source: LiveSource, engine: RuleEngine): void {
  for (const off of unsubscribeLive) off();
  live = source;
  unsubscribeLive = [
    source.onState((state) => broadcast(IPC.liveState, state)),
    source.onEvent((event) => dispatch(engine, event)),
  ];
}

app.whenReady().then(async () => {
  const engine = new RuleEngine({ rules: [] });
  const rules = new RulesStore(
    join(app.getPath("userData"), "rules.json"),
    (config) => engine.setConfig(config),
    (message) => console.error(message),
  );
  engine.setConfig(rules.get());
  rules.watch();

  useLiveSource(simulator, engine);
  await simulator.connect();

  ipcMain.handle(IPC.rulesGet, () => rules.get());
  ipcMain.handle(IPC.rulesSave, (_e, input: unknown) => {
    try {
      rules.save(input);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.liveConnect, async (_e, input: ConnectInput) => {
    if (live !== simulator) await live.disconnect();
    const tiktok = new TikTokLiveSource({ uniqueId: input.uniqueId, signApiKey: input.signApiKey || undefined });
    useLiveSource(tiktok, engine);
    await tiktok.connect();
  });
  ipcMain.handle(IPC.liveDisconnect, async () => {
    if (live !== simulator) await live.disconnect();
    useLiveSource(simulator, engine);
    await simulator.connect();
  });

  // The simulator always works, even while connected to TikTok, so settings "test" buttons
  // can exercise rules during a stream.
  simulator.onEvent((event) => {
    if (live !== simulator) dispatch(engine, event); // otherwise the active subscription handles it
  });
  ipcMain.handle(IPC.simGift, (_e, input: SimGiftInput) => simulator.sendGift(input));
  ipcMain.handle(IPC.simLikes, (_e, count: number) => simulator.sendLikes(count));
  ipcMain.handle(IPC.simComment, (_e, text: string) => simulator.sendComment(text));
  ipcMain.handle(IPC.simFollow, () => simulator.sendFollow());

  // 540×960 is a quarter of the 1080×1920 portrait stream frame; OBS scales it up.
  gameWindow = createWindow("game", { width: 540, height: 960, title: "Steal A Fish — Game", backgroundColor: "#0C2B40" });
  settingsWindow = createWindow("settings", { width: 1100, height: 780, title: "Steal A Fish — Settings", backgroundColor: "#0E1C24" });

  gameWindow.on("closed", () => (gameWindow = null));
  // A reloaded game window (e.g. dev HMR) still shows the current crown.
  gameWindow.webContents.on("did-finish-load", () => gameWindow?.webContents.send(IPC.gameChampion, currentChampion()));
  settingsWindow.on("closed", () => (settingsWindow = null));

  app.on("before-quit", () => {
    rules.close();
    void live.disconnect();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
