import { isHuge, RARITIES, type CatchEvent, type Rarity, type RoundState, type RoundSummary } from "@saf/core";
import { fishLengthMeters } from "./reveal";
import { finishFor, isDense } from "./fishModels";
import { createPondScene } from "./scene";
import { describeAction, fishName, formatClock, formatPoints, formatPointsShort, formatLength, formatWeight, rarityTh, th } from "../../shared/strings.th";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const feed = document.getElementById("feed") as HTMLDivElement;
const tagLayer = document.getElementById("tags") as HTMLDivElement;
const roundbar = document.getElementById("roundbar") as HTMLDivElement;
const joinhint = document.getElementById("joinhint") as HTMLDivElement;
const card = document.getElementById("card") as HTMLDivElement;
const summaryEl = document.getElementById("summary") as HTMLDivElement;
const revealEl = document.getElementById("reveal") as HTMLDivElement;
const revealLabels = document.getElementById("revealLabels") as HTMLDivElement;
const flashEl = document.getElementById("flash") as HTMLDivElement;

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
    totals.clear();
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
  if (!totals.has(e.userId)) totals.set(e.userId, 0);
  push(`<b>@${esc(e.name)}</b> ${esc(th.joined)}`);
});

// ---------- Catches: feed lines and a display queue of catch cards ----------

/** Big catches get a card. Epic+ jump the queue; the queue is capped so it never lags far behind. */
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
  // Cards wait while a big-catch reveal has the screen.
  if (pond.reveal.active()) {
    setTimeout(showNextCard, 500);
    return;
  }
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
    `<div class="name">${esc(fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass))}</div>` +
    `<div><span class="chip">${esc(rarityTh[e.fish.rarity])}</span></div>` +
    `<div class="weight">${esc(formatWeight(e.fish.weightLog10))}</div>` +
    `<div class="price">${esc(th.sellPrice)} ${esc(formatPoints(e.fish.price))}</div>` +
    (e.personalBest ? `<div class="best">${esc(th.newBest)}</div>` : "");
  void card.offsetWidth; // restart the pop animation
  card.className = `r-${e.fish.rarity} show`;
  setTimeout(showNextCard, CARD_MS);
}

/**
 * With a big crowd catching every few seconds, only big catches make the feed and the card: Epic
 * and up, giant size classes and up, and diamond-or-rarer mutations. Every catch still pops its
 * points over the catcher's head.
 */
function isBigCatch(e: CatchEvent): boolean {
  const bigClass = e.fish.sizeClass !== "normal" && e.fish.sizeClass !== "big";
  const bigMutation = e.fish.mutations.some((m) => m !== "gold");
  return rarityRank(e.fish.rarity) >= rarityRank("epic") || bigClass || bigMutation;
}

window.saf.onCatch((e) => {
  crew.join({ userId: e.userId, name: e.name });
  crew.cast(e.userId);
  totals.set(e.userId, e.totalValue);
  popPoints(e);
  if (!isBigCatch(e)) return;
  push(
    `<b>@${esc(e.name)}</b> ${esc(th.caught)} <span class="rarity r-${e.fish.rarity}">${esc(fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass))}</span> ` +
      `${esc(formatWeight(e.fish.weightLog10))} · <span class="coin">${esc(formatPoints(e.fish.price))}</span>`,
  );
  if (wantsReveal(e) && queueReveal(e)) return;
  queueCard(e);
});

// ---------- Big-catch reveal queue ----------

/**
 * Legendary and Mythic catches, titan/colossal size classes, density mutations (the dock-breaking
 * joke), and Epic catches that are the player's new best get the full reveal. With a big crowd these can pile up, so at most
 * two wait; the rest fall back to a card. Mythic and the dense joke jump the queue.
 */
const revealQueue: CatchEvent[] = [];
const MAX_REVEALS_WAITING = 2;

function wantsReveal(e: CatchEvent): boolean {
  const r = rarityRank(e.fish.rarity);
  return r >= rarityRank("legendary") || isDense(e.fish.mutations) || isHuge(e.fish.sizeClass) || (r === rarityRank("epic") && e.personalBest);
}

function queueReveal(e: CatchEvent): boolean {
  if (summary) return false;
  const urgent = e.fish.rarity === "mythic" || isDense(e.fish.mutations) || e.fish.sizeClass === "colossal";
  if (revealQueue.length >= MAX_REVEALS_WAITING && !urgent) return false;
  if (urgent) revealQueue.unshift(e);
  else revealQueue.push(e);
  if (revealQueue.length > MAX_REVEALS_WAITING) revealQueue.pop();
  if (!pond.reveal.active()) playNextReveal();
  return true;
}

