import { RARITIES, type CatchEvent, type Rarity, type RoundState, type RoundSummary } from "@saf/core";
import { createPondScene } from "./scene";
import { describeAction, fishName, formatClock, formatWeight, rarityTh, th } from "../shared/strings.th";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const feed = document.getElementById("feed") as HTMLDivElement;
const tagLayer = document.getElementById("tags") as HTMLDivElement;
const roundbar = document.getElementById("roundbar") as HTMLDivElement;
const joinhint = document.getElementById("joinhint") as HTMLDivElement;
const card = document.getElementById("card") as HTMLDivElement;
const summaryEl = document.getElementById("summary") as HTMLDivElement;
(document.getElementById("title") as HTMLDivElement).textContent = th.gameTitle;
(document.getElementById("pond") as HTMLDivElement).textContent = th.pondVillage;

const pond = createPondScene(canvas, { userId: "host", name: th.hostName });
const { scene, camera, crew } = pond;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rarityRank = (r: Rarity) => RARITIES.indexOf(r);

// ---------- Feed ----------

const MAX_ITEMS = 5;

function push(html: string): void {
  const item = document.createElement("div");
  item.className = "item";
  item.innerHTML = html;
  feed.appendChild(item);
  while (feed.children.length > MAX_ITEMS) feed.firstElementChild?.remove();
}

// ---------- Round bar ----------

let round: RoundState = { phase: "idle", round: 0, endsAt: null, players: 0 };

function renderRoundBar(): void {
  const left = round.endsAt === null ? 0 : round.endsAt - Date.now();
  const clock =
    round.phase === "open" ? th.timeLeft(formatClock(left)) : round.phase === "summary" ? th.nextRoundIn(formatClock(left)) : th.phase.idle;
  const low = round.phase === "open" && left < 30_000 ? " low" : "";
  roundbar.innerHTML =
    `<span class="pill">${esc(th.round(Math.max(round.round, 1)))}</span>` +
    `<span class="pill clock${low}">${esc(clock)}</span>` +
    `<span class="pill">${esc(th.players(round.players))}</span>`;
  joinhint.textContent = round.phase === "open" ? th.joinHint : th.joinNextHint;
}
setInterval(renderRoundBar, 250);
renderRoundBar();

window.saf.onRound((state) => {
  const newRound = state.phase === "open" && state.round !== round.round;
  round = state;
  if (newRound) {
    // Everyone types 1 again each round: clear the dock and the summary.
    crew.reset();
    hideSummary();
    pond.focusOverview();
    push(`<b>${esc(th.round(state.round))}</b> — ${esc(th.joinHint)}`);
  }
  renderRoundBar();
});

window.saf.onJoined((e) => {
  if (e.queued) {
    push(`<b>@${esc(e.name)}</b> ${esc(th.queuedNext)}`);
    return;
  }
  crew.join({ userId: e.userId, name: e.name });
  push(`<b>@${esc(e.name)}</b> ${esc(th.joined)}`);
});

// ---------- Catches: feed lines and a display queue of catch cards ----------

/** Rare+ catches get a card. Epic+ jump the queue; the queue is capped so it never lags far behind. */
const cardQueue: CatchEvent[] = [];
let cardBusy = false;
const CARD_MS = 2600;
const MAX_QUEUE = 6;

function queueCard(e: CatchEvent): void {
  if (rarityRank(e.fish.rarity) >= rarityRank("epic")) cardQueue.unshift(e);
  else cardQueue.push(e);
  while (cardQueue.length > MAX_QUEUE) cardQueue.pop();
  if (!cardBusy) showNextCard();
}

function showNextCard(): void {
  const e = cardQueue.shift();
  if (!e) {
    cardBusy = false;
    card.className = "";
    return;
  }
  cardBusy = true;
  card.className = `r-${e.fish.rarity}`;
  card.innerHTML =
    `<div class="who"><b>@${esc(e.name)}</b> ${esc(th.caught)}</div>` +
    `<div class="name">${esc(fishName(e.fish.speciesId, e.fish.mutations))}</div>` +
    `<div><span class="chip">${esc(rarityTh[e.fish.rarity])}</span></div>` +
    `<div class="weight">${esc(formatWeight(e.fish.weightLog10))}</div>` +
    (e.personalBest ? `<div class="best">${esc(th.newBest)}</div>` : "");
  void card.offsetWidth; // restart the pop animation
  card.className = `r-${e.fish.rarity} show`;
  setTimeout(showNextCard, CARD_MS);
}

window.saf.onCatch((e) => {
  crew.join({ userId: e.userId, name: e.name });
  crew.cast(e.userId);
  // Commons only show up as a cast; anything better (or mutated) makes the feed.
  if (rarityRank(e.fish.rarity) >= rarityRank("uncommon") || e.fish.mutations.length > 0) {
    push(
      `<b>@${esc(e.name)}</b> ${esc(th.caught)} <span class="rarity r-${e.fish.rarity}">${esc(fishName(e.fish.speciesId, e.fish.mutations))}</span> ` +
        esc(formatWeight(e.fish.weightLog10)),
    );
  }
  if (rarityRank(e.fish.rarity) >= rarityRank("rare") || e.fish.mutations.length > 0) queueCard(e);
});

// Other actions (frenzy, collection, …) still show in the feed; casts are shown as catches.
window.saf.onGameAction((fired) => {
  if (fired.action.type === "cast" || fired.action.type === "net") return;
  const who = fired.viewer.uniqueId || fired.viewer.nickname;
  push(`<b>@${esc(who)}</b> → ${esc(describeAction(fired.action, fired.times))}`);
});

