import { RARITIES, type CatchEvent, type Rarity, type RoundState, type RoundSummary } from "@saf/core";
import { fishLengthMeters } from "./reveal";
import { finishFor, isDense } from "./fishModels";
import { createPondScene } from "./scene";
import { describeAction, fishName, formatClock, formatPoints, formatPointsShort, formatLength, formatWeight, rarityTh, th } from "../../shared/strings.th";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const feed = document.getElementById("feed") as HTMLDivElement;
const tagLayer = document.getElementById("tags") as HTMLDivElement;
const roundbar = document.getElementById("roundbar") as HTMLDivElement;
const card = document.getElementById("card") as HTMLDivElement;
const summaryEl = document.getElementById("summary") as HTMLDivElement;
const revealEl = document.getElementById("reveal") as HTMLDivElement;
const revealLabels = document.getElementById("revealLabels") as HTMLDivElement;
const flashEl = document.getElementById("flash") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLDivElement;

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

// ---------- Title screen ----------

// The game window opens on the title over the live bay; START opens round 1.
const nameWords = th.gameName.split(" ");
const nameTail = nameWords.pop() ?? "";
titleEl.innerHTML =
  `<div class="logo"><div class="hook">🎣</div><div class="name">${esc(nameWords.join(" "))}<br><span class="tok">${esc(nameTail)}</span></div></div>` +
  `<button class="startbtn" type="button">${esc(th.start)}</button>` +
  `<div class="credit">${esc(th.credit)}</div>`;
titleEl.querySelector(".startbtn")!.addEventListener("click", () => startNextRound());

function hideTitle(): void {
  document.body.classList.remove("on-title");
}

/** START on the title or in the summary: the main process opens the next round. */
let starting = false;
function startNextRound(): void {
  if (starting) return;
  starting = true;
  hideTitle();
  void window.saf.startRound().finally(() => (starting = false));
}

// ---------- Round bar ----------

let round: RoundState = { phase: "idle", round: 0, endsAt: null, players: 0 };

function renderRoundBar(): void {
  const left = round.endsAt === null ? 0 : round.endsAt - Date.now();
  const clock =
    round.phase === "open" ? th.timeLeft(formatClock(left)) : th.phase[round.phase]; // the summary waits for START: no countdown
  const low = round.phase === "open" && left < 30_000 ? " low" : "";
  roundbar.innerHTML =
    `<span class="pill clock${low}">${esc(clock)}</span>` +
    `<span class="pill">${esc(th.players(round.players))}</span>`;
}
setInterval(renderRoundBar, 250);
renderRoundBar();

