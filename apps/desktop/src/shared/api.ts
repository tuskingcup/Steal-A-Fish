import type { CatchEvent, FiredAction, LiveEvent, RoundState, RoundSummary, RulesConfig, StealEvent } from "@saf/core";
import type { ConnectionState } from "@saf/live";

/** IPC channel names. Keep main, preload and renderers in sync through this file. */
export const IPC = {
  rulesGet: "rules:get",
  rulesSave: "rules:save",
  liveConnect: "live:connect",
  liveDisconnect: "live:disconnect",
  liveState: "live:state",
  simGift: "sim:gift",
  simLikes: "sim:likes",
  simComment: "sim:comment",
  simFollow: "sim:follow",
  simCrowd: "sim:crowd",
  gameAction: "game:action",
  gamePodium: "game:podium",
  gameRound: "game:round",
  gameCatch: "game:catch",
  gameJoined: "game:joined",
  gameSummary: "game:summary",
  gameSteal: "game:steal",
  gameLucky: "game:lucky",
  rulesChanged: "rules:changed",
  roundStart: "round:start",
  roundEnd: "round:end",
  logEntry: "log:entry",
  overlayUrl: "overlay:url",
  copyText: "clipboard:write",
} as const;

export interface SimGiftInput {
  giftId: number;
  giftName: string;
  diamonds: number;
  repeatCount?: number;
}

export interface ConnectInput {
  uniqueId: string;
  signApiKey?: string;
}

/** A podium entry. The podium is ranks 1–3, best first; #1 wears the crown. */
export interface RankedPlayer {
  userId: string;
  name: string;
}

/** A viewer typed the join command. `queued`: it was between rounds, so they play next round. */
export interface JoinedEvent {
  userId: string;
  name: string;
  queued: boolean;
}

/** A lucky-draw gift (ใจส้ม) picked one of the gift tiers for this viewer. */
export interface LuckyEvent {
  userId: string;
  name: string;
  /** The picked option's label (a key into the Thai gift-tier names). */
  label: string;
}

export type SaveRulesResult = { ok: true } | { ok: false; error: string };

export interface LogEntry {
  at: number;
  event: LiveEvent;
  fired: FiredAction[];
}

/** API exposed to renderers as `window.saf` by the preload script. */
export interface SafApi {
  getRules(): Promise<RulesConfig>;
  saveRules(config: unknown): Promise<SaveRulesResult>;
  connectTikTok(input: ConnectInput): Promise<void>;
  disconnectLive(): Promise<void>;
  simulateGift(input: SimGiftInput): Promise<void>;
  simulateLikes(count: number): Promise<void>;
  simulateComment(text: string): Promise<void>;
  simulateFollow(): Promise<void>;
  /** `count` brand-new viewers each type the join command and send a rose. */
  simulateCrowd(count: number): Promise<void>;
  /** Open a new round now (ends the current one first). */
  startRound(): Promise<void>;
  /** End the current round now and show the summary. */
  endRound(): Promise<void>;
  onLiveState(listener: (state: ConnectionState) => void): () => void;
  onGameAction(listener: (action: FiredAction) => void): () => void;
  onPodium(listener: (podium: RankedPlayer[]) => void): () => void;
  onRound(listener: (state: RoundState) => void): () => void;
  onCatch(listener: (event: CatchEvent) => void): () => void;
  onJoined(listener: (event: JoinedEvent) => void): () => void;
  onSteal(listener: (event: StealEvent) => void): () => void;
  onLucky(listener: (event: LuckyEvent) => void): () => void;
  /** rules.json changed (saved in settings or edited by hand). */
  onRulesChanged(listener: (config: RulesConfig) => void): () => void;
  onSummary(listener: (summary: RoundSummary) => void): () => void;
  /** The leaderboard overlay's link for TikTok LIVE Studio (null if no local port was free). */
  overlayUrl(): Promise<string | null>;
  copyText(text: string): Promise<void>;
  onLog(listener: (entry: LogEntry) => void): () => void;
}