let revealing: CatchEvent | null = null;

function playNextReveal(): void {
  const e = revealQueue.shift();
  revealing = e ?? null;
  if (!e) {
    revealEl.className = "";
    return;
  }
  pond.playReveal({ userId: e.userId, fish: e.fish }, playNextReveal);
}

let lastStage: string | null = null;
function renderReveal(): void {
  const stage = pond.reveal.stageOf();
  if (stage !== lastStage) {
    // White flash on the cut to the stage and on the cut back.
    if ((lastStage === "hook" && stage === "stage") || (lastStage === "stage" && stage === "drop") || (lastStage !== null && stage === null)) {
      flashEl.className = "";
      void flashEl.offsetWidth;
      flashEl.className = "go";
    }
    lastStage = stage;
  }
  document.body.classList.toggle("revealing", stage === "stage" || stage === "drop" || stage === "info");
  const e = revealing;
  if (!e || !stage) {
    revealEl.className = "";
    revealLabels.innerHTML = "";
    return;
  }
  const dense = isDense(e.fish.mutations);
  if (stage === "hook") {
    revealEl.className = `hook r-${e.fish.rarity}`;
    revealEl.innerHTML = `<div class="big">${esc(th.hooked)}</div><div class="who">@${esc(e.name)}</div>`;
    return;
  }
  const finish = finishFor(e.fish.mutations);
  if (dense && stage === "stage") {
    // The cosmic showpiece: a big title, and the stage to itself.
    revealEl.className = `cosmic r-${e.fish.rarity}`;
    revealEl.innerHTML = `<div class="big">${esc(th.cosmicTitle[finish] ?? th.denseCatch)}</div><div class="who">@${esc(e.name)}</div>`;
    return;
  }
  if (stage === "drop") {
    revealEl.className = ""; // the label points at the tiny fish
    return;
  }
  revealEl.className = `${stage} r-${e.fish.rarity}`;
  revealEl.innerHTML =
    `<div class="who"><b>@${esc(e.name)}</b> ${esc(dense ? th.denseCatch : th.bigCatch)}</div>` +
    `<div class="name">${esc(fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass))} <span class="chip">${esc(rarityTh[e.fish.rarity])}</span></div>` +
    `<div class="weight">${esc(formatWeight(e.fish.weightLog10))}</div>` +
    `<div class="len">${esc(th.lengthAbout(formatLength(fishLengthMeters(e.fish.weightLog10, e.fish.mutations))))}</div>` +
    `<div class="price">${esc(th.sellPrice)} ${esc(formatPoints(e.fish.price))}</div>` +
    (dense && th.denseFact[finish] ? `<div class="fact">${esc(th.denseFact[finish]!)}</div>` : "");
}
setInterval(renderReveal, 100);

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

// ---------- Round summary: podium, then each player's fish one at a time at true scale ----------

let summary: RoundSummary | null = null;
let playerIdx = 0;
let fishIdx = 0;
/** Key of the fish on the stage, so re-renders don't rebuild the same exhibit. */
let shownFish = "";
/** Auto-browse waits until this time (longer after a key press, so the streamer stays in control). */
let holdUntil = 0;
const MEDALS = ["🥇", "🥈", "🥉"];
const AUTO_BROWSE_MS = 7000;
const MANUAL_HOLD_MS = 15000;
const FIRST_HOLD_MS = 10000;

window.saf.onSummary((s) => {
  summary = s;
  playerIdx = 0;
  fishIdx = 0;
  shownFish = "";
  holdUntil = Date.now() + FIRST_HOLD_MS; // let the winner's best fish sink in first
  cardQueue.length = 0;
  revealQueue.length = 0;
  pond.abortReveal();
  document.body.classList.add("in-summary");
  summaryEl.classList.add("show");
  renderSummary();
});

function hideSummary(): void {
  if (summary) pond.showExhibit(null);
  summary = null;
  shownFish = "";
  document.body.classList.remove("in-summary");
  summaryEl.classList.remove("show");
}

/** ↑/↓: another player (starting from their most valuable fish). */
function selectPlayer(step: number): void {
  if (!summary || summary.players.length === 0) return;
  const n = summary.players.length;
  playerIdx = (playerIdx + step + n) % n;
  fishIdx = 0;
  renderSummary();
}

