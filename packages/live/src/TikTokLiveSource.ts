import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import type { Viewer } from "@saf/core";
import { BaseLiveSource } from "./LiveSource";

export interface TikTokLiveSourceOptions {
  /** Streamer's TikTok username, with or without "@". */
  uniqueId: string;
  /** Optional Euler Stream sign-server API key. Never commit it; load from settings. */
  signApiKey?: string;
  /** Max delay between reconnect attempts. */
  maxBackoffMs?: number;
}

// Minimal structural types for the fields we read. The library's payload types are large
// protobuf interfaces; keeping our own narrow view means a library update fails loudly here.
interface ImageLike {
  urlList?: string[];
}
interface UserLike {
  id?: string;
  displayId?: string;
  nickname?: string;
  avatarThumb?: ImageLike;
}
interface CommonLike {
  msgId?: string;
  createTime?: string;
}

/**
 * Live events from TikTok via the unofficial `tiktok-live-connector`.
 * All TikTok-specific code lives in this file.
 */
export class TikTokLiveSource extends BaseLiveSource {
  readonly kind = "tiktok";
  private connection: TikTokLiveConnection | null = null;
  private manualDisconnect = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: TikTokLiveSourceOptions) {
    super();
  }

  async connect(): Promise<void> {
    this.manualDisconnect = false;
    this.setState({ status: "connecting" });

    const connection = new TikTokLiveConnection(this.options.uniqueId, {
      signApiKey: this.options.signApiKey,
      processInitialData: false,
      enableExtendedGiftInfo: true,
    });
    this.connection = connection;
    this.wire(connection);

    try {
      const state = await connection.connect();
      this.attempt = 0;
      this.setState({ status: "connected", roomId: String(state.roomId ?? "") });
    } catch (err) {
      this.setState({ status: "error", message: errorMessage(err) });
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const c = this.connection;
    this.connection = null;
    if (c) await c.disconnect().catch(() => undefined);
    this.setState({ status: "disconnected" });
  }

  private wire(c: TikTokLiveConnection): void {
    c.on(WebcastEvent.GIFT, (data) => {
      const gift = data.gift;
      // Streakable gifts (type 1) fire repeatedly during a combo; count only the final event.
      const streakable = gift?.type === 1;
      if (streakable && !data.repeatEnd) return;
      this.emit({
        type: "gift",
        ...this.base(data.common, data.user),
        giftId: Number(data.giftId || gift?.id || 0),
        giftName: gift?.name ?? "",
        diamonds: gift?.diamondCount ?? 0,
        repeatCount: Math.max(1, data.repeatCount || 1),
      });
    });

    c.on(WebcastEvent.LIKE, (data) => {
      this.emit({
        type: "like",
        ...this.base(data.common, data.user),
        likeCount: data.count,
        totalLikeCount: Number(data.total) || undefined,
      });
    });

    c.on(WebcastEvent.CHAT, (data) => {
      this.emit({ type: "comment", ...this.base(data.common, data.user), text: data.content });
    });

    c.on(WebcastEvent.FOLLOW, (data) => {
      this.emit({ type: "follow", ...this.base(data.common, data.user) });
    });

    c.on(WebcastEvent.SHARE, (data) => {
      this.emit({ type: "share", ...this.base(data.common, data.user) });
    });

    c.on(ControlEvent.DISCONNECTED, () => {
      if (this.manualDisconnect || c !== this.connection) return;
      this.setState({ status: "error", message: "disconnected" });
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) return;
    const max = this.options.maxBackoffMs ?? 30_000;
    const delay = Math.min(max, 1000 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private base(common: CommonLike | undefined, user: UserLike | undefined): { eventId: string; at: number; viewer: Viewer } {
    const at = Number(common?.createTime) || Date.now();
    return {
      eventId: common?.msgId || `tt-${at}-${Math.random().toString(36).slice(2)}`,
      at,
      viewer: toViewer(user),
    };
  }
}

function toViewer(user: UserLike | undefined): Viewer {
  return {
    userId: user?.id ?? "unknown",
    uniqueId: user?.displayId ?? "",
    nickname: user?.nickname ?? "",
    avatarUrl: user?.avatarThumb?.urlList?.[0],
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
