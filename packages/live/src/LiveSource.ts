import type { LiveEvent } from "@saf/core";

export type ConnectionState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; roomId?: string }
  | { status: "error"; message: string };

export type LiveEventListener = (event: LiveEvent) => void;
export type StateListener = (state: ConnectionState) => void;

/**
 * A source of normalized live events. All platform-specific code stays behind this
 * interface so the game never imports a TikTok library directly.
 */
export interface LiveSource {
  readonly kind: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(listener: LiveEventListener): () => void;
  onState(listener: StateListener): () => void;
}

/** Shared listener bookkeeping for LiveSource implementations. */
export abstract class BaseLiveSource implements LiveSource {
  abstract readonly kind: string;
  private readonly eventListeners = new Set<LiveEventListener>();
  private readonly stateListeners = new Set<StateListener>();
  protected state: ConnectionState = { status: "disconnected" };

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  onEvent(listener: LiveEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  protected emit(event: LiveEvent): void {
    for (const l of this.eventListeners) l(event);
  }

  protected setState(state: ConnectionState): void {
    this.state = state;
    for (const l of this.stateListeners) l(state);
  }
}
