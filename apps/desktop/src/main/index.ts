import { join } from "node:path";
import { BrowserWindow, app, clipboard, ipcMain, shell } from "electron";
import { DEFAULT_ROUND_CONFIG, guaranteeOf, mathRandomRng, pickLucky, RoundGame, RuleEngine, type CastAction, type CatchEvent, type FiredAction, type LiveEvent, type RulesConfig, type Viewer } from "@saf/core";
import { SimulatedLiveSource, TikTokLiveSource, type LiveSource } from "@saf/live";
import { IPC, type ConnectInput, type JoinedEvent, type LogEntry, type LuckyEvent, type RankedPlayer, type SimGiftInput } from "../shared/api";
import { RulesStore } from "./rulesStore";
import { startOverlay } from "./overlay";

let gameWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

const simulator = new SimulatedLiveSource();
let live: LiveSource = simulator;
let unsubscribeLive: Array<() => void> = [];

/** Typing exactly this in chat joins the current round (or queues for the next one). */
const JOIN_COMMAND = "1";

// All randomness and game state live here; renderers only animate what they're sent.
const game = new RoundGame(mathRandomRng);
let lastPodium = "";

const displayName = (v: Viewer) => v.nickname || v.uniqueId;

function sendToGame(channel: string, payload: unknown): void {
  if (gameWindow && !gameWindow.isDestroyed()) gameWindow.webContents.send(channel, payload);
}

function sendRound(): void {
  broadcast(IPC.gameRound, game.state());
}

function sendPodium(force = false): void {
  const list: RankedPlayer[] = game.podium();
  const json = JSON.stringify(list);
  if (!force && json === lastPodium) return;
  lastPodium = json;
  sendToGame(IPC.gamePodium, list);
}

function emitCatches(events: CatchEvent[]): void {
  for (const e of events) sendToGame(IPC.gameCatch, e);
  if (events.length > 0) sendPodium();
}

function joinRound(viewer: Viewer): void {
  const result = game.join(viewer.userId, displayName(viewer), Date.now());
  if (result === "already") return;
  const joined: JoinedEvent = { userId: viewer.userId, name: displayName(viewer), queued: result === "queued" };
  sendToGame(IPC.gameJoined, joined);
  sendRound();
}

/** Likes and gifts are a clear wish to play: their senders join automatically, so nothing is wasted. */
function ensureJoined(viewer: Viewer): void {
  if (game.state().phase === "open" && !game.isPlaying(viewer.userId)) joinRound(viewer);
}

function castFor(viewer: Viewer, action: CastAction, times: number): void {
  const boost = action.bait ? 1.5 : 1;
  emitCatches(game.cast(viewer.userId, action.count * times, Date.now(), boost, guaranteeOf(action)));
}

/** Turn a fired rule into game state changes. */
function apply(fired: FiredAction): void {
  const { action, viewer, times } = fired;
  const now = Date.now();
  switch (action.type) {
    case "cast":
      ensureJoined(viewer);
      castFor(viewer, action, times);
      break;
    case "net":
      ensureJoined(viewer);
      emitCatches(game.cast(viewer.userId, action.count * times, now));
      break;
    case "lucky":
      ensureJoined(viewer);
      if (!game.isPlaying(viewer.userId)) break;
      for (let i = 0; i < times; i++) {
        const pick = pickLucky(mathRandomRng, action.options);
        sendToGame(IPC.gameLucky, { userId: viewer.userId, name: displayName(viewer), label: pick.label ?? "" } satisfies LuckyEvent);
        castFor(viewer, pick.cast, 1);
      }
      break;
    case "steal":
      ensureJoined(viewer);
      for (let i = 0; i < times; i++) {
        if (mathRandomRng.next() >= action.successRate) continue;
        const stolen = game.steal(viewer.userId);
        if (!stolen) break;
        sendToGame(IPC.gameSteal, stolen);
        sendPodium();
      }
      break;
    case "frenzy":
      game.frenzy(now + action.durationSec * 1000, action.rareMultiplier);
      break;
    default:
      break;
  }
}

