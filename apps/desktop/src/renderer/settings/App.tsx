import { useEffect, useState } from "react";
import { MUTATIONS, NORMAL_SIZE_CHANCE, PITY_CASTS, RARITIES, rarityPercents, SIZE_CLASSES, SPECIES, type RoundState } from "@saf/core";
import type { ConnectionState } from "@saf/live";
import type { LogEntry, SimGiftInput } from "../../shared/api";
import { describeAction, describeEvent, formatClock, formatWeight, mutationTh, rarityTh, sizeClassTh, speciesTh, th } from "../shared/strings.th";

/** Public drop table (shown to everyone: no hidden odds). */
const PERCENTS = rarityPercents();
const fmtPct = (p: number) => (p >= 1 ? p.toFixed(1) : p >= 0.01 ? p.toFixed(2) : p.toFixed(3));

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
  const [round, setRound] = useState<RoundState | null>(null);
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    void window.saf.getRules().then((r) => setRulesText(JSON.stringify(r, null, 2)));
    const offState = window.saf.onLiveState(setState);
    const offLog = window.saf.onLog((entry) => setLog((prev) => [entry, ...prev].slice(0, MAX_LOG)));
    const offRound = window.saf.onRound(setRound);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      offState();
      offLog();
      offRound();
      clearInterval(clock);
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
        <h2>{th.roundPanel}</h2>
        {round && (
          <p className="status">
            <strong>{th.round(Math.max(round.round, 1))}</strong> · {th.phase[round.phase]}
            {round.endsAt !== null && ` · ${formatClock(round.endsAt - Date.now())}`} · {th.players(round.players)}
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={() => void window.saf.startRound()}>
            {th.startRound}
          </button>
          <button onClick={() => void window.saf.endRound()}>{th.endRound}</button>
        </div>
        <p className="hint">{th.roundRules}</p>
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
          <button onClick={() => void window.saf.simulateComment("1")}>{th.simJoin}</button>
          <button onClick={() => void window.saf.simulateComment("!สมุด")}>คอมเมนต์ !สมุด</button>
          <button onClick={() => void window.saf.simulateFollow()}>ติดตาม</button>
        </div>
        <div className="row">
          <button onClick={() => void window.saf.simulateCrowd(1)}>{th.newViewers(1)}</button>
          <button onClick={() => void window.saf.simulateCrowd(5)}>{th.newViewers(5)}</button>
          <button onClick={() => void window.saf.simulateCrowd(10)}>{th.newViewers(10)}</button>
        </div>
        <p className="hint">{th.cameraKeys}</p>
      </section>

      <section>
        <h2>{th.dropRates}</h2>
        <table className="rates">
          <tbody>
            {RARITIES.map((r) => (
              <tr key={r}>
                <td className={`r-${r}`}>{rarityTh[r]}</td>
                <td>{fmtPct(PERCENTS[r])}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>{th.sizeRates}</h2>
        <table className="rates">
          <tbody>
            {SIZE_CLASSES.map((c) => {
              const lo = Math.round(10 ** c.weightLog10[0]).toLocaleString("th-TH");
              const hi = Math.round(10 ** c.weightLog10[1]).toLocaleString("th-TH");
              return (
                <tr key={c.id}>
                  <td>
                    {sizeClassTh[c.id] || th.sizeNormal}
                    {c.id !== "normal" && ` (${th.sizeEffect(`${lo}–${hi}`, c.priceMultiplier.toLocaleString("th-TH"))})`}
                  </td>
                  <td>{fmtPct((c.id === "normal" ? NORMAL_SIZE_CHANCE : c.chance) * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2>{th.mutationRates}</h2>
        <table className="rates">
          <tbody>
            {MUTATIONS.map((m) => (
              <tr key={m.id}>
                <td>
                  {mutationTh[m.id]} ({th.mutationEffect(m.multiplier.toLocaleString("th-TH"), m.priceMultiplier.toLocaleString("th-TH"))})
                </td>
                <td>{fmtPct(m.chance * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">{th.pityNote.replace("30", String(PITY_CASTS))}</p>
        <h2>{th.priceTable}</h2>
        <table className="rates">
          <tbody>
            {SPECIES.map((sp) => (
              <tr key={sp.id}>
                <td className={`r-${sp.rarity}`}>
                  {speciesTh[sp.id] ?? sp.id} · {rarityTh[sp.rarity]}
                </td>
                <td>
                  ~{formatWeight(sp.baseLog10)} · {sp.price.toLocaleString("th-TH")} {th.coinsUnit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">{th.priceNote}</p>
        <p className="hint">{th.noRealValue}</p>
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
