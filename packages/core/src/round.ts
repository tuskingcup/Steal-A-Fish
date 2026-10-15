import { rollCatch, type Catch } from "./fish";
import { Leaderboard } from "./leaderboard";
import type { Rng } from "./rng";

/**
 * Round-based play. Viewers opt in each round (by typing the join command in chat); everyone who
 * joined casts automatically on a timer, and gifts add extra casts. A round runs for a fixed time,
 * then a summary is shown for a while before the next round opens. Ranking is by the total sell
 * price of every fish a player caught this round.
 *
 * Pure and clock-free: the caller passes `now` (ms) everywhere, so it is fully testable.
 */

export type RoundPhase = "idle" | "open" | "summary";

export interface RoundConfig {
  roundMs: number;
  summaryMs: number;
  /** Every joined player gets a free cast this often. */
  autoCastMs: number;
  /** Delay before a new player's first free cast. */
  firstCastMs: number;
}

export const DEFAULT_ROUND_CONFIG: RoundConfig = {
  roundMs: 5 * 60_000,
  summaryMs: 60_000,
  autoCastMs: 30_000,
  firstCastMs: 3_000,
};

export interface CaughtFish extends Catch {
  /** Unique within the round. */
  id: number;
  at: number;
}

export interface CatchEvent {
  round: number;
  userId: string;
  name: string;
  fish: CaughtFish;
  /** True when this fish is the player's new heaviest. */
  personalBest: boolean;
  /** The player's round total (coins) including this fish. */
  totalValue: number;
}

export interface RoundState {
  phase: RoundPhase;
  round: number;
  /** When the current phase ends (ms epoch), or null while idle. */
  endsAt: number | null;
  players: number;
}

export interface PlayerSummary {
  userId: string;
  name: string;
  rank: number;
  bestLog10: number;
  /** log10 of the summed weight of every fish. */
  totalLog10: number;
  /** Total sell price of every fish (what the ranking uses). */
  totalValue: number;
  /** Most valuable first. */
  fish: CaughtFish[];
}

/** One row of the live leaderboard (the TikTok overlay). */
export interface Standing {
  rank: number;
  userId: string;
  name: string;
  /** Total sell price of every fish this round, in points. */
  points: number;
  fish: number;
}

export interface RoundSummary {
  round: number;
  players: PlayerSummary[];
}

interface Player {
  userId: string;
  name: string;
  fish: CaughtFish[];
  best: number;
  value: number;
  pity: number;
  nextAutoCast: number;
}

export interface TickResult {
  catches: CatchEvent[];
  /** Set when the round just ended. */
  ended: RoundSummary | null;
  /** True when a new round just opened. */
  started: boolean;
}

export type JoinResult = "joined" | "already" | "queued";

export class RoundGame {
  private phase: RoundPhase = "idle";
  private round = 0;
  private endsAt: number | null = null;
  private players = new Map<string, Player>();
  /** Joined during the summary (or before the first round): they play next round. */
  private queued = new Map<string, string>();
  /** Pity carries over between rounds; it is about luck, not the round. */
  private pity = new Map<string, number>();
  private board = new Leaderboard();
  private nextFishId = 1;
  private frenzyUntil = 0;
  private frenzyBoost = 1;
  private lastSummary: RoundSummary | null = null;

  constructor(
    private readonly rng: Rng,
    private readonly config: RoundConfig = DEFAULT_ROUND_CONFIG,
  ) {}

  state(): RoundState {
    return { phase: this.phase, round: this.round, endsAt: this.endsAt, players: this.players.size };
  }

  /** Open the next round now. Players who queued during the summary are in it. */
  start(now: number): void {
    this.round++;
    this.phase = "open";
    this.endsAt = now + this.config.roundMs;
    this.players.clear();
    this.board = new Leaderboard();
    this.frenzyUntil = 0;
    const queued = [...this.queued];
    this.queued.clear();
    for (const [userId, name] of queued) this.addPlayer(userId, name, now);
  }

  /** Close the round now and move to the summary. */
  end(now: number): RoundSummary {
    this.phase = "summary";
    this.endsAt = now + this.config.summaryMs;
    this.lastSummary = this.summary();
    return this.lastSummary;
  }

  join(userId: string, name: string, now: number): JoinResult {
    if (this.phase !== "open") {
      if (this.queued.has(userId)) return "already";
      this.queued.set(userId, name);
      return "queued";
    }
    const existing = this.players.get(userId);
    if (existing) {
      existing.name = name;
      return "already";
    }
    this.addPlayer(userId, name, now);
    return "joined";
  }