window.saf.onRound((state) => {
  if (state.phase !== "idle") hideTitle(); // e.g. the window reloaded mid-game
  const newRound = state.phase === "open" && state.round !== round.round;
  round = state;
  if (newRound) {
    // Everyone types 1 again each round: clear the dock and the summary.
    crew.reset();
    totals.clear();
    pendingSummary = null; // started before the last round's reveals finished: skip its summary
    hideSummary();
    pond.focusOverview();
    push(esc(th.joinHint));
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

/** Cards for big catches and steals. Urgent ones jump the queue; it is capped so it never lags far behind. */
interface CardItem {
  rarity: Rarity;
  html: string;
  urgent: boolean;
}
const cardQueue: CardItem[] = [];
let cardBusy = false;
const CARD_MS = 2600;
const MAX_QUEUE = 6;

function queueCardItem(item: CardItem): void {
  if (item.urgent) cardQueue.unshift(item);
  else cardQueue.push(item);
  while (cardQueue.length > MAX_QUEUE) cardQueue.pop();
  if (!cardBusy) showNextCard();
}

function queueCard(e: CatchEvent): void {
  queueCardItem({
    rarity: e.fish.rarity,
    urgent: rarityRank(e.fish.rarity) >= rarityRank("epic"),
    html:
      `<div class="catcher">@${esc(e.name)}</div>` +
      `<div class="name">${esc(fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass))} <span class="chip">${esc(rarityTh[e.fish.rarity])}</span></div>` +
      `<div class="points">${esc(formatPoints(e.fish.price))}</div>` +
      `<div class="weight">${esc(formatWeight(e.fish.weightLog10))}</div>` +
      (e.personalBest ? `<div class="best">${esc(th.newBest)}</div>` : ""),
  });
}

function showNextCard(): void {
  // Cards wait while a big-catch reveal has the screen.
  if (pond.reveal.active()) {
    setTimeout(showNextCard, 500);
    return;
  }
  const item = cardQueue.shift();
  if (!item) {
    cardBusy = false;
    card.className = "";
    return;
  }
  cardBusy = true;
  card.className = `r-${item.rarity}`;
  card.innerHTML = item.html;
  void card.offsetWidth; // restart the pop animation
  card.className = `r-${item.rarity} show`;
  setTimeout(showNextCard, CARD_MS);
}

/** A catch worth this many points gets the full catch scene. */
const BIG_CATCH_POINTS = 10_000;

/**
 * With a big crowd catching every few seconds, only big catches show at all — worth 10,000+
 * points, or a neutron-star / black-hole fish (their cosmic scene). They get the full catch scene,
 * a feed line and points popping over the catcher's head; everything else only adds to the
 * player's total on their name tag.
 */
function isBigCatch(e: CatchEvent): boolean {
  return e.fish.price >= BIG_CATCH_POINTS || isDense(e.fish.mutations);
}

window.saf.onCatch((e) => {
  crew.join({ userId: e.userId, name: e.name });
  crew.cast(e.userId);
  totals.set(e.userId, e.totalValue);
  // Every catch pops "+points" over the catcher's head; only big catches get a feed line, card or reveal.
  const big = isBigCatch(e);
  popText(e.userId, `+${formatPointsShort(e.fish.price)}`, `pop r-${e.fish.rarity}${big ? " big" : ""}`);
  if (!big) return;
  push(
    `<b>@${esc(e.name)}</b> ${esc(th.caught)} <span class="rarity r-${e.fish.rarity}">${esc(fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass))}</span> ` +
      `${esc(formatWeight(e.fish.weightLog10))} · <span class="coin">${esc(formatPoints(e.fish.price))}</span>`,
  );
  if (wantsReveal(e) && queueReveal(e)) return;
  queueCard(e);
});

// ---------- Big-catch reveal queue ----------

/**
 * Every big catch (10,000+ points, or a density mutation) gets its full reveal, however many
 * arrive at once: none is dropped. Mythic, the cosmic density scenes and colossal fish go ahead of
 * the others (in the order they came); when several are waiting the reveals play faster to catch
 * up. A round that ends mid-queue shows its summary after the last reveal.
 */
const revealQueue: { e: CatchEvent; urgent: boolean }[] = [];
let revealing: CatchEvent | null = null;
/** A summary that arrived while reveals were still playing; shown when they are done. */
let pendingSummary: RoundSummary | null = null;

function wantsReveal(e: CatchEvent): boolean {
  return isBigCatch(e);
}

function queueReveal(e: CatchEvent): boolean {
  if (summary) return false;
  const urgent = e.fish.rarity === "mythic" || isDense(e.fish.mutations) || e.fish.sizeClass === "colossal";
  // Urgent ones go after the urgent ones already waiting, ahead of the rest.
  const at = urgent ? revealQueue.findIndex((q) => !q.urgent) : -1;
  if (at >= 0) revealQueue.splice(at, 0, { e, urgent });
  else revealQueue.push({ e, urgent });
  if (!revealing) playNextReveal();
  return true;
}

function playNextReveal(): void {
  const next = revealQueue.shift();
  revealing = next?.e ?? null;
  if (!next) {
    revealEl.className = "";
    if (pendingSummary) {
      const s = pendingSummary;
      pendingSummary = null;
      showSummary(s);
    }
    return;
  }
  // 1× with nothing waiting, up to 1.8× with four or more in line.
  const speed = 1 + Math.min(revealQueue.length, 4) * 0.2;
  pond.playReveal({ userId: next.e.userId, fish: next.e.fish }, playNextReveal, speed);
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
    `<div class="catcher">@${esc(e.name)}</div>` +
    `<div class="who">${esc(dense ? th.denseCatch : th.bigCatch)}</div>` +
    `<div class="name">${esc(fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass))} <span class="chip">${esc(rarityTh[e.fish.rarity])}</span></div>` +
    `<div class="points">${esc(formatPoints(e.fish.price))}</div>` +
    `<div class="len">${esc(formatWeight(e.fish.weightLog10))} · ${esc(th.lengthAbout(formatLength(fishLengthMeters(e.fish.weightLog10, e.fish.mutations))))}</div>` +
    (dense && th.denseFact[finish] ? `<div class="fact">${esc(th.denseFact[finish]!)}</div>` : "");
}
setInterval(renderReveal, 100);

// Other actions (frenzy, collection, …) still show in the feed; casts are shown as catches.
// Steals: always news. The fish changes hands, both totals move, and everyone sees it.
window.saf.onSteal((e) => {
  crew.join({ userId: e.thief.userId, name: e.thief.name });
  totals.set(e.thief.userId, e.thief.totalValue);
  totals.set(e.victim.userId, e.victim.totalValue);
  const points = formatPointsShort(e.fish.price);
  popText(e.thief.userId, `🕵️ +${points}`, "pop steal big");
  popText(e.victim.userId, `−${points}`, "pop robbed big");
  const fish = fishName(e.fish.speciesId, e.fish.mutations, e.fish.sizeClass);
  push(`🕵️ <b>@${esc(e.thief.name)}</b> ${esc(th.stole)} <span class="rarity r-${e.fish.rarity}">${esc(fish)}</span> ${esc(th.from)} <b>@${esc(e.victim.name)}</b>!`);
  queueCardItem({
    rarity: e.fish.rarity,
    urgent: true,
    html:
      `<div class="who">🕵️ <b>@${esc(e.thief.name)}</b> ${esc(th.stole)}</div>` +
      `<div class="name">${esc(fish)}</div>` +
      `<div class="who">${esc(th.from)} <b>@${esc(e.victim.name)}</b></div>` +
      `<div class="price">${esc(formatPoints(e.fish.price))}</div>`,
  });
});

window.saf.onLucky((e) => {
  push(`🧡 <b>@${esc(e.name)}</b> ${esc(th.luckyGot)} <b>${esc(th.luckyTier[e.label] ?? e.label)}</b>!`);
});

window.saf.onGameAction((fired) => {
  const t = fired.action.type;
  // Casts, draws and steals show through their results (catches, onLucky, onSteal).
  if (t === "cast" || t === "net" || t === "lucky" || t === "steal") return;
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
  // Let the big catches still in line play first; the summary follows the last one.
  if (revealing || revealQueue.length > 0) {
    pendingSummary = s;
    return;
  }
  showSummary(s);
});

function showSummary(s: RoundSummary): void {
  summary = s;
  playerIdx = 0;
  fishIdx = 0;
  shownFish = "";
  holdUntil = Date.now() + FIRST_HOLD_MS; // let the winner's best fish sink in first
  cardQueue.length = 0;
  document.body.classList.add("in-summary");
  summaryEl.classList.add("show");
  renderSummary();
}

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
        `<div class="exprice">${esc(formatPoints(f.price))}<small>${esc(th.fishOf(fishIdx + 1, p.fish.length))}</small></div>` +
        `<div class="exnums"><span>${esc(formatWeight(f.weightLog10))}</span>` +
        `<span>${esc(th.lengthAbout(formatLength(fishLengthMeters(f.weightLog10, f.mutations))))}</span></div>` +
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
    `<div class="panel browser">${browser}</div>` +
    `<button class="nextbtn" type="button">${esc(th.nextRound)}</button><div class="nextkey">${esc(th.nextRoundKey)}</div>`;
}

// The summary stays up until the streamer starts the next round (no countdown).
summaryEl.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest(".nextbtn")) startNextRound();
});

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

// Title or summary: Enter starts the (next) round.
// During the summary: ←/→ steps through a player's fish, ↑/↓ changes player.
// Otherwise ←/→ (or A/D) visits each fisher. Esc: overview.
window.addEventListener("keydown", (e) => {
  const step = e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? 1 : e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? -1 : 0;
  const vstep = e.key === "ArrowDown" || e.key === "s" || e.key === "S" ? 1 : e.key === "ArrowUp" || e.key === "w" || e.key === "W" ? -1 : 0;
  const onTitle = document.body.classList.contains("on-title");
  if ((e.key === "Enter" || (onTitle && e.key === " ")) && (onTitle || summary)) startNextRound();
  else if (onTitle) return;
  else if (summary && (step !== 0 || vstep !== 0)) {
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

/** Text rising from a player's head ("+1,250" for a big catch, "−300" when robbed). */
function popText(userId: string, text: string, className: string): void {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.style.display = "none";
  tagLayer.appendChild(el);
  pops.push({ el, userId, born: performance.now() });
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