function startRound(): void {
  if (game.state().phase === "open") endRound();
  game.start(Date.now());
  announceNewRound();
}

/** Round state first (the game window clears the dock on a new round), then who is already in it. */
function announceNewRound(): void {
  sendRound();
  for (const p of game.roster()) sendToGame(IPC.gameJoined, { ...p, queued: false } satisfies JoinedEvent);
  lastPodium = "";
  sendPodium(true);
}

/** Round and summary lengths come from settings (rules.json); the round in progress picks them up too. */
function applyRoundTimes(config: RulesConfig): void {
  const roundMs = config.round?.roundSec !== undefined ? config.round.roundSec * 1000 : DEFAULT_ROUND_CONFIG.roundMs;
  const summaryMs = config.round?.summarySec !== undefined ? config.round.summarySec * 1000 : DEFAULT_ROUND_CONFIG.summaryMs;
  game.setTimes(roundMs, summaryMs);
  sendRound();
}

function endRound(): void {
  if (game.state().phase !== "open") return;
  sendToGame(IPC.gameSummary, game.end(Date.now()));
  sendRound();
}

function tick(): void {
  const result = game.tick(Date.now());
  emitCatches(result.catches);
  if (result.ended) {
    sendToGame(IPC.gameSummary, result.ended);
    sendRound();
  }
  if (result.started) announceNewRound();
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
  if (event.type === "comment" && event.text.trim() === JOIN_COMMAND) joinRound(event.viewer);
  const fired = engine.handle(event);
  for (const action of fired) {
    sendToGame(IPC.gameAction, action);
    apply(action);
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
    (config) => {
      engine.setConfig(config);
      applyRoundTimes(config);
      broadcast(IPC.rulesChanged, config);
    },
    (message) => console.error(message),
  );
  engine.setConfig(rules.get());
  applyRoundTimes(rules.get());
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
  // A brand-new viewer each time: follow rewards are once per viewer.
  ipcMain.handle(IPC.simFollow, () => simulator.sendFollow(simulator.newViewer()));
  ipcMain.handle(IPC.simCrowd, (_e, count: number) => {
    for (let i = 0; i < Math.min(count, 50); i++) {
      const viewer = simulator.newViewer();
      simulator.sendComment(JOIN_COMMAND, viewer);
      simulator.sendGift({ giftId: 5655, giftName: "Rose", diamonds: 1, viewer });
    }
  });
  // Leaderboard overlay for TikTok LIVE Studio: a local web page with the live standings.
  const overlay = startOverlay(() => ({ state: game.state(), standings: game.standings() }));
  ipcMain.handle(IPC.overlayUrl, async () => (await overlay).url);
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(String(text)));

  ipcMain.handle(IPC.roundStart, () => startRound());
  ipcMain.handle(IPC.roundEnd, () => endRound());

  game.start(Date.now());
  const ticker = setInterval(tick, 500);

  // 540×960 is a quarter of the 1080×1920 portrait stream frame; OBS scales it up.
  gameWindow = createWindow("game", { width: 540, height: 960, title: "Steal A Fish — Game", backgroundColor: "#0C2B40" });
  settingsWindow = createWindow("settings", { width: 1100, height: 780, title: "Steal A Fish — Settings", backgroundColor: "#0E1C24" });

  gameWindow.on("closed", () => (gameWindow = null));
  // A reloaded game window (e.g. dev HMR) catches up on the round, its players and the podium.
  gameWindow.webContents.on("did-finish-load", () => {
    sendRound();
    for (const p of game.roster()) sendToGame(IPC.gameJoined, { ...p, queued: false } satisfies JoinedEvent);
    const summary = game.lastRoundSummary();
    if (game.state().phase === "summary" && summary) sendToGame(IPC.gameSummary, summary);
    sendPodium(true);
  });
  settingsWindow.webContents.on("did-finish-load", () => sendRound());
  settingsWindow.on("closed", () => (settingsWindow = null));

  app.on("before-quit", () => {
    clearInterval(ticker);
    void overlay.then((o) => o.close());
    rules.close();
    void live.disconnect();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
