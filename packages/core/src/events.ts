/**
 * Normalized live events. Every LiveSource (TikTok, simulator, ...) emits these,
 * so nothing downstream depends on a specific platform library.
 */

export interface Viewer {
  /** Stable platform user id. Never key players by username: usernames change. */
  userId: string;
  /** Latest display handle, e.g. "nong_ploy". */
  uniqueId: string;
  nickname: string;
  avatarUrl?: string;
}

interface BaseEvent {
  /** Platform event id, used for idempotency. */
  eventId: string;
  /** Epoch milliseconds. */
  at: number;
  viewer: Viewer;
}

export interface GiftEvent extends BaseEvent {
  type: "gift";
  giftId: number;
  giftName: string;
  /** Diamond value of ONE gift. */
  diamonds: number;
  /**
   * How many of this gift were sent. For streakable gifts the source must emit
   * a single event when the streak ends, carrying the final repeat count.
   */
  repeatCount: number;
}

export interface LikeEvent extends BaseEvent {
  type: "like";
  /** Likes in this batch. */
  likeCount: number;
  /** Room total reported by the platform, if known. */
  totalLikeCount?: number;
}

export interface CommentEvent extends BaseEvent {
  type: "comment";
  text: string;
}

export interface FollowEvent extends BaseEvent {
  type: "follow";
}

export interface ShareEvent extends BaseEvent {
  type: "share";
}

export type LiveEvent = GiftEvent | LikeEvent | CommentEvent | FollowEvent | ShareEvent;