/** ←/→: the current player's next fish; past either end moves on to the neighbouring player. */
function selectFish(step: number): void {
  const p = summary?.players[playerIdx];
  if (!p) return;
  const next = fishIdx + step;
  if (next < 0 || next >= p.fish.length) {
    const n = summary!.players.length;
    playerIdx = (playerIdx + step + n) % n;
    fishIdx = step < 0 ? Math.max(0, (summary!.players[playerIdx]?.fish.length ?? 1) - 1) : 0;
  } else fishIdx = next;
  renderSummary();
}

function renderSummary(): void {
  if (!summary) return;
  const players = summary.players;
  const podium = players
    .slice(0, 3)
    .filter((p) => p.fish.length > 0)
    .map(
      (p, i) =>
        `<div><span class="medal">${MEDALS[i]}</span><span class="pname">${esc(p.name)}</span>` +
        `<span class="coin">${esc(formatPoints(p.totalValue))}</span></div>`,
    )
    .join("");

  let browser = `<div class="stats">${esc(th.noPlayers)}</div>`;
  const p = players[playerIdx];
  if (p) {
    const f = p.fish[fishIdx];
    const key = f ? `${p.userId}#${fishIdx}` : `${p.userId}#none`;
    if (key !== shownFish) {
      shownFish = key;
      pond.showExhibit(f ? { userId: p.userId, fish: f } : null);
    }
    const detail = f
      ? `<div class="exfish r-${f.rarity}">` +
        `<div class="exname">${esc(fishName(f.speciesId, f.mutations, f.sizeClass))} <span class="chip">${esc(rarityTh[f.rarity])}</span></div>` +
        `<div class="exnums"><span>${esc(formatWeight(f.weightLog10))}</span>` +
        `<span>${esc(th.lengthAbout(formatLength(fishLengthMeters(f.weightLog10, f.mutations))))}</span></div>` +
        `<div class="exprice">${esc(th.sellPrice)} <span class="coin">${esc(formatPoints(f.price))}</span>` +
        `<small>${esc(th.fishOf(fishIdx + 1, p.fish.length))}</small></div>` +
        `</div>`
      : `<div class="stats">${esc(th.noFish)}</div>`;
    browser =
      `<div class="bhead"><span class="arrow">▲</span><span class="bname">${p.rank <= 3 ? MEDALS[p.rank - 1] + " " : ""}${esc(p.name)}</span><span class="arrow">▼</span></div>` +
      `<div class="stats">${esc(th.rank(p.rank, players.length))} · ${esc(th.fishCount(p.fish.length))}` +
      (p.fish.length > 0 ? ` · ${esc(th.totalValue)} <span class="coin">${esc(formatPoints(p.totalValue))}</span>` : "") +
      `</div>` +
      detail +
      `<div class="hint">${esc(th.browseHint)}</div>`;
  }

  summaryEl.innerHTML =
    `<div class="panel podium"><h2>${esc(th.summaryTitle(summary.round))}</h2>${podium || esc(th.noPlayers)}</div>` +
    `<div class="panel browser">${browser}</div>`;
}

// When nobody is pressing keys (the streamer is busy talking), show each player's best fish in turn.
setInterval(() => {
  if (!summary || Date.now() < holdUntil) return;
  holdUntil = Date.now() + AUTO_BROWSE_MS;
  selectPlayer(1);
}, 500);

// Flash on the cut to the exhibit stage and back; hide the bay's name tags while it is up.
let wasExhibiting = false;
setInterval(() => {
  const on = pond.reveal.exhibiting();
  document.body.classList.toggle("exhibiting", on);
  if (on !== wasExhibiting) {
    wasExhibiting = on;
    flashEl.className = "";
    void flashEl.offsetWidth;
    flashEl.className = "go";
  }
}, 100);

// ---------- Keys ----------

// During the summary: ←/→ steps through a player's fish, ↑/↓ changes player.
// Otherwise ←/→ (or A/D) visits each fisher. Esc: overview.
window.addEventListener("keydown", (e) => {
  const step = e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? 1 : e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? -1 : 0;
  const vstep = e.key === "ArrowDown" || e.key === "s" || e.key === "S" ? 1 : e.key === "ArrowUp" || e.key === "w" || e.key === "W" ? -1 : 0;
  if (summary && (step !== 0 || vstep !== 0)) {
    holdUntil = Date.now() + MANUAL_HOLD_MS;
    if (step !== 0) selectFish(step);
    else selectPlayer(vstep);
  } else if (step !== 0) pond.focusStep(step);
  else if (e.key === "Escape") pond.focusOverview();
  else return;
  e.preventDefault();
});

// ---------- Points over heads ----------

/** Each player's points this round (shown on their name tag). */
const totals = new Map<string, number>();
/** Where each visible name tag is this frame (CSS px, its scale, whether it shows points). */
const tagAt = new Map<string, { x: number; y: number; scale: number; hasPoints: boolean }>();

