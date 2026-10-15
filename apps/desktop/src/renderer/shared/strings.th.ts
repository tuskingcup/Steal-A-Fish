import type { Action, LiveEvent, MutationId, Rarity, RoundPhase } from "@saf/core";

/** All player-facing Thai text lives here. */
export const th = {
  gameTitle: "STEAL A FISH",
  pondVillage: "บ่อหมู่บ้าน",
  waiting: "รอของขวัญจากคนดู…",
  hostName: "เจ้าของท่าเรือ",
  newChampion: "ขึ้นอันดับ 1 แล้ว!",
  joinHint: "พิมพ์ 1 ในแชทเพื่อร่วมเล่น",
  joinNextHint: "พิมพ์ 1 เพื่อจองรอบหน้า",
  joined: "ร่วมเล่นรอบนี้แล้ว!",
  queuedNext: "จองที่รอบหน้าแล้ว",
  round: (n: number) => `รอบที่ ${n}`,
  players: (n: number) => `ผู้เล่น ${n} คน`,
  phase: { idle: "รอเริ่มรอบ", open: "กำลังตกปลา", summary: "สรุปผล" } satisfies Record<RoundPhase, string>,
  nextRoundIn: (t: string) => `รอบใหม่ใน ${t}`,
  timeLeft: (t: string) => `เหลือ ${t}`,
  caught: "ได้",
  newBest: "สถิติใหม่!",
  summaryTitle: (n: number) => `สรุปรอบที่ ${n}`,
  noPlayers: "รอบนี้ยังไม่มีใครเล่น",
  rank: (r: number, of: number) => `อันดับ ${r}/${of}`,
  fishCount: (n: number) => `ปลา ${n} ตัว`,
  heaviest: "หนักสุด",
  total: "รวม",
  noFish: "ยังไม่ได้ปลาเลย",
  browseHint: "← / → ดูปลาของแต่ละคน",

  settingsTitle: "ตั้งค่า Steal A Fish",
  connection: "เชื่อมต่อไลฟ์",
  username: "ชื่อผู้ใช้ TikTok",
  signApiKey: "Sign API key (ไม่บังคับ)",
  connect: "เชื่อมต่อ",
  disconnect: "ตัดการเชื่อมต่อ (กลับไปใช้ตัวจำลอง)",
  status: {
    disconnected: "ยังไม่เชื่อมต่อ",
    connecting: "กำลังเชื่อมต่อ…",
    connected: "เชื่อมต่อแล้ว",
    error: "ผิดพลาด",
  },
  simulator: "จำลองเหตุการณ์ (ทดสอบโดยไม่ต้องไลฟ์)",
  newViewers: (n: number) => `คนดูใหม่ +${n}`,
  roundPanel: "รอบการเล่น",
  startRound: "เริ่มรอบใหม่ทันที",
  endRound: "จบรอบตอนนี้",
  simJoin: "คอมเมนต์ 1 (ร่วมเล่น)",
  roundRules: "รอบละ 5 นาที · พิมพ์ 1 ในแชทเพื่อร่วมเล่น · ทุกคนที่ร่วมเหวี่ยงเบ็ดฟรีทุก 30 วิ · ของขวัญ = เหวี่ยงเพิ่ม (ส่งของขวัญแล้วได้ร่วมเล่นอัตโนมัติ) · จัดอันดับจากปลาตัวที่หนักที่สุด",
  dropRates: "อัตราการได้ปลา (ต่อการเหวี่ยง 1 ครั้ง)",
  mutationRates: "โอกาสกลายพันธุ์ (ซ้อนกันได้)",
  pityNote: "การันตีปลาระดับหายากขึ้นไป ภายใน 30 ครั้ง · FISH FRENZY เพิ่มโอกาสปลาหายาก",
  noRealValue: "เหรียญและปลาไม่มีมูลค่าจริง แลกเป็นเงินหรือของใด ๆ ไม่ได้ และโอนให้กันไม่ได้",
  cameraKeys: "หน้าต่างเกม: ← / → ดูคนตกปลาทีละคน · Esc กลับภาพรวม · ลากเมาส์หมุนกล้อง · ล้อเมาส์ซูม",
  rules: "กฎของขวัญ → เหตุการณ์ (rules.json)",
  rulesHint: "แก้ JSON แล้วกดบันทึก ระบบตรวจรูปแบบก่อนใช้งาน และโหลดใหม่อัตโนมัติถ้าแก้ไฟล์ตรง",
  save: "บันทึก",
  saved: "บันทึกแล้ว",
  invalidJson: "JSON ไม่ถูกต้อง",
  eventLog: "Event log",
  noRuleMatched: "ไม่มีกฎที่ตรง",
} as const;

