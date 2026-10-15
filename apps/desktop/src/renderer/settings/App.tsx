import { useEffect, useState } from "react";
import type { ConnectionState } from "@saf/live";
import type { LogEntry, SimGiftInput } from "../../shared/api";
import { describeAction, describeEvent, th } from "../shared/strings.th";

// Placeholder gifts for the simulator. Real ids come from the live gift list later.
const SIM_GIFTS: Array<SimGiftInput & { label: string }> = [
  { label: "กุหลาบ · 1", giftId: 5655, giftName: "Rose", diamonds: 1 },
  { label: "กุหลาบ ×5", giftId: 5655, giftName: "Rose", diamonds: 1, repeatCount: 5 },
  { label: "ของขวัญ 10", giftId: 9001, giftName: "Gift 10", diamonds: 10 },
  { label: "ของขวัญ 99", giftId: 9002, giftName: "Gift 99", diamonds: 99 },
  { label: "ของขวัญ 199", giftId: 9003, giftName: "Gift 199", diamonds: 199 },
];

const MAX_LOG = 200;

export function App() {
  const [state, setState] = useState<ConnectionState>({ status: "disconnected" });
  const [uniqueId, setUniqueId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    void window.saf.getRules().then((r) => setRulesText(JSON.stringify(r, null, 2)));
    const offState = window.saf.onLiveState(setState);
    const offLog = window.saf.onLog((entry) => setLog((prev) => [entry, ...prev].slice(0, MAX_LOG)));
    return () => {
      offState();
      offLog();
    };
  }, []);

  async function saveRules() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rulesText);
    } catch (err) {
      setRulesMsg({ ok: false, text: `${th.invalidJson}: ${String(err)}` });
      return;
    }
    const result = await window.saf.saveRules(parsed);
    setRulesMsg(result.ok ? { ok: true, text: th.saved } : { ok: false, text: result.error });
  }

  return (
    <main>
      <h1>{th.settingsTitle}</h1>

      <section>
        <h2>{th.connection}</h2>
        <span className="status">
          <span className={`dot ${state.status}`} />
          {th.status[state.status]}
          {state.status === "error" ? ` — ${state.message}` : ""}
        </span>
        <label>
          {th.username}
          <input value={uniqueId} onChange={(e) => setUniqueId(e.target.value)} placeholder="@your_name" />
        </label>
        <label>
          {th.signApiKey}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
        </label>
        <div className="row">
          <button
            className="primary"
            disabled={!uniqueId.trim()}
            onClick={() => void window.saf.connectTikTok({ uniqueId: uniqueId.trim(), signApiKey: apiKey.trim() })}
          >
            {th.connect}
          </button>
          <button onClick={() => void window.saf.disconnectLive()}>{th.disconnect}</button>
        </div>
      </section>

      <section>
        <h2>{th.simulator}</h2>
        <div className="row">
          {SIM_GIFTS.map((g) => (
            <button key={g.label} onClick={() => void window.saf.simulateGift(g)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => void window.saf.simulateLikes(1000)}>ไลค์ ×1,000</button>
          <button onClick={() => void window.saf.simulateLikes(10000)}>ไลค์ ×10,000</button>
          <button onClick={() => void window.saf.simulateComment("!สมุด")}>คอมเมนต์ !สมุด</button>
          <button onClick={() => void window.saf.simulateFollow()}>ติดตาม</button>
        </div>
      </section>

      <section className="wide">
        <h2>{th.rules}</h2>
        <p className="hint">{th.rulesHint}</p>
        <textarea value={rulesText} onChange={(e) => setRulesText(e.target.value)} spellCheck={false} aria-label={th.rules} />
        <div className="row">
          <button className="primary" onClick={() => void saveRules()}>
            {th.save}
          </button>
          {rulesMsg && <p className={rulesMsg.ok ? "hint" : "error"}>{rulesMsg.text}</p>}
        </div>
      </section>

      <section className="wide">
        <h2>{th.eventLog}</h2>
        <ul className="log">
          {log.map((entry, i) => (
            <li key={`${entry.at}-${i}`}>
              <time>{new Date(entry.at).toLocaleTimeString("th-TH")}</time>
              {describeEvent(entry.event)} →{" "}
              {entry.fired.length ? (
                <span className="fired">{entry.fired.map((f) => describeAction(f.action, f.times)).join(", ")}</span>
              ) : (
                <span className="none">{th.noRuleMatched}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
