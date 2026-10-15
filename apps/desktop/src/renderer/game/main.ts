import { createPondScene } from "./scene";
import { describeAction, th } from "../shared/strings.th";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const feed = document.getElementById("feed") as HTMLDivElement;
const tagLayer = document.getElementById("tags") as HTMLDivElement;
(document.getElementById("title") as HTMLDivElement).textContent = th.gameTitle;
(document.getElementById("pond") as HTMLDivElement).textContent = th.pondVillage;

const pond = createPondScene(canvas, { userId: "host", name: th.hostName });
const { scene, camera, crew } = pond;

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

// Placeholder: every action seats the viewer on the dock and plays a cast.
// The real display queue + catch reveal replaces this.
window.saf.onGameAction((fired) => {
  const name = fired.viewer.nickname || fired.viewer.uniqueId;
  crew.join({ userId: fired.viewer.userId, name });
  crew.cast(fired.viewer.userId);
  const who = fired.viewer.uniqueId || fired.viewer.nickname;
  push(`<b>@${esc(who)}</b> → ${esc(describeAction(fired.action, fired.times))}`);
});

let championId: string | null = null;
window.saf.onPodium((podium) => {
  crew.setPodium(podium.map((p) => p.userId));
  const champion = podium[0];
  if (champion && champion.userId !== championId) push(`👑 <b>@${esc(champion.name)}</b> ${esc(th.newChampion)}`);
  championId = champion?.userId ?? null;
});

// ←/→ (or A/D) visit each fisher in turn; Esc goes back to the overview.
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") pond.focusStep(1);
  else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") pond.focusStep(-1);
  else if (e.key === "Escape") pond.focusOverview();
  else return;
  e.preventDefault();
});

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