export function describeAction(action: Action, times: number): string {
  const x = times > 1 ? ` ×${times}` : "";
  switch (action.type) {
    case "cast":
      return `เหวี่ยงเบ็ด ×${action.count * times}${action.bait ? " (เหยื่อพิเศษ)" : ""}`;
    case "net":
      return `อวนลาก ${action.count} ตัว${x}`;
    case "steal":
      return `ขโมยปลา (สำเร็จ ${Math.round(action.successRate * 100)}%)${x}`;
    case "guard":
      return `แมวเฝ้าตู้ ${action.durationSec} วิ${x}`;
    case "frenzy":
      return `FISH FRENZY ${action.durationSec} วิ${x}`;
    case "showCollection":
      return "แสดงสมุดปลา";
    case "boost":
      return `ตู้ผลิตเงิน ×${action.multiplier} ${action.durationSec} วิ`;
  }
}

export function describeEvent(event: LiveEvent): string {
  const who = `@${event.viewer.uniqueId || event.viewer.nickname}`;
  switch (event.type) {
    case "gift":
      return `${who} ส่ง ${event.giftName} (${event.diamonds} เหรียญ) ×${event.repeatCount}`;
    case "like":
      return `${who} กดไลค์ ${event.likeCount}`;
    case "comment":
      return `${who}: ${event.text}`;
    case "follow":
      return `${who} ติดตาม`;
    case "share":
      return `${who} แชร์ไลฟ์`;
  }
}

export const rarityTh: Record<Rarity, string> = {
  common: "ธรรมดา",
  uncommon: "ไม่ธรรมดา",
  rare: "หายาก",
  epic: "มหากาพย์",
  legendary: "ตำนาน",
  mythic: "เทพ",
};

export const mutationTh: Record<MutationId, string> = {
  gold: "ทองคำ",
  diamond: "เพชร",
  lava: "ลาวา",
  neutronStar: "ดาวนิวตรอน",
  blackHole: "หลุมดำ",
};

export const speciesTh: Record<string, string> = {
  tilapia: "ปลานิล",
  walkingCatfish: "ปลาดุก",
  snakehead: "ปลาช่อน",
  climbingPerch: "ปลาหมอ",
  snakeskinGourami: "ปลาสลิด",
  giantGourami: "ปลาแรด",
  clownFeatherback: "ปลากราย",
  arowana: "ปลาอะโรวาน่า",
  giantSnakehead: "ปลาชะโด",
  mekongGiantCatfish: "ปลาบึก",
  nagaFish: "ปลาพญานาค",
};

/** "ปลาบึก ทองคำ เพชร" — species plus any mutations. */
export function fishName(speciesId: string, mutations: readonly MutationId[]): string {
  return [speciesTh[speciesId] ?? speciesId, ...mutations.map((m) => mutationTh[m])].join(" ");
}

const thNumber = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

const SMALL_UNITS = ["พัน", "หมื่น", "แสน"] as const;

/**
 * Weight from log10(kg) in Thai units, e.g. "3.25 ล้าน กก.", "4.18 หมื่นล้าน กก.", "1.2 ล้านล้าน กก.".
 * Thai counts big numbers in millions of millions (plus พัน/หมื่น/แสน in between), so any size
 * stays short and readable without ever building a JS number above 1e6.
 */
export function formatWeight(log10: number): string {
  if (!Number.isFinite(log10)) return "-";
  if (log10 < 6) return `${thNumber.format(10 ** log10)} กก.`;
  const groups = Math.floor(log10 / 6);
  const rest = log10 - groups * 6; // 0 ≤ rest < 6
  const small = rest >= 3 ? Math.min(Math.floor(rest) - 3, 2) : -1;
  const mantissa = 10 ** (rest - (small >= 0 ? small + 3 : 0));
  const digits = mantissa >= 100 ? 0 : mantissa >= 10 ? 1 : 2;
  return `${mantissa.toFixed(digits)} ${small >= 0 ? SMALL_UNITS[small] : ""}${"ล้าน".repeat(groups)} กก.`;
}

/** m:ss */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
