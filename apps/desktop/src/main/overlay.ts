import { createServer, type Server } from "node:http";
import type { RoundState, Standing } from "@saf/core";
import { formatClock, formatPointsShort, th } from "../shared/strings.th";

/**
 * The leaderboard overlay for TikTok LIVE Studio (or OBS): a small web page served by the app on
 * this computer only. The streamer adds its link as a "Link" source; the page polls the
 * standings once a second. Read-only, and it never shows the 3D scene (that is the game window).
 */

export interface OverlaySnapshot {
  state: RoundState;
  standings: Standing[];
}

interface OverlayRow {
  rank: number;
  id: string;
  name: string;
  points: string;
  /** Raw points, so the page can flash a row whose score went up. */
  value: number;
}

interface OverlayData {
  title: string;
  status: string;
  empty: string;
  more: string;
  rows: OverlayRow[];
}

/** Rows shown before the list scrolls. */
const VISIBLE_ROWS = 10;
const PORTS = [37821, 37822, 37823, 37824, 37825];

function data(snap: OverlaySnapshot): OverlayData {
  const { state, standings } = snap;
  const left = state.endsAt === null ? 0 : state.endsAt - Date.now();
  return {
    title: th.overlayTitle(Math.max(state.round, 1)),
    status: state.phase === "open" ? th.timeLeft(formatClock(left)) : state.phase === "summary" ? th.overlayFinal : "",
    empty: th.overlayEmpty,
    more: standings.length > VISIBLE_ROWS ? th.overlayMore(standings.length - VISIBLE_ROWS) : "",
    rows: standings.map((s) => ({ rank: s.rank, id: s.userId, name: s.name, points: formatPointsShort(s.points), value: s.points })),
  };
}

const PAGE = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leaderboard</title>
<style>
  :root { --row: 52px; --rows: ${VISIBLE_ROWS}; }
  html, body { margin: 0; background: transparent; color: #fff; overflow: hidden;
    font-family: "Mitr", "Noto Sans Thai", "Leelawadee UI", "Tahoma", system-ui, sans-serif; }
  .panel { margin: 8px; background: #071C29E0; border: 2px solid #2D6E84; border-radius: 16px; padding: 10px 10px 8px; box-shadow: 0 6px 24px #0008; }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 0 4px 8px; }
  .title { flex: 1; font-size: 20px; font-weight: 800; color: #FFC23D; text-shadow: 0 2px 0 #0008; }
  .status { font-size: 14px; color: #9FE3E6; white-space: nowrap; }
  .list { max-height: calc(var(--row) * var(--rows)); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #2D6E84 transparent; }
  .list::-webkit-scrollbar { width: 6px; } .list::-webkit-scrollbar-thumb { background: #2D6E84; border-radius: 3px; }
  .row { height: var(--row); box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 0 8px; border-radius: 12px; transition: background .6s; }
  .row + .row { border-top: 1px solid #2D6E8444; }
  .rank { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 15px; background: #12384C; color: #CFE8EE; }
  .r1 .rank { background: linear-gradient(#FFE07A, #FFB52E); color: #3A2500; }
  .r2 .rank { background: linear-gradient(#F2F5F7, #AEB8C0); color: #263038; }
  .r3 .rank { background: linear-gradient(#F3B98A, #C7783E); color: #331A08; }
  .r1 .name::after { content: " 👑"; }
  .name { flex: 1; min-width: 0; font-size: 17px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pts { flex: none; font-size: 17px; font-weight: 800; color: #FFD866; font-variant-numeric: tabular-nums; }
  .pts::before { content: "⭐ "; }
  .row.up { background: #FFC23D33; }
  .empty, .more { text-align: center; color: #9FE3E6; font-size: 14px; padding: 10px 0 4px; }
  .more { padding: 6px 0 0; font-size: 12px; }
</style>
</head>
<body>
<div class="panel">
  <div class="head"><div class="title" id="title"></div><div class="status" id="status"></div></div>
  <div class="list" id="list"></div>
  <div class="more" id="more"></div>
</div>
<script>
const params = new URLSearchParams(location.search);
const AUTO = params.get("auto") !== "0";
const list = document.getElementById("list");
const prev = new Map();
let lastJson = "";

async function refresh() {
  try {
    const res = await fetch("/leaderboard.json", { cache: "no-store" });
    const d = await res.json();
    document.getElementById("title").textContent = d.title;
    document.getElementById("status").textContent = d.status;
    document.getElementById("more").textContent = d.more;
    const json = JSON.stringify(d.rows);
    if (json === lastJson) return;
    lastJson = json;
    list.replaceChildren();
    if (d.rows.length === 0) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = d.empty;
      list.appendChild(e);
    }
    for (const r of d.rows) {
      const row = document.createElement("div");
      row.className = "row r" + r.rank;
      const rank = document.createElement("div");
      rank.className = "rank";
      rank.textContent = r.rank;
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = r.name;
      const pts = document.createElement("div");
      pts.className = "pts";
      pts.textContent = r.points;
      row.append(rank, name, pts);
      if (prev.has(r.id) && prev.get(r.id) < r.value) {
        row.classList.add("up");
        setTimeout(() => row.classList.remove("up"), 700);
      }
      list.appendChild(row);
    }
    prev.clear();
    for (const r of d.rows) prev.set(r.id, r.value);
  } catch (e) {
    /* the app is restarting: try again next tick */
  }
}
refresh();
setInterval(refresh, 1000);

// Viewers can't scroll a stream, so when nobody has touched the list for a while it scrolls
// itself slowly to the bottom and back. Any wheel, drag or touch hands control back for 15 s.
let idleUntil = 0;
for (const ev of ["wheel", "mousedown", "touchstart", "keydown"]) addEventListener(ev, () => (idleUntil = Date.now() + 15000), { passive: true });
let phase = "top", phaseAt = Date.now();
setInterval(() => {
  if (!AUTO || Date.now() < idleUntil || list.scrollHeight <= list.clientHeight + 2) { phase = "top"; phaseAt = Date.now(); return; }
  const since = Date.now() - phaseAt;
  if (phase === "top" && since > 6000) { phase = "down"; phaseAt = Date.now(); }
  else if (phase === "down") {
    list.scrollTop += 1;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) { phase = "bottom"; phaseAt = Date.now(); }
  } else if (phase === "bottom" && since > 4000) { list.scrollTo({ top: 0, behavior: "smooth" }); phase = "top"; phaseAt = Date.now(); }
}, 30);
</script>
</body>
</html>`;

/** Serve the overlay on the first free local port; resolves to its URL (or null if none was free). */
export function startOverlay(snapshot: () => OverlaySnapshot): Promise<{ url: string | null; close: () => void }> {
  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/leaderboard.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(data(snapshot())));
    } else if (path === "/" || path === "/leaderboard") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PAGE);
    } else {
      res.writeHead(404).end();
    }
  };
  const tryPort = (i: number): Promise<{ url: string | null; close: () => void }> =>
    new Promise((resolve) => {
      if (i >= PORTS.length) return resolve({ url: null, close: () => {} });
      const server: Server = createServer(handler);
      server.once("error", () => resolve(tryPort(i + 1)));
      // This computer only: TikTok LIVE Studio and OBS run here, nobody else needs it.
      server.listen(PORTS[i], "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${PORTS[i]}/leaderboard`, close: () => server.close() }));
    });
  return tryPort(0);
}