let championId: string | null = null;
window.saf.onPodium((podium) => {
  crew.setPodium(podium.map((p) => p.userId));
  const champion = podium[0];
  if (champion && champion.userId !== championId && round.phase === "open") push(`👑 <b>@${esc(champion.name)}</b> ${esc(th.newChampion)}`);
  championId = champion?.userId ?? null;
});

// ---------- Round summary: podium plus a browser over everyone's fish ----------

let summary: RoundSummary | null = null;
let selected = 0;
/** Auto-browse waits until this time (longer after a key press, so the streamer stays in control). */
let holdUntil = 0;
const MEDALS = ["🥇", "🥈", "🥉"];
const FISH_ROWS = 7;
const AUTO_BROWSE_MS = 6000;
const MANUAL_HOLD_MS = 15000;
const FIRST_HOLD_MS = 9000;

window.saf.onSummary((s) => {
  summary = s;
  selected = 0;
  holdUntil = Date.now() + FIRST_HOLD_MS; // let the winner sink in first
  cardQueue.length = 0;
  document.body.classList.add("in-summary");
  summaryEl.classList.add("show");
  renderSummary();
});

function hideSummary(): void {
  summary = null;
  document.body.classList.remove("in-summary");
  summaryEl.classList.remove("show");
}

function select(step: number): void {
  if (!summary || summary.players.length === 0) return;
  const n = summary.players.length;
  selected = (selected + step + n) % n;
  renderSummary();
}

function renderSummary(): void {
  if (!summary) return;
  const players = summary.players;
  const podium = players
    .slice(0, 3)
    .filter((p) => p.fish.length > 0)
    .map((p, i) => {
      const best = p.fish[0]!;
      return (
        `<div><span class="medal">${MEDALS[i]}</span><span class="pname">${esc(p.name)}</span>` +
        `<span class="rarity r-${best.rarity}">${esc(formatWeight(p.bestLog10))}</span></div>`
      );
    })
    .join("");

  let browser = `<div class="stats">${esc(th.noPlayers)}</div>`;
  const p = players[selected];
  if (p) {
    pond.focusOn(p.userId);
    const rows = p.fish
      .slice(0, FISH_ROWS)
      .map(
        (f) =>
          `<div class="fish r-${f.rarity}"><span class="chip">${esc(rarityTh[f.rarity])}</span>` +
          `<span class="fname">${esc(fishName(f.speciesId, f.mutations))}</span><span class="fw">${esc(formatWeight(f.weightLog10))}</span></div>`,
      )
      .join("");
    const more = p.fish.length > FISH_ROWS ? `<div class="stats">+${p.fish.length - FISH_ROWS}</div>` : "";
    browser =
      `<div class="bhead"><span class="arrow">◀</span><span class="bname">${p.rank <= 3 ? MEDALS[p.rank - 1] + " " : ""}${esc(p.name)}</span><span class="arrow">▶</span></div>` +
      `<div class="stats">${esc(th.rank(p.rank, players.length))} · ${esc(th.fishCount(p.fish.length))}` +
      (p.fish.length > 0 ? ` · ${esc(th.total)} ${esc(formatWeight(p.totalLog10))}` : "") +
      `</div>` +
      (rows || `<div class="stats">${esc(th.noFish)}</div>`) +
      more +
      `<div class="hint">${esc(th.browseHint)}</div>`;
  }

  summaryEl.innerHTML =
    `<div class="panel podium"><h2>${esc(th.summaryTitle(summary.round))}</h2>${podium || esc(th.noPlayers)}</div>` +
    `<div class="panel browser">${browser}</div>`;
}

// When nobody is pressing keys (the streamer is busy talking), walk through everyone on its own.
setInterval(() => {
  if (!summary || Date.now() < holdUntil) return;
  holdUntil = Date.now() + AUTO_BROWSE_MS;
  select(1);
}, 500);

// ---------- Keys ----------

// ←/→ (or A/D): during the summary, browse players' fish; otherwise visit each fisher. Esc: overview.
window.addEventListener("keydown", (e) => {
  const step = e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? 1 : e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? -1 : 0;
  if (step !== 0) {
    if (summary) {
      holdUntil = Date.now() + MANUAL_HOLD_MS;
      select(step);
    } else pond.focusStep(step);
  } else if (e.key === "Escape") pond.focusOverview();
  else return;
  e.preventDefault();
});

// ---------- Name tags ----------

// Name tags are HTML over the canvas: crisper Thai text than drawing it in the 3D scene.
const tags = new Map<string, HTMLDivElement>();
scene.onAfterRenderObservable.add(() => {
  const seen = new Set<string>();
  for (const t of crew.nameTags(camera, pond.focusedId())) {
    seen.add(t.userId);
    let el = tags.get(t.userId);
    if (!el) {
      el = document.createElement("div");
      tagLayer.appendChild(el);
      tags.set(t.userId, el);
    }
    const cls = (t.isChampion ? "tag champion" : t.isHost ? "tag host" : "tag") + (t.isFocused ? " focus" : "");
    if (el.className !== cls) el.className = cls;
    if (el.textContent !== t.name) el.textContent = t.name;
    el.style.display = t.visible ? "" : "none";
    el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  for (const [id, el] of tags) {
    if (!seen.has(id)) {
      el.remove();
      tags.delete(id);
    }
  }
});
