import { createServer, type Server } from "node:http";
import type { RoundState, Standing } from "@saf/core";
import { formatPointsShort } from "../shared/strings.th";

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

/** Rows shown before the list scrolls. */
const VISIBLE_ROWS = 10;
/** The page is a fixed 131 px wide (the streamer's layout slot); rows are sized for that. */
const WIDTH_PX = 131;
const ROW_PX = 36;
const PORTS = [37821, 37822, 37823, 37824, 37825];
/** The page answers on all of these (older links keep working). */
const PAGE_PATHS = new Set(["/", "/index.html", "/leaderboard", "/leaderboard/", "/leaderboard/index.html", "/leaderboard.html"]);

/** Just the standings: no round number, clock or join hint (the game window shows those). */
function data(snap: OverlaySnapshot): { rows: OverlayRow[] } {
  return {
    rows: snap.standings.map((s) => ({ rank: s.rank, id: s.userId, name: s.name, points: formatPointsShort(s.points), value: s.points })),
  };
}

const PAGE = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${WIDTH_PX}, initial-scale=1">
<title>Leaderboard</title>
<style>
  :root { --w: ${WIDTH_PX}px; --row: ${ROW_PX}px; --rows: ${VISIBLE_ROWS}; }
  html, body { margin: 0; width: var(--w); background: transparent; color: #fff; overflow: hidden;
    font-family: "Mitr", "Noto Sans Thai", "Leelawadee UI", "Tahoma", system-ui, sans-serif; }
  .panel { width: var(--w); box-sizing: border-box; background: #071C29E6; border: 1px solid #2D6E84; border-radius: 10px; padding: 3px; }
  .panel.empty { display: none; }
  /* Scrollable by wheel/drag, but no scrollbar eating the narrow width. */
  .list { max-height: calc(var(--row) * var(--rows)); overflow-y: auto; scrollbar-width: none; }
  .list::-webkit-scrollbar { display: none; }
  .row { height: var(--row); box-sizing: border-box; display: flex; align-items: center; gap: 5px; padding: 0 4px; border-radius: 7px; transition: background .6s; }
  .row + .row { box-shadow: inset 0 1px 0 #2D6E8444; }
  .rank { position: relative; flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
    font-weight: 800; font-size: 11px; line-height: 1; background: #12384C; color: #CFE8EE; font-variant-numeric: tabular-nums; }
  .r1 { background: linear-gradient(90deg, #FFC23D2E, #FFC23D08); }
  .r1 .rank { background: linear-gradient(#FFE07A, #FFB52E); color: #3A2500; }
  .r1 .rank::before { content: "👑"; position: absolute; top: -9px; font-size: 10px; }
  .r2 .rank { background: linear-gradient(#F2F5F7, #AEB8C0); color: #263038; }
  .r3 .rank { background: linear-gradient(#F3B98A, #C7783E); color: #331A08; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
  .name { font-size: 11.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pts { font-size: 11px; font-weight: 800; color: #FFD866; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pts::before { content: "⭐"; font-size: 9px; margin-right: 2px; }
  .r1 .name { color: #FFE9A8; }
  .row.up { background: #FFC23D55; }
</style>
</head>
<body>
<div class="panel empty" id="panel"><div class="list" id="list"></div></div>
<script>
const params = new URLSearchParams(location.search);
const AUTO = params.get("auto") !== "0";
const panel = document.getElementById("panel");
const list = document.getElementById("list");
const prev = new Map();
let lastJson = "";

function cell(cls, text) {
  const e = document.createElement("div");
  e.className = cls;
  e.textContent = text;
  return e;
}

async function refresh() {
  try {
    const res = await fetch("/leaderboard.json", { cache: "no-store" });
    const d = await res.json();
    const json = JSON.stringify(d.rows);
    if (json === lastJson) return;
    lastJson = json;
    panel.classList.toggle("empty", d.rows.length === 0);
    list.replaceChildren();
    for (const r of d.rows) {
      const row = document.createElement("div");
      row.className = "row r" + r.rank;
      const info = document.createElement("div");
      info.className = "info";
      info.append(cell("name", r.name), cell("pts", r.points));
      row.append(cell("rank", r.rank), info);
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
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/leaderboard.json" || path === "/leaderboard/leaderboard.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(data(snapshot())));
    } else if (PAGE_PATHS.has(path)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PAGE);
    } else {
      res.writeHead(404).end();
    }
  };
  /** Listen on one local address; resolves to the server, or null if the port is taken there. */
  const listen = (port: number, host: string): Promise<Server | null> =>
    new Promise((resolve) => {
      const server = createServer(handler);
      server.once("error", () => resolve(null));
      server.listen(port, host, () => resolve(server));
    });
  const tryPort = async (i: number): Promise<{ url: string | null; close: () => void }> => {
    if (i >= PORTS.length) return { url: null, close: () => {} };
    const port = PORTS[i]!;
    // This computer only: TikTok LIVE Studio and OBS run here, nobody else needs it.
    const v4 = await listen(port, "127.0.0.1");
    if (!v4) return tryPort(i + 1);
    // "localhost" may resolve to IPv6 first (Windows, newer Node), so answer there too when we can.
    const v6 = await listen(port, "::1");
    return {
      url: `http://localhost:${port}/leaderboard/index.html`,
      close: () => {
        v4.close();
        v6?.close();
      },
    };
  };
  return tryPort(0);
}
