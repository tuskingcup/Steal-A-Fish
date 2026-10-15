import type { Action, LiveEvent, MutationId, Rarity, RoundPhase, SizeClass, Trigger } from "@saf/core";

/** All player-facing Thai text lives here. */
export const th = {
  waiting: "รอของขวัญจากคนดู…",
  hostName: "เจ้าของท่าเรือ",
  newChampion: "ขึ้นอันดับ 1 แล้ว!",
  joinHint: "พิมพ์ 1 ในแชทเพื่อร่วมเล่น",
  /** Round-bar hint: how fishing works. */
  likeHint: (likes: number) => `กดใจ ${likes} ครั้ง = ตกปลา 1 ครั้ง · ส่งของขวัญ = การันตีแต้ม`,
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
  totalValue: "มูลค่ารวม",
  coinsUnit: "แต้ม",
  mutationEffect: (weight: string, price: string) => `น้ำหนัก ×${weight}, ราคา ×${price}`,
  sellPrice: "ขายได้",
  priceTable: "ปลาแต่ละชนิด: น้ำหนัก · แต้มที่ได้ · โอกาสต่อการเหวี่ยง",
  priceNote: "ราคาขาย = ราคาพันธุ์ปลา × ขนาดตัว (ใหญ่กว่าปกติ 2 เท่า ได้ 2 เท่า) × ตัวคูณการกลายพันธุ์ · อันดับคิดจากมูลค่ารวมของปลาทุกตัวในรอบ",
  noFish: "ยังไม่ได้ปลาเลย",
  browseHint: "← / → ดูปลาทีละตัว · ↑ / ↓ เปลี่ยนผู้เล่น",
  fishOf: (i: number, n: number) => `ตัวที่ ${i}/${n}`,
  hooked: "ติดเบ็ด!",
  bigCatch: "ได้ปลายักษ์!",
  denseCatch: "ตัวจิ๋วแต่หนักจนท่าเรือพัง!",
  lengthAbout: (len: string) => `ยาวประมาณ ${len}`,
  /** Big title while a density mutant's cosmic power is up. */
  cosmicTitle: { neutronStar: "พลังดาวนิวตรอน!", blackHole: "หลุมดำเปิดออกแล้ว!" } as Record<string, string>,
  denseFact: {
    neutronStar: "หนาแน่นระดับดาวนิวตรอน: เนื้อแค่ช้อนชาเดียวหนักนับพันล้านตัน",
    blackHole: "หนาแน่นระดับหลุมดำ: แรงดึงดูดมหาศาลจนแสงยังหนีไม่พ้น",
  } as Record<string, string>,
  refs: {
    human: "คน",
    boat: "เรือ",
    house: "บ้าน",
    temple: "วัด",
    tower: "ตึกระฟ้า",
    doiInthanon: "ดอยอินทนนท์",
    everest: "เอเวอเรสต์",
    moon: "ดวงจันทร์",
    earth: "โลก",
    tinyFish: "ตัวจริงยาวแค่ 2 ซม. ▼",
    tinyFishZoom: "ภาพขยาย · ตัวจริงยาวแค่ 2 ซม.",
  } as Record<string, string>,

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
  roundRules: "รอบละ 5 นาที · พิมพ์ 1 ในแชทเพื่อร่วมเล่น · กดใจครบตามที่ตั้งไว้ = ตกปลา 1 ครั้ง · ของขวัญ = ตกปลาแบบการันตีแต้ม (กดใจหรือส่งของขวัญแล้วได้ร่วมเล่นอัตโนมัติ) · จัดอันดับจากแต้มรวมของปลาทุกตัวที่ตกได้",
  likesPerCast: "กดใจกี่ครั้ง = ตกปลา 1 ครั้ง (นับแยกแต่ละคน)",
  likesPerCastSaved: "บันทึกแล้ว",
  giftTable: "ของขวัญ → สิ่งที่ได้",
  giftTableHint: "จับคู่ของขวัญตามจำนวนเหรียญ (ของขวัญราคาใกล้กันได้ผลเท่ากัน) ยกเว้นน้ำหอมกับใจส้มที่จับคู่ตามชื่อของขวัญ · แก้ได้ในกฎด้านล่าง",
  stole: "ขโมย",
  from: "จาก",
  luckyGot: "ใจส้มสุ่มได้",
  /** Names of the gift tiers a lucky draw can land on (by option label). */
  luckyTier: { rose: "กุหลาบ", fingerHeart: "มินิฮาร์ท", rosa: "โรซ่า", doughnut: "โดนัท", handHearts: "อุ้มใจ" } as Record<string, string>,
  dropRates: "อัตราการได้ปลา (ต่อการเหวี่ยง 1 ครั้ง)",
  mutationRates: "โอกาสกลายพันธุ์ (ซ้อนกันได้)",
  sizeRates: "ขนาดตัว (ส่วนใหญ่ขนาดปกติ)",
  sizeNormal: "ปกติ",
  sizeEffect: (weight: string, price: string) => `น้ำหนัก ×${weight}, ราคา ×${price}`,
  pityNote: "การันตีปลาระดับหายากขึ้นไป ภายใน 30 ครั้ง · FISH FRENZY เพิ่มโอกาสปลาหายาก",
  noRealValue: "แต้มและปลาไม่มีมูลค่าจริง แลกเป็นเงินหรือของใด ๆ ไม่ได้ และโอนให้กันไม่ได้",

  // Leaderboard overlay for TikTok LIVE Studio (served by the app, settings shows the link).
  overlayTitle: (round: number) => `🏆 อันดับแต้ม · รอบที่ ${round}`,
  overlayEmpty: "พิมพ์ 1 ในแชทเพื่อร่วมเล่น",
  overlayFinal: "สรุปผล",
  overlayMore: (n: number) => `อีก ${n} คน · เลื่อนลงเพื่อดู`,
  overlayHeading: "Overlay อันดับแต้มสำหรับ TikTok LIVE Studio",
  overlayHint: "ใน TikTok LIVE Studio: เพิ่มแหล่งที่มา → ลิงก์ (Link) → วางลิงก์นี้ · ขนาดแนะนำ 420 × 640 · แสดง 10 อันดับแรก ที่เหลือเลื่อนลงดูได้ (ถ้าไม่มีใครเลื่อน จะเลื่อนให้ดูเองช้า ๆ)",
  overlayStarting: "กำลังเปิด overlay…",
  overlayFailed: "เปิด overlay ไม่ได้",
  copyLink: "คัดลอกลิงก์",
  copied: "คัดลอกแล้ว!",
  openInBrowser: "เปิดดู",
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
      return `ตกปลา ×${action.count * times}${describeGuarantee(action)}${action.bait ? " (เหยื่อพิเศษ)" : ""}`;
    case "lucky":
      return `สุ่ม: ${action.options.map((o) => `${luckyName(o.label)} ${Math.round((o.weight / action.options.reduce((s, x) => s + x.weight, 0)) * 100)}%`).join(" · ")}${x}`;
    case "net":
      return `อวนลาก ${action.count} ตัว${x}`;
    case "steal":
      return `ขโมยปลา 1 ตัวแบบสุ่มจากอันดับ 1${action.successRate < 1 ? ` (สำเร็จ ${Math.round(action.successRate * 100)}%)` : ""}${x}`;
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

/** " · การันตีหายาก+ · อย่างน้อย 150 แต้ม/ตัว" */
function describeGuarantee(action: { minRarity?: Rarity; maxRarity?: Rarity; minPoints?: number; maxPoints?: number }): string {
  const parts: string[] = [];
  const lo = action.minRarity && action.minRarity !== "common" ? rarityTh[action.minRarity] : null;
  const hi = action.maxRarity && action.maxRarity !== "mythic" ? rarityTh[action.maxRarity] : null;
  if (lo && hi) parts.push(lo === hi ? lo : `${lo}–${hi}`);
  else if (lo) parts.push(`${lo}ขึ้นไป`);
  else if (hi) parts.push(`ไม่เกิน${hi}`);
  const n = (v: number) => thNumber.format(v);
  if (action.minPoints && action.maxPoints) parts.push(`${n(action.minPoints)}–${n(action.maxPoints)} แต้ม`);
  else if (action.minPoints) parts.push(`${n(action.minPoints)} แต้มขึ้นไป`);
  else if (action.maxPoints) parts.push(`ไม่เกิน ${n(action.maxPoints)} แต้ม`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

const luckyName = (label?: string) => (label && th.luckyTier[label]) || label || "?";

/** "ส่งของขวัญ 10 เหรียญขึ้นไป", "ส่ง Perfume", "กดใจ 50 ครั้ง (นับแยกแต่ละคน)". */
export function describeTrigger(trigger: Trigger): string {
  switch (trigger.type) {
    case "gift":
      if (trigger.giftId !== undefined) return `ของขวัญ #${trigger.giftId}`;
      if (trigger.giftName !== undefined) return `ของขวัญ "${trigger.giftName}"`;
      return `ของขวัญ ${trigger.minDiamonds} เหรียญขึ้นไป`;
    case "likes":
      return `กดใจ ${thNumber.format(trigger.every)} ครั้ง${trigger.perViewer ? " (นับแยกแต่ละคน)" : " (รวมทั้งห้อง)"}`;
    case "comment":
      return `คอมเมนต์ ${trigger.command}`;
    case "follow":
      return "ติดตาม (ครั้งแรกต่อคน)";
    case "share":
      return "แชร์";
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
  shark: "ฉลามขาว",
  orca: "วาฬเพชฌฆาต",
  whale: "วาฬสีน้ำเงิน",
  nessie: "เนสซี",
  megalodon: "เมกาโลดอน",
  bloop: "บลูป",
  elGranMaja: "เอล กราน มาฮา",
  godzilla: "ก็อดซิลล่า",
  seaEater: "ซีอีทเตอร์",
};

/** Size classes; a normal-sized fish gets no label. */
export const sizeClassTh: Record<SizeClass, string> = {
  normal: "",
  big: "ตัวโต",
  giant: "ยักษ์",
  titan: "ไททัน",
  colossal: "มหึมา",
};

/** "ปลาบึก ยักษ์ ทองคำ เพชร" — species, size class (if not normal), then any mutations. */
export function fishName(speciesId: string, mutations: readonly MutationId[], sizeClass: SizeClass = "normal"): string {
  return [speciesTh[speciesId] ?? speciesId, sizeClassTh[sizeClass], ...mutations.map((m) => mutationTh[m])].filter(Boolean).join(" ");
}

const thNumber = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

const SMALL_UNITS = ["พัน", "หมื่น", "แสน"] as const;

/**
 * A big quantity given as log10, in Thai units: "3.25 ล้าน", "4.18 หมื่นล้าน", "1.2 ล้านล้าน".
 * Thai counts big numbers in millions of millions (plus พัน/หมื่น/แสน in between), so any size
 * stays short and readable without ever building a JS number above 1e6.
 */
function formatBig(log10: number, unit: string): string {
  if (!Number.isFinite(log10)) return "-";
  if (log10 < 6) return `${thNumber.format(10 ** log10)} ${unit}`;
  const groups = Math.floor(log10 / 6);
  const rest = log10 - groups * 6; // 0 ≤ rest < 6
  const small = rest >= 3 ? Math.min(Math.floor(rest) - 3, 2) : -1;
  const mantissa = 10 ** (rest - (small >= 0 ? small + 3 : 0));
  const digits = mantissa >= 100 ? 0 : mantissa >= 10 ? 1 : 2;
  return `${mantissa.toFixed(digits)} ${small >= 0 ? SMALL_UNITS[small] : ""}${"ล้าน".repeat(groups)} ${unit}`;
}

/** Weight from log10(kg): "150 กรัม", "2.4 กก.", "12,500 กก.", "4.18 หมื่นล้าน กก.". */
export function formatWeight(log10: number): string {
  if (Number.isFinite(log10) && log10 < 0) return `${thNumber.format(Math.max(1, 10 ** (log10 + 3)))} กรัม`;
  if (Number.isFinite(log10) && log10 < 1) return `${(10 ** log10).toFixed(1)} กก.`;
  return formatBig(log10, "กก.");
}

/** In-game points (a fish's sell price), e.g. "⭐ 1,250 แต้ม", "⭐ 3.4 ล้าน แต้ม". */
export function formatPoints(points: number): string {
  return `⭐ ${points <= 0 ? "0 แต้ม" : formatBig(Math.log10(points), "แต้ม")}`;
}

/** Points without the unit, for small labels: "1,250", "3.4 ล้าน". */
export function formatPointsShort(points: number): string {
  return points <= 0 ? "0" : formatBig(Math.log10(points), "").trim();
}

/** Fish length in Thai units: "2 ซม.", "34 เมตร", "3.4 กิโลเมตร", "12,000 กิโลเมตร". */
export function formatLength(meters: number): string {
  if (meters < 1) return `${Math.max(1, Math.round(meters * 100))} ซม.`;
  if (meters < 1000) return `${meters < 10 ? meters.toFixed(1) : thNumber.format(meters)} เมตร`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : thNumber.format(km)} กิโลเมตร`;
}

/** m:ss */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
