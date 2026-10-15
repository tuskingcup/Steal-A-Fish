import type { Viewer } from "@saf/core";
import { BaseLiveSource } from "./LiveSource";

const SAMPLE_VIEWERS: Viewer[] = [
  { userId: "sim-1", uniqueId: "nong_ploy", nickname: "Ploy" },
  { userId: "sim-2", uniqueId: "mek_za", nickname: "Mek" },
  { userId: "sim-3", uniqueId: "boss_fishing", nickname: "Boss" },
  { userId: "sim-4", uniqueId: "jj_99", nickname: "JJ" },
  { userId: "sim-5", uniqueId: "pla_too", nickname: "ปลาทู" },
  { userId: "sim-6", uniqueId: "auntie_noi", nickname: "ป้าน้อย" },
  { userId: "sim-7", uniqueId: "kao_niao", nickname: "ข้าวเหนียว" },
  { userId: "sim-8", uniqueId: "captain_tum", nickname: "กัปตันตั้ม" },
  { userId: "sim-9", uniqueId: "mint.chan", nickname: "Mint" },
  { userId: "sim-10", uniqueId: "lung_dam", nickname: "ลุงดำ" },
];

const CROWD_NAMES = ["น้องฟ้า", "Toey", "แม่ค้าส้มตำ", "Ice", "พี่หมี", "Bank", "ยายจันทร์", "Nut", "เจ๊ติ๋ม", "Gun", "น้ำหวาน", "Beam"];

/**
 * Fake live source for development and for the "test" buttons in settings.
 * Lets the whole game run without going live.
 */
export class SimulatedLiveSource extends BaseLiveSource {
  readonly kind = "simulator";
  private seq = 0;
  private crowd = 0;

  async connect(): Promise<void> {
    this.setState({ status: "connected", roomId: "simulator" });
  }

  async disconnect(): Promise<void> {
    this.setState({ status: "disconnected" });
  }

  sendGift(opts: { giftId: number; giftName: string; diamonds: number; repeatCount?: number; viewer?: Viewer }): void {
    this.emit({
      type: "gift",
      eventId: this.nextId(),
      at: Date.now(),
      viewer: opts.viewer ?? this.randomViewer(),
      giftId: opts.giftId,
      giftName: opts.giftName,
      diamonds: opts.diamonds,
      repeatCount: opts.repeatCount ?? 1,
    });
  }

  sendLikes(likeCount: number, viewer?: Viewer): void {
    this.emit({ type: "like", eventId: this.nextId(), at: Date.now(), viewer: viewer ?? this.randomViewer(), likeCount });
  }

  sendComment(text: string, viewer?: Viewer): void {
    this.emit({ type: "comment", eventId: this.nextId(), at: Date.now(), viewer: viewer ?? this.randomViewer(), text });
  }

  sendFollow(viewer?: Viewer): void {
    this.emit({ type: "follow", eventId: this.nextId(), at: Date.now(), viewer: viewer ?? this.randomViewer() });
  }

  /** A viewer who hasn't appeared before, for testing a full dock and beach. */
  newViewer(): Viewer {
    const n = ++this.crowd;
    const name = `${CROWD_NAMES[(n - 1) % CROWD_NAMES.length]}${n > CROWD_NAMES.length ? ` ${Math.ceil(n / CROWD_NAMES.length)}` : ""}`;
    return { userId: `sim-crowd-${n}`, uniqueId: `crowd_${n}`, nickname: name };
  }

  private nextId(): string {
    return `sim-${Date.now()}-${++this.seq}`;
  }

  private randomViewer(): Viewer {
    return SAMPLE_VIEWERS[Math.floor(Math.random() * SAMPLE_VIEWERS.length)] ?? SAMPLE_VIEWERS[0]!;
  }
}
