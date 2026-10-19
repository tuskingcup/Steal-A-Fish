import { useEffect, useState } from "react";
import { DEFAULT_ROUND_CONFIG, MUTATIONS, NORMAL_SIZE_CHANCE, PITY_CASTS, RARITIES, rarityPercents, ROUND_SEC_MAX, ROUND_SEC_MIN, SIZE_CLASSES, SPECIES, speciesPercents, type RoundState, type Rule, type RulesConfig } from "@saf/core";
import type { ConnectionState } from "@saf/live";
import type { LogEntry, SimGiftInput } from "../../shared/api";
import { describeAction, describeEvent, describeTrigger, formatClock, formatWeight, mutationTh, rarityTh, sizeClassTh, speciesTh, th } from "../../shared/strings.th";

/** Public drop table (shown to everyone: no hidden odds). */
const PERCENTS = rarityPercents();
const speciesChance = speciesPercents();
const DEFAULT_ROUND_SEC = DEFAULT_ROUND_CONFIG.roundMs / 1000;
const fmtPct = (p: number) => (p >= 1 ? p.toFixed(1) : p >= 0.01 ? p.toFixed(2) : p.toFixed(3));

// Simulator gifts (ids as TikTok reports them; rules match by coin value or by name).
const SIM_GIFTS: Array<SimGiftInput & { label: string }> = [
  { label: "กุหลาบ · 1", giftId: 5655, giftName: "Rose", diamonds: 1 },
  { label: "กุหลาบ ×5", giftId: 5655, giftName: "Rose", diamonds: 1, repeatCount: 5 },
  { label: "มินิฮาร์ท · 5", giftId: 5487, giftName: "Finger Heart", diamonds: 5 },
  { label: "โรซ่า · 10", giftId: 8913, giftName: "Rosa", diamonds: 10 },
  { label: "น้ำหอม · 20 (ขโมย)", giftId: 5658, giftName: "Perfume", diamonds: 20 },
  { label: "โดนัท · 30", giftId: 5879, giftName: "Doughnut", diamonds: 30 },
  { label: "อุ้มใจ · 100", giftId: 5660, giftName: "Hand Hearts", diamonds: 100 },
  { label: "ใจส้ม (สุ่ม)", giftId: 7934, giftName: "Heart Me", diamonds: 1 },
];

const MAX_LOG = 200;

/** The per-viewer likes → cast rule's trigger, if there is one. */
function likesRule(config: RulesConfig | null): { every: number } | null {
  const rule = config?.rules.find((r) => r.trigger.type === "likes" && r.trigger.perViewer && r.action.type === "cast");
  return rule && rule.trigger.type === "likes" ? rule.trigger : null;
}

/** Gift table order: likes first, then gifts by price, then the named specials. */
function giftOrder(rule: Rule): number {
  const t = rule.trigger;
  if (t.type === "likes") return t.perViewer ? -2 : 1e9;
  if (t.type === "follow") return -1;
  if (t.type !== "gift") return 1e9;
  return t.minDiamonds ?? 1e6;
}

