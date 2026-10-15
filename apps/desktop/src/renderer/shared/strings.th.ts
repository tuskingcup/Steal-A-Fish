import type { Action, LiveEvent } from "@saf/core";

/** All player-facing Thai text lives here. */
export const th = {
  gameTitle: "STEAL A FISH",
  pondVillage: "บ่อหมู่บ้าน",
  waiting: "รอของขวัญจากคนดู…",
  hostName: "เจ้าของท่าเรือ",

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
