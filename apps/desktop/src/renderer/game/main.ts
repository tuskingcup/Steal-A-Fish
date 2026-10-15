import { createPondScene } from "./scene";
import { describeAction, th } from "../shared/strings.th";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const feed = document.getElementById("feed") as HTMLDivElement;
(document.getElementById("title") as HTMLDivElement).textContent = th.gameTitle;
(document.getElementById("pond") as HTMLDivElement).textContent = th.pondVillage;

const { splash } = createPondScene(canvas);

const MAX_ITEMS = 5;

function push(html: string): void {
  const item = document.createElement("div");
  item.className = "item";
  item.innerHTML = html;
  feed.appendChild(item);
  while (feed.children.length > MAX_ITEMS) feed.firstElementChild?.remove();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

push(esc(th.waiting));

// Placeholder: every action splashes the bobber and shows a line.
// The real display queue + catch reveal replaces this.
window.saf.onGameAction((fired) => {
  splash();
  const who = fired.viewer.uniqueId || fired.viewer.nickname;
  push(`<b>@${esc(who)}</b> → ${esc(describeAction(fired.action, fired.times))}`);
});