interface Pop {
  el: HTMLDivElement;
  userId: string;
  born: number;
}
const pops: Pop[] = [];
const POP_MS = 1700;
const MAX_POPS = 80;

/** "+1,250" rising from the catcher's head; bigger and in rarity colour for better fish. */
function popPoints(e: CatchEvent): void {
  const el = document.createElement("div");
  el.className = `pop r-${e.fish.rarity}${isBigCatch(e) ? " big" : ""}`;
  el.textContent = `+${formatPointsShort(e.fish.price)}`;
  el.style.display = "none";
  tagLayer.appendChild(el);
  pops.push({ el, userId: e.userId, born: performance.now() });
  while (pops.length > MAX_POPS) pops.shift()!.el.remove();
}

function renderPops(): void {
  const now = performance.now();
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]!;
    const age = (now - p.born) / POP_MS;
    if (age >= 1) {
      p.el.remove();
      pops.splice(i, 1);
      continue;
    }
    const at = tagAt.get(p.userId);
    if (!at) {
      p.el.style.display = "none";
      continue;
    }
    // Pops that land together stack instead of overlapping.
    const stack = pops.filter((q, j) => j > i && q.userId === p.userId).length;
    const rise = (at.hasPoints ? 40 : 26) * at.scale + age * 46 + stack * 20;
    p.el.style.display = "";
    p.el.style.opacity = String(age < 0.65 ? 1 : 1 - (age - 0.65) / 0.35);
    // Pops stay readable even over far-away (shrunken) tags.
    const size = Math.max(0.9, at.scale) * (age < 0.12 ? 0.6 + (age / 0.12) * 0.4 : 1);
    p.el.style.transform = `translate(${at.x.toFixed(1)}px, ${(at.y - rise).toFixed(1)}px) translate(-50%, -100%) scale(${size.toFixed(2)})`;
  }
}

// ---------- Name tags ----------

// Name tags are HTML over the canvas: crisper Thai text than drawing it in the 3D scene.
const tags = new Map<string, HTMLDivElement>();
scene.onAfterRenderObservable.add(() => {
  // Scale-reference labels on the reveal stage.
  const cssScale = canvas.clientWidth / scene.getEngine().getRenderWidth();
  const labels = pond.reveal.labels(cssScale);
  while (revealLabels.children.length > labels.length) revealLabels.lastElementChild?.remove();
  labels.forEach((l, i) => {
    let el = revealLabels.children[i] as HTMLDivElement | undefined;
    if (!el) {
      el = document.createElement("div");
      el.className = "reflabel";
      revealLabels.appendChild(el);
    }
    const text = th.refs[l.key] ?? l.key;
    if (el.textContent !== text) el.textContent = text;
    el.style.display = l.visible ? "" : "none";
    el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(-50%, -100%)`;
  });

  const seen = new Set<string>();
  tagAt.clear();
  for (const t of crew.nameTags(camera, pond.focusedId())) {
    seen.add(t.userId);
    let el = tags.get(t.userId);
    if (!el) {
      el = document.createElement("div");
      el.innerHTML = `<span class="pts"></span><span class="nm"></span>`;
      tagLayer.appendChild(el);
      tags.set(t.userId, el);
    }
    const cls = (t.isChampion ? "tag champion" : t.isHost ? "tag host" : "tag") + (t.isFocused ? " focus" : "");
    if (el.className !== cls) el.className = cls;
    const nm = el.lastElementChild as HTMLSpanElement;
    if (nm.textContent !== t.name) nm.textContent = t.name;
    // Round total, always on show for everyone in the round.
    const total = totals.get(t.userId);
    const pts = el.firstElementChild as HTMLSpanElement;
    const ptsText = total === undefined ? "" : `⭐ ${formatPointsShort(total)}`;
    if (pts.textContent !== ptsText) pts.textContent = ptsText;
    pts.style.display = ptsText ? "" : "none";
    el.style.display = t.visible ? "" : "none";
    // Far-away tags shrink, so a full bay of 100 players stays readable.
    const scale = t.isFocused ? 1 : Math.max(0.7, Math.min(1, t.nearness));
    el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
    el.style.transformOrigin = "50% 100%";
    if (t.visible) tagAt.set(t.userId, { x: t.x, y: t.y, scale, hasPoints: !!ptsText });
  }
  renderPops();
  for (const [id, el] of tags) {
    if (!seen.has(id)) {
      el.remove();
      tags.delete(id);
    }
  }
});
