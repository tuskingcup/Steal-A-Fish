/**
 * Tracks each viewer's score, who holds #1 (the crown, and the steal target) and the podium.
 *
 * Placeholder scoring until GameCore exists: points = fish caught (cast/net counts).
 * GameCore will feed the real ranking value (e.g. heaviest fish's weight_log10) instead.
 */
export class Leaderboard {
  private readonly scores = new Map<string, number>();
  private championId: string | null = null;

  /** Add points; returns true if this changed who is #1. */
  add(userId: string, points: number): boolean {
    this.scores.set(userId, (this.scores.get(userId) ?? 0) + points);
    return this.recompute();
  }

  /** Set an absolute score (for values that can go down, like after a steal). */
  set(userId: string, score: number): boolean {
    this.scores.set(userId, score);
    return this.recompute();
  }

  score(userId: string): number {
    return this.scores.get(userId) ?? 0;
  }

  champion(): string | null {
    return this.championId;
  }

  /** Top `n` scorers, best first. The champion leads; other ties keep who got there first. */
  top(n: number): string[] {
    const ranked = [...this.scores.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]) // stable: equal scores keep insertion order
      .map(([id]) => id);
    if (this.championId !== null) {
      ranked.splice(ranked.indexOf(this.championId), 1);
      ranked.unshift(this.championId);
    }
    return ranked.slice(0, n);
  }

  /** The current champion keeps the crown on a tie; a challenger must strictly beat them. */
  private recompute(): boolean {
    let best = this.championId;
    let bestScore = best === null ? -Infinity : this.score(best);
    for (const [id, s] of this.scores) {
      if (s > bestScore) {
        best = id;
        bestScore = s;
      }
    }
    if (best !== null && bestScore <= 0) best = null;
    const changed = best !== this.championId;
    this.championId = best;
    return changed;
  }
}
