import type { FiredAction, LiveEvent, RulesConfig } from "@saf/core";
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
  logEntry: "log:entry",
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
  /** `count` brand-new viewers each send a rose. */
  simulateCrowd(count: number): Promise<void>;
  onLiveState(listener: (state: ConnectionState) => void): () => void;
  onGameAction(listener: (action: FiredAction) => void): () => void;
  onPodium(listener: (podium: RankedPlayer[]) => void): () => void;
  onLog(listener: (entry: LogEntry) => void): () => void;
}