export function App() {
  const [state, setState] = useState<ConnectionState>({ status: "disconnected" });
  const [uniqueId, setUniqueId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [round, setRound] = useState<RoundState | null>(null);
  const [, setNow] = useState(Date.now());
  const [overlayUrl, setOverlayUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [rules, setRules] = useState<RulesConfig | null>(null);
  const [likesInput, setLikesInput] = useState("");
  const [likesMsg, setLikesMsg] = useState("");
  const [roundMinInput, setRoundMinInput] = useState(String(DEFAULT_ROUND_SEC / 60));
  const [roundMsg, setRoundMsg] = useState("");

  useEffect(() => {
    const showRules = (r: RulesConfig) => {
      setRules(r);
      setRulesText(JSON.stringify(r, null, 2));
      const likes = likesRule(r);
      if (likes) setLikesInput(String(likes.every));
      setRoundMinInput(String(+((r.round?.roundSec ?? DEFAULT_ROUND_SEC) / 60).toFixed(2)));
    };
    void window.saf.getRules().then(showRules);
    const offRules = window.saf.onRulesChanged(showRules);
    void window.saf.overlayUrl().then(setOverlayUrl);
    const offState = window.saf.onLiveState(setState);
    const offLog = window.saf.onLog((entry) => setLog((prev) => [entry, ...prev].slice(0, MAX_LOG)));
    const offRound = window.saf.onRound(setRound);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      offState();
      offLog();
      offRound();
      offRules();
      clearInterval(clock);
    };
  }, []);

  /** Change how many likes make one cast (the per-viewer likes → cast rule). */
  async function saveLikesPerCast() {
    const every = Math.round(Number(likesInput));
    if (!rules || !Number.isFinite(every) || every < 1) return;
    const next: RulesConfig = {
      ...rules,
      rules: rules.rules.map((r) => (r.trigger.type === "likes" && r.trigger.perViewer && r.action.type === "cast" ? { ...r, trigger: { ...r.trigger, every } } : r)),
    };
    const result = await window.saf.saveRules(next);
    setLikesMsg(result.ok ? th.likesPerCastSaved : result.error);
    setTimeout(() => setLikesMsg(""), 2000);
  }

  /** Change how long a round lasts; the round in progress picks it up too. */
  async function saveRoundTimes() {
    const roundSec = Math.round(Number(roundMinInput) * 60);
    const ok = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
    if (!rules) return;
    if (!ok(roundSec, ROUND_SEC_MIN, ROUND_SEC_MAX)) {
      setRoundMsg(th.roundTimesInvalid);
      return;
    }
    const result = await window.saf.saveRules({ ...rules, round: { roundSec } });
    setRoundMsg(result.ok ? th.likesPerCastSaved : result.error);
    setTimeout(() => setRoundMsg(""), 2500);
  }

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
        <div className="row">
          <label>
            {th.roundMinutes}
            <input type="number" min={ROUND_SEC_MIN / 60} max={ROUND_SEC_MAX / 60} step={0.5} value={roundMinInput} onChange={(e) => setRoundMinInput(e.target.value)} style={{ width: 110 }} />
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={() => void saveRoundTimes()}>
            {th.save}
          </button>
          {roundMsg && <span className="hint" style={{ alignSelf: "flex-end" }}>{roundMsg}</span>}
        </div>
        <p className="hint">{th.roundTimesHint(ROUND_SEC_MIN / 60, ROUND_SEC_MAX / 60)}</p>
        <p className="hint">{th.roundRules(+((rules?.round?.roundSec ?? DEFAULT_ROUND_SEC) / 60).toFixed(2))}</p>
      </section>

      <section>
        <h2>{th.giftTable}</h2>
        <label>
          {th.likesPerCast}
          <div className="row">
            <input type="number" min={1} value={likesInput} onChange={(e) => setLikesInput(e.target.value)} style={{ width: 110 }} />
            <button className="primary" onClick={() => void saveLikesPerCast()}>
              {th.save}
            </button>
            {likesMsg && <span className="hint">{likesMsg}</span>}
          </div>
        </label>
        <table className="rates">
          <tbody>
            {(rules?.rules ?? [])
              .filter((r) => r.enabled && (r.trigger.type === "gift" || r.trigger.type === "likes" || r.trigger.type === "follow"))
              .sort((a, b) => giftOrder(a) - giftOrder(b))
              .map((r, i) => (
                <tr key={r.id ?? i}>
                  <td>{describeTrigger(r.trigger)}</td>
                  <td>{describeAction(r.action, 1)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="hint">{th.giftTableHint}</p>
      </section>

      <section>
        <h2>{th.overlayHeading}</h2>
        {overlayUrl === undefined ? (
          <p className="hint">{th.overlayStarting}</p>
        ) : overlayUrl === null ? (
          <p className="error">{th.overlayFailed}</p>
        ) : (
          <>
            <input className="link" readOnly value={overlayUrl} onFocus={(e) => e.target.select()} aria-label={th.overlayHeading} />
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  void window.saf.copyText(overlayUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  })
                }
              >
                {copied ? th.copied : th.copyLink}
              </button>
              <button onClick={() => window.open(overlayUrl)}>{th.openInBrowser}</button>
            </div>
          </>
        )}
        <p className="hint">{th.overlayHint}</p>
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
          <button onClick={() => void window.saf.simulateLikes(likesRule(rules)?.every ?? 50)}>กดใจ ×{likesRule(rules)?.every ?? 50} (ตก 1 ครั้ง)</button>
          <button onClick={() => void window.saf.simulateLikes(1000)}>ไลค์ ×1,000</button>
          <button onClick={() => void window.saf.simulateLikes(10000)}>ไลค์ ×10,000</button>
          <button onClick={() => void window.saf.simulateComment("1")}>{th.simJoin}</button>
          <button onClick={() => void window.saf.simulateComment("!สมุด")}>คอมเมนต์ !สมุด</button>
          <button onClick={() => void window.saf.simulateFollow()}>ผู้ติดตามใหม่ (= โรซ่า)</button>
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
                  ~{formatWeight(sp.baseLog10)} · {sp.price.toLocaleString("th-TH")} {th.coinsUnit} · {fmtPct(speciesChance[sp.id] ?? 0)}%
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