  /** Who is playing this round (for a renderer that reloaded mid-round). */
  roster(): { userId: string; name: string }[] {
    return [...this.players.values()].map((p) => ({ userId: p.userId, name: p.name }));
  }

  isPlaying(userId: string): boolean {
    return this.phase === "open" && this.players.has(userId);
  }

  /** Rare-and-above chances are multiplied by `boost` until `until`. */
  frenzy(until: number, boost: number): void {
    this.frenzyUntil = until;
    this.frenzyBoost = boost;
  }

  /** Extra casts (from gifts). Ignored unless the round is open and the viewer has joined. */
  cast(userId: string, count: number, now: number, rareBoost = 1): CatchEvent[] {
    const player = this.players.get(userId);
    if (this.phase !== "open" || !player) return [];
    const events: CatchEvent[] = [];
    for (let i = 0; i < count; i++) events.push(this.castOnce(player, now, rareBoost));
    return events;
  }

  tick(now: number): TickResult {
    const result: TickResult = { catches: [], ended: null, started: false };
    if (this.phase === "open") {
      for (const player of this.players.values()) {
        if (now >= player.nextAutoCast) {
          result.catches.push(this.castOnce(player, now, 1));
          player.nextAutoCast = now + this.config.autoCastMs;
        }
      }
      if (this.endsAt !== null && now >= this.endsAt) result.ended = this.end(now);
    } else if (this.phase === "summary" && this.endsAt !== null && now >= this.endsAt) {
      this.start(now);
      result.started = true;
    }
    return result;
  }

  /** Ranks 1–3 by total value (the current #1 keeps it on a tie). */
  podium(): { userId: string; name: string }[] {
    return this.board.top(3).map((id) => ({ userId: id, name: this.players.get(id)?.name ?? id }));
  }

  /** Everyone in the round, best first by total value; players who caught nothing come last. */
  private ranked(): string[] {
    const order = this.board.top(this.players.size);
    const placed = new Set(order);
    return [...order, ...[...this.players.keys()].filter((id) => !placed.has(id))];
  }

  /** The live leaderboard: everyone in the round (or the finished one, during the summary). */
  standings(): Standing[] {
    return this.ranked().map((id, i) => {
      const p = this.players.get(id)!;
      return { rank: i + 1, userId: id, name: p.name, points: p.value, fish: p.fish.length };
    });
  }

  /** Everyone in the round, ranked by total value; players who caught nothing come last. */
  summary(): RoundSummary {
    const ranked = this.ranked();
    return {
      round: this.round,
      players: ranked.map((id, i) => {
        const p = this.players.get(id)!;
        return {
          userId: id,
          name: p.name,
          rank: i + 1,
          bestLog10: p.best,
          totalLog10: sumLog10(p.fish.map((f) => f.weightLog10)),
          totalValue: p.value,
          fish: [...p.fish].sort((a, b) => b.price - a.price || b.weightLog10 - a.weightLog10),
        };
      }),
    };
  }

  /** The summary of the last finished round (what the summary screen shows). */
  lastRoundSummary(): RoundSummary | null {
    return this.lastSummary;
  }

  private addPlayer(userId: string, name: string, now: number): void {
    this.players.set(userId, {
      userId,
      name,
      fish: [],
      best: -Infinity,
      value: 0,
      pity: this.pity.get(userId) ?? 0,
      nextAutoCast: now + this.config.firstCastMs,
    });
  }

  private castOnce(player: Player, now: number, rareBoost: number): CatchEvent {
    const boost = rareBoost * (now < this.frenzyUntil ? this.frenzyBoost : 1);
    const { fish, pity } = rollCatch(this.rng, { pity: player.pity, rareBoost: boost });
    player.pity = pity;
    this.pity.set(player.userId, pity);
    const caught: CaughtFish = { ...fish, id: this.nextFishId++, at: now };
    player.fish.push(caught);
    const personalBest = fish.weightLog10 > player.best;
    if (personalBest) player.best = fish.weightLog10;
    player.value += fish.price;
    this.board.set(player.userId, player.value);
    return { round: this.round, userId: player.userId, name: player.name, fish: caught, personalBest, totalValue: player.value };
  }
}

/** log10(Σ 10^x) without overflow. */
export function sumLog10(values: number[]): number {
  if (values.length === 0) return -Infinity;
  const max = Math.max(...values);
  return max + Math.log10(values.reduce((s, v) => s + 10 ** (v - max), 0));
}
