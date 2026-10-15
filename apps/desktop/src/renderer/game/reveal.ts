import type { Scene } from "@babylonjs/core/scene";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { avatarFor, type MutationId, type Rarity } from "@saf/core";
import { createAura, glowFor, splashBurst, type Aura } from "./effects";
import { createFishModel, finishFor, isDense, type FishModel } from "./fishModels";
import { createFisherSprite, type FisherSprite } from "./fisherSprite";
import { flat, hash01, lowPolyMat } from "./materials";

/**
 * The reveal stage, far out at sea, used two ways:
 * - the big-catch reveal (~8 s): hook on the fisher → flash → the fish leaps out of the water →
 *   the camera dollies back while scale references pop in beside it;
 * - the summary exhibit: one fish at a time, at true scale beside its owner, camera slowly orbiting.
 *
 * True scale without kilometre geometry: units per metre = FISH_UNITS / max(fish length, a person),
 * so a 30 cm fish is shown small next to its owner and a 13 km fish stays 4 units long with Everest
 * scaled down beside it. Legendary+ and mutated fish get showpiece effects (effects.ts). Density
 * mutations play the opposite joke in the reveal: a tiny glowing fish snaps a dock in half.
 */

export interface RevealFish {
  speciesId: string;
  rarity: Rarity;
  mutations: MutationId[];
  weightLog10: number;
}

export interface RevealRequest {
  userId: string;
  fish: RevealFish;
}

export interface RevealLabel {
  key: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface Reveal {
  /** True while a reveal is playing. */
  active(): boolean;
  /** True while the stage drives the camera (reveal on stage, or an exhibit). */
  ownsCamera(): boolean;
  play(request: RevealRequest, hookOn: (userId: string) => void, onDone: () => void): void;
  /** Show one fish at true scale for the round summary (stays until replaced or null). */
  exhibit(request: RevealRequest | null): void;
  exhibiting(): boolean;
  /** Stop immediately (e.g. the round ended) and put everything back. */
  abort(): void;
  update(dt: number): void;
  /** Reference labels (keys into the Thai strings) in canvas CSS pixels. */
  labels(cssScale: number): RevealLabel[];
  /** Where the reveal timeline is, for the overlay. */
  /** `drop` (dense fish only): the effect has imploded and the tiny fish is about to fall. */
  stageOf(): "hook" | "stage" | "drop" | "info" | null;
}

/** Real fish: length (m) ≈ 0.4 × kg^(1/3). */
export function fishLengthMeters(weightLog10: number, mutations: readonly MutationId[]): number {
  return isDense(mutations) ? 0.02 : 0.4 * 10 ** (weightLog10 / 3);
}

// Timeline (seconds).
const HOOK_END = 1.3;
const FLASH_AT = 1.3;
const RISE_END = 3.2;
const DOLLY_END = 6.4;
const END = 8.2;
// Dense fish: the cosmic power builds around the hovering speck, holds, implodes back into it;
// then the tiny fish drops onto the dock and snaps it.
const DENSE_BUILD_END = 3.0;
const DENSE_HOLD_END = 6.2;
const DENSE_IMPLODE_END = 6.6;
const DENSE_FALL_AT = 7.6;
const DENSE_IMPACT = 8.1;
const DENSE_END = 11.6;
const DENSE_HOVER_Y = 2.6;
/** Size of the cosmic effect: in the reveal, and beside the owner in the summary exhibit. */
const DENSE_AURA = 1.5;
const EXHIBIT_DENSE_AURA = 1.5;
/**
 * A density mutant is shown enlarged while its power is up (the star of its own effect), and
 * shrinks to a speck when the power implodes. In the summary it stays enlarged, labelled as such.
 */
const DENSE_HERO = 2.1;
const DENSE_SPECK = 0.3;
const EXHIBIT_DENSE_HERO = 2.0;

/** The bigger of the fish and a person is this long on the stage, in scene units. */
const FISH_UNITS = 4;
const HUMAN_M = 1.7;
/** Exhibit camera pitch: nearly level, so the horizon (and a Mythic sky) sits behind the fish. */
const EXHIBIT_BETA = 1.5;
/** Far out past the bay (the main sea ends at z ≈ 160), with fog hiding the stage water's edge. */
const STAGE = new Vector3(0, 0, 650);

/** Scale references, real height/size in metres. Keys index the Thai label strings. */
const REFERENCES = [
  { key: "human", size: 1.7 },
  { key: "boat", size: 9 },
  { key: "house", size: 10 },
  { key: "temple", size: 70 },
  { key: "tower", size: 300 },
  { key: "doiInthanon", size: 2565 },
  { key: "everest", size: 8849 },
  { key: "moon", size: 3_474_000 },
  { key: "earth", size: 12_742_000 },
] as const;
type RefKey = (typeof REFERENCES)[number]["key"];

interface PlacedRef {
  key: RefKey;
  node: TransformNode;
  sprite: FisherSprite | null;
  height: number;
  appearAt: number;
  scale: number;
}

export function createReveal(scene: Scene, camera: ArcRotateCamera): Reveal {
  // ---------- Stage ----------
  const stage = new TransformNode("revealStage", scene);
  stage.position = STAGE.clone();
  const water = CreateGround("revealWater", { width: 900, height: 900, subdivisions: 36 }, scene);
  water.parent = stage;
  flat(water);
  const waterMat = new StandardMaterial("revealWaterMat", scene);
  waterMat.diffuseColor = Color3.FromHexString("#2C8FB0");
  waterMat.specularColor = new Color3(0.8, 0.8, 0.7);
  waterMat.specularPower = 40;
  water.material = waterMat;
  // Faceted shimmer without per-frame work: jitter the flat facets once.
  const wp = water.getVerticesData("position")!;
  for (let i = 0; i < wp.length; i += 9) {
    const dy = (hash01(i * 0.37) - 0.5) * 0.25;
    wp[i + 1] = dy;
    wp[i + 4] = dy * 0.6;
    wp[i + 7] = -dy * 0.4;
  }
  water.updateVerticesData("position", wp);
  water.createNormals(false);

  // Splash: a widening ring plus droplets flying out.
  const ring = CreateTorus("splashRing", { diameter: 1, thickness: 0.08, tessellation: 24 }, scene);
  ring.parent = stage;
  const foam = lowPolyMat(scene, "#FFFFFF", { emissive: 0.6 });
  ring.material = foam;
  const drops: Mesh[] = [];
  for (let i = 0; i < 18; i++) {
    const d = CreateIcoSphere("drop", { radius: 0.08, subdivisions: 1 }, scene);
    d.parent = stage;
    d.material = foam;
    drops.push(d);
  }
  stage.setEnabled(false);

  // ---------- Reference models (unit height, built on demand) ----------
  const buildRef = (key: RefKey): TransformNode => {
    const node = new TransformNode(`ref_${key}`, scene);
    node.parent = stage;
    const add = (mesh: Mesh, color: string, emissive = 0) => {
      mesh.parent = node;
      mesh.material = lowPolyMat(scene, color, { emissive });
      return mesh;
    };
    switch (key) {
      case "boat": {
        const hull = add(CreateBox("hull", { width: 1, height: 0.18, depth: 0.3 }, scene), "#8A5A36");
        hull.position.y = 0.09;
        const cabin = add(CreateBox("cabin", { width: 0.3, height: 0.25, depth: 0.22 }, scene), "#EDE6D3");
        cabin.position.set(-0.1, 0.3, 0);
        break;
      }
      case "house": {
        for (const [x, z] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]] as const) {
          const stilt = add(CreateBox("stilt", { width: 0.05, height: 0.35, depth: 0.05 }, scene), "#6B4930");
          stilt.position.set(x, 0.175, z);
        }
        const body = add(CreateBox("walls", { width: 0.8, height: 0.32, depth: 0.6 }, scene), "#B07A4A");
        body.position.y = 0.51;
        const roof = add(CreateCylinder("roof", { height: 0.9, diameter: 0.75, tessellation: 3 }, scene), "#C8463A");
        roof.rotation.z = Math.PI / 2;
        roof.position.y = 0.82;
        break;
      }
      case "temple": {
        const base = add(CreateCylinder("base", { height: 0.18, diameter: 0.6, tessellation: 8 }, scene), "#F4F1E8");
        base.position.y = 0.09;
        const bell = flat(add(CreateIcoSphere("bell", { radius: 0.24, subdivisions: 1 }, scene), "#F4F1E8"));
        bell.position.y = 0.36;
        const spire = add(CreateCylinder("spire", { height: 0.5, diameterTop: 0, diameterBottom: 0.16, tessellation: 8 }, scene), "#E8B73C", 0.2);
        spire.position.y = 0.75;
        break;
      }
      case "tower": {
        const shaft = add(CreateBox("shaft", { width: 0.16, height: 0.92, depth: 0.16 }, scene), "#5D7A93");
        shaft.position.y = 0.46;
        for (let i = 1; i < 9; i++) {
          const band = add(CreateBox("windows", { width: 0.165, height: 0.025, depth: 0.165 }, scene), "#BFE3F2", 0.4);
          band.position.y = i * 0.1;
        }
        const mast = add(CreateCylinder("mast", { height: 0.08, diameter: 0.01, tessellation: 4 }, scene), "#D9DDE2");
        mast.position.y = 0.96;
        break;
      }
      case "doiInthanon":
      case "everest": {
        const snowy = key === "everest";
        const mountain = add(CreateCylinder("mountain", { height: 1, diameterTop: 0, diameterBottom: 1.8, tessellation: 7 }, scene), snowy ? "#8C8F91" : "#4E8A4A");
        flat(mountain);
        mountain.position.y = 0.5;
        if (snowy) {
          const cap = add(CreateCylinder("snow", { height: 0.32, diameterTop: 0, diameterBottom: 0.58, tessellation: 7 }, scene), "#F7FAFC");
          flat(cap);
          cap.position.y = 0.84;
        }
        break;
      }
      case "moon":
      case "earth": {
        const ball = flat(add(CreateIcoSphere("planet", { radius: 0.5, subdivisions: 2 }, scene), key === "moon" ? "#B8B8B0" : "#2F6DB5"));
        ball.position.y = 0.5;
        if (key === "earth") {
          for (let i = 0; i < 6; i++) {
            const land = flat(add(CreateIcoSphere("land", { radius: 0.17, subdivisions: 1 }, scene), "#5AAE61"));
            const a = hash01(i) * Math.PI * 2;
            const b = (hash01(i + 9) - 0.5) * 2;
            land.position = new Vector3(Math.cos(a) * 0.42, 0.5 + b * 0.32, Math.sin(a) * 0.42);
            land.scaling.y = 0.5;
          }
        }
        break;
      }
      case "human":
        break; // the catcher's own sprite stands in
    }
    return node;
  };

  // ---------- Dense-joke dock ----------
  const buildDock = (): { node: TransformNode; left: TransformNode; right: TransformNode } => {
    const node = new TransformNode("revealDock", scene);
    node.parent = stage;
    const left = new TransformNode("dockLeft", scene);
    const right = new TransformNode("dockRight", scene);
    left.parent = node;
    right.parent = node;
    left.position.x = 0;
    right.position.x = 0;
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? left : right;
      const plank = CreateBox("plank", { width: 0.34, height: 0.1, depth: 1.6 }, scene);
      plank.parent = side;
      plank.position.set((i - 3.5) * 0.36, 0.85, 0);
      plank.material = lowPolyMat(scene, i % 2 ? "#A8744A" : "#946140");
    }
    for (const x of [-1.3, 1.3]) {
      const post = CreateCylinder("post", { height: 1.6, diameter: 0.18, tessellation: 6 }, scene);
      post.parent = node;
      post.position.set(x, 0.1, 0);
      post.material = lowPolyMat(scene, "#6B4930");
    }
    return { node, left, right };
  };

  // ---------- State ----------
  const glow = glowFor(scene);
  let playing = false;
  let exhibitOn = false;
  let t = 0;
  let clock = 0;
  let request: RevealRequest | null = null;
  let done: (() => void) | null = null;
  let fishModel: FishModel | null = null;
  let aura: Aura | null = null;
  const fishAnchor = new TransformNode("fishAnchor", scene);
  fishAnchor.parent = stage;
  let refs: PlacedRef[] = [];
  let platform: Mesh | null = null;
  let dock: ReturnType<typeof buildDock> | null = null;
  let catcher: FisherSprite | null = null;
  let dense = false;
  /** The fish on display is a density mutant (its cosmic effect replaces the size story). */
  let denseShown = false;
  let auraPower = 1;
  let stopSplash: (() => void) | null = null;
  let splashed = false;
  let savedFog = { start: 0, end: 0 };
  let savedCam = { target: Vector3.Zero(), alpha: 0, beta: 0, radius: 0 };
  let onStage = false;
  let fishUnits = FISH_UNITS;
  let closeRadius = FISH_UNITS * 1.7;
  let farRadius = FISH_UNITS * 3;
  let farTarget = Vector3.Zero();
  let fishHover = new Vector3(0, FISH_UNITS * 0.75, 0);

  const enterStage = (): void => {
    if (onStage) return;
    onStage = true;
    savedCam = { target: camera.target.clone(), alpha: camera.alpha, beta: camera.beta, radius: camera.radius };
    savedFog = { start: scene.fogStart, end: scene.fogEnd };
    scene.fogStart = 150;
    scene.fogEnd = 400;
    stage.setEnabled(true);
  };

  /** Build the fish, its references and its effects on the stage. */
  const buildDisplay = (req: RevealRequest, revealMode: boolean): void => {
    const f = req.fish;
    fishModel = createFishModel(scene, f.speciesId, f.mutations);
    fishModel.root.parent = stage;

    denseShown = isDense(f.mutations);
    if (revealMode && dense) {
      dock = buildDock();
      catcher = createFisherSprite(scene, avatarFor(req.userId), "stand", new Vector3(), 0);
      fishModel.root.scaling.setAll(DENSE_SPECK);
      fishUnits = DENSE_SPECK;
      auraPower = 0;
      attachEffects(f, DENSE_AURA);
      return;
    }
    auraPower = 1;

    // Units per metre: the bigger of the fish and a person fills FISH_UNITS, so small fish look small.
    const length = fishLengthMeters(f.weightLog10, f.mutations);
    const k = FISH_UNITS / Math.max(length, HUMAN_M);
    // A density mutant (2 cm) is shown enlarged, with a label saying so.
    fishUnits = denseShown ? EXHIBIT_DENSE_HERO : length * k;
    // The owner always stands beside their fish; other references only when they help.
    const others = REFERENCES.filter((r) => r.key !== "human" && r.size >= length / 60 && r.size <= length * 2.5);
    const chosen = [REFERENCES[0], ...others];
    // Dense fish are specks, but their cosmic effect needs room before the owner stands.
    const reach = denseShown ? EXHIBIT_DENSE_AURA * 1.9 : fishUnits * 0.6;
    let x = reach + 0.15;
    let tallest = Math.max(fishUnits * 1.2, HUMAN_M * k);
    const humanH = HUMAN_M * k;
    refs = chosen.map((r, i) => {
      const height = r.size * k;
      const gap = Math.max(0.2, height * 0.25);
      const width = r.key === "moon" || r.key === "earth" ? height : r.key === "human" ? height * 0.6 : height * 0.9;
      const node = buildRef(r.key);
      x += gap + width / 2;
      node.position.set(x, r.key === "human" ? humanH * 0.08 : 0, 0);
      x += width / 2;
      tallest = Math.max(tallest, height);
      let sprite: FisherSprite | null = null;
      if (r.key === "human") {
        sprite = createFisherSprite(scene, avatarFor(req.userId), "stand", new Vector3(), 0);
        // A small wooden platform so the owner isn't standing on water.
        platform = CreateBox("ownerPlatform", { width: 1.3, height: 0.16, depth: 1.1 }, scene);
        platform.parent = stage;
        platform.material = lowPolyMat(scene, "#9A6A42");
      }
      const appearAt = revealMode ? RISE_END + ((i + 0.6) / (chosen.length + 0.6)) * (DOLLY_END - RISE_END) : 0;
      return { key: r.key, node, sprite, height, appearAt, scale: revealMode ? 0 : 1 };
    });
    // Small fish are held up at chest height beside the owner; big ones hang above the water.
    fishHover = fishUnits < humanH ? new Vector3(0, humanH * 0.62, 0) : new Vector3(0, fishUnits * 0.7, 0);
    const left = -reach - 0.15;
    const width = x - left;
    const centerX = (left + x) / 2;
    const horizontalPerUnit = 2 * Math.tan(camera.fov / 2) * (9 / 16);
    farRadius = Math.max((width * 1.3) / horizontalPerUnit, (tallest * 1.6) / (2 * Math.tan(camera.fov / 2)), 3);
    if (denseShown) farRadius *= 0.85; // the cosmic effect may spill past the frame; keep the fish big
    farTarget = new Vector3(centerX, Math.max(tallest, fishHover.y + fishUnits * 0.3) * 0.5, 0);
    closeRadius = Math.max(fishUnits * 1.9, 1.2);
    attachEffects(f, EXHIBIT_DENSE_AURA);
  };

  /** `denseSize`: the cosmic effect's size for density mutants (they are specks at true scale). */
  const attachEffects = (f: RevealFish, denseSize: number): void => {
    if (!fishModel) return;
    const finish = finishFor(f.mutations);
    const auraSize = isDense(f.mutations) ? denseSize : fishUnits;
    aura = createAura(scene, fishAnchor, auraSize, f.rarity, finish);
    // Only self-lit finishes glow as a whole; on metal or scales the glow would wash out the detail
    // (and the naga's heads, crowns and crest are too detailed to glow at all).
    // Density mutants have their own rim light instead.
    const selfLit = finish === "lava" && f.speciesId !== "nagaFish";
    const lit = [...(selfLit ? fishModel.meshes : []), ...aura.glowMeshes];
    for (const m of lit) glow.addIncludedOnlyMesh(m as Mesh);
    glow.isEnabled = lit.length > 0;
  };

  const clearDisplay = (): void => {
    if (fishModel) for (const m of fishModel.meshes) glow.removeIncludedOnlyMesh(m);
    if (aura) for (const m of aura.glowMeshes) glow.removeIncludedOnlyMesh(m as Mesh);
    glow.isEnabled = false;
    aura?.dispose();
    aura = null;
    fishModel?.dispose();
    fishModel = null;
    for (const r of refs) {
      r.sprite?.dispose();
      r.node.dispose();
    }
    refs = [];
    platform?.dispose();
    platform = null;
    catcher?.dispose();
    catcher = null;
    dock?.node.dispose();
    dock = null;
    stopSplash?.();
    stopSplash = null;
  };

  const leaveStage = (): void => {
    clearDisplay();
    if (!onStage) return;
    onStage = false;
    stage.setEnabled(false);
    scene.fogStart = savedFog.start;
    scene.fogEnd = savedFog.end;
    camera.target.copyFrom(savedCam.target);
    camera.alpha = savedCam.alpha;
    camera.beta = savedCam.beta;
    camera.radius = savedCam.radius;
  };

  const finish = (): void => {
    leaveStage();
    playing = false;
    request = null;
    const cb = done;
    done = null;
    cb?.();
  };

  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
  const world = (local: Vector3) => local.add(STAGE);

  const splash = (at: Vector3, age: number, size: number): void => {
    ring.setEnabled(age >= 0 && age < 1.2);
    drops.forEach((d) => d.setEnabled(age >= 0 && age < 1.1));
    if (age < 0 || age >= 1.2) return;
    ring.position.set(at.x, 0.05, at.z);
    ring.scaling.setAll(size * (0.4 + age * 1.6));
    ring.visibility = 1 - age / 1.2;
    drops.forEach((d, i) => {
      const a = (i / drops.length) * Math.PI * 2 + hash01(i) * 0.4;
      const v = size * (1.2 + hash01(i + 5) * 1.4);
      d.position.set(at.x + Math.cos(a) * v * age * 0.6, size * (v * 0.9 * age - 2.2 * age * age), at.z + Math.sin(a) * v * age * 0.6);
      d.scaling.setAll(size * 0.6);
    });
  };

  /** Place references (and the owner on their platform) at their current pop-in scale. */
  const placeRefs = (time: number): void => {
    for (const r of refs) {
      r.node.scaling.setAll(Math.max(0.0001, r.height * r.scale));
      if (r.sprite) {
        // Sprites are authored in metres (~1.8 m tall figure); scale to the reference's height.
        const k = r.height / 1.8;
        r.sprite.setScale(Math.max(0.0001, k * r.scale));
        r.sprite.update(camera, time);
        r.sprite.plane.position.copyFrom(world(r.node.position).add(new Vector3(0, 0.95 * k * r.scale, 0)));
        if (platform) {
          platform.position.set(r.node.position.x, r.node.position.y - 0.08 * k * r.scale, 0);
          platform.scaling.setAll(Math.max(0.0001, k * r.scale));
        }
      }
    }
  };

  /** Keep the anchor (effects) on the fish and animate it. */
  const animateFish = (time: number): void => {
    if (!fishModel) return;
    fishModel.update(time, time * 6);
    fishAnchor.position.copyFrom(fishModel.root.position);
    aura?.update(time, auraPower);
  };

  return {
    active: () => playing,
    ownsCamera: () => onStage,
    exhibiting: () => exhibitOn,
    stageOf: () =>
      !playing ? null
      : t < FLASH_AT ? "hook"
      : dense ? (t < DENSE_IMPLODE_END ? "stage" : t < DENSE_IMPACT ? "drop" : "info")
      : t < DOLLY_END ? "stage"
      : "info",

    play(req, hookOn, onDone) {
      if (exhibitOn) return; // the summary has the stage
      if (playing) finish();
      playing = true;
      t = 0;
      splashed = false;
      request = req;
      done = onDone;
      dense = isDense(req.fish.mutations);
      hookOn(req.userId);
    },

    exhibit(req) {
      if (playing) finish();
      clearDisplay();
      if (!req) {
        exhibitOn = false;
        leaveStage();
        return;
      }
      const cut = !exhibitOn; // first fish: cut straight to its framing (under the white flash)
      exhibitOn = true;
      dense = false;
      enterStage();
      buildDisplay(req, false);
      if (cut) {
        camera.target.copyFrom(world(farTarget));
        camera.radius = farRadius;
        camera.alpha = Math.PI / 2;
        camera.beta = EXHIBIT_BETA;
      }
    },

    abort() {
      if (playing) finish();
    },

    update(dt) {
      clock += dt;
      if (exhibitOn && fishModel) {
        // Exhibit: the fish hangs at true scale beside its owner; the camera drifts around it.
        fishModel.root.position.copyFrom(fishHover);
        fishModel.root.scaling.setAll(fishUnits);
        fishModel.root.rotation.y = Math.PI + Math.sin(clock * 0.6) * 0.3;
        fishModel.root.rotation.z = Math.sin(clock * 1.1) * 0.06;
        animateFish(clock);
        placeRefs(clock);
        const k = 1 - Math.exp(-dt * 2.5); // ease towards each new framing
        Vector3.LerpToRef(camera.target, world(farTarget), k, camera.target);
        camera.radius += (farRadius - camera.radius) * k;
        camera.alpha = Math.PI / 2 + Math.sin(clock * 0.25) * 0.35;
        camera.beta += (EXHIBIT_BETA - camera.beta) * k;
        return;
      }
      if (!playing || !request) return;
      t += dt;
      if (t >= FLASH_AT && !onStage) {
        enterStage();
        buildDisplay(request, true);
      }
      if (t >= (dense ? DENSE_END : END)) {
        finish();
        return;
      }
      if (!onStage || !fishModel) return;
      const time = t;

      if (dense) {
        // The cosmic power builds around the hovering speck, holds, and implodes back into it…
        // then the tiny fish drops onto the dock, and the dock snaps.
        const since = t - FLASH_AT;
        auraPower =
          t < DENSE_BUILD_END ? ease(since / (DENSE_BUILD_END - FLASH_AT))
          : t < DENSE_HOLD_END ? 1
          : 1 - ease((t - DENSE_HOLD_END) / (DENSE_IMPLODE_END - DENSE_HOLD_END));
        const broke = t >= DENSE_IMPACT;
        const after = t - DENSE_IMPACT;
        const fall = ease((t - DENSE_FALL_AT) / (DENSE_IMPACT - DENSE_FALL_AT));
        const hover = DENSE_HOVER_Y + Math.sin(time * 2) * 0.05;
        const fishY = broke ? Math.max(-0.5, 0.95 - after * after * 6) : hover - (hover - 0.95) * fall * fall;
        fishModel.root.position.set(0, fishY, 0.1);
        // The fish is the star of its own effect, then shrinks back to what it really is.
        fishModel.root.scaling.setAll(DENSE_SPECK + (DENSE_HERO - DENSE_SPECK) * auraPower);
        fishModel.root.rotation.y = Math.PI + Math.sin(time * 0.9) * 0.45;
        fishModel.root.rotation.z = Math.sin(time * 1.4) * 0.08;
        animateFish(time);
        if (dock) {
          const snap = broke ? Math.min(1, after * 2.5) : 0;
          dock.left.rotation.z = -0.9 * snap;
          dock.right.rotation.z = 0.9 * snap;
          dock.left.position.y = -0.4 * snap;
          dock.right.position.y = -0.4 * snap;
        }
        catcher?.plane.position.set(STAGE.x + 1.1, STAGE.y + 0.9 + 0.95 - (broke ? Math.min(1, after * 2) * 0.8 : 0), STAGE.z + 0.25);
        catcher?.update(camera, time);
        splash(new Vector3(0, 0, 0.1), broke ? after - 0.15 : -1, 1.2);
        if (broke && !splashed) {
          splashed = true;
          stopSplash = splashBurst(scene, world(new Vector3(0, 0, 0.1)), 1.2);
        }

        const fishAt = world(new Vector3(0, fishY, 0.1));
        const dockAt = world(new Vector3(0.3, 1.2, 0));
        let shake = 0;
        if (t < DENSE_IMPLODE_END) {
          // From a macro shot of the speck, pull back as the power grows to take it all in.
          const grow = Math.min(auraPower, ease(since / (DENSE_BUILD_END + 1 - FLASH_AT)));
          camera.target.copyFrom(fishAt);
          camera.radius = 2 + (DENSE_AURA * 7 - 2) * grow;
          camera.alpha = Math.PI / 2 + 0.25 + since * 0.1;
          camera.beta = 1.4 - 0.1 * grow;
          shake = auraPower * 0.01;
        } else {
          // Imploded: a close look at what is left — a 2 cm fish — then follow it down to the dock.
          const k = ease((t - DENSE_FALL_AT) / (DENSE_IMPACT - DENSE_FALL_AT + 0.3));
          Vector3.LerpToRef(fishAt, dockAt, k, camera.target);
          camera.radius = 1.6 + (5.5 - 1.6) * k;
          camera.alpha = Math.PI / 2 + 0.35;
          camera.beta = 1.36 - 0.04 * k;
          if (broke && after < 0.7) shake = (0.7 - after) * 0.06;
        }
        camera.alpha += Math.sin(time * 61) * shake;
        camera.beta += Math.sin(time * 47 + 1) * shake;
        return;
      }

      // Rise: the fish bursts out of the water and hangs there, turning slowly.
      const rise = ease((t - FLASH_AT - 0.15) / (RISE_END - FLASH_AT - 0.3));
      const depth = fishUnits * 0.6 + 0.3;
      fishModel.root.position.set(fishHover.x, -depth + (fishHover.y + depth) * easeOutBack(rise), fishHover.z);
      fishModel.root.scaling.setAll(fishUnits);
      fishModel.root.rotation.y = Math.PI + Math.sin(time * 0.8) * 0.35;
      fishModel.root.rotation.z = 0.25 * (1 - rise) + Math.sin(time * 1.3) * 0.05;
      animateFish(time);
      splash(new Vector3(0, 0, 0), t - FLASH_AT - 0.2, Math.max(fishUnits, 0.6) * 0.5);
      if (!splashed && t >= FLASH_AT + 0.2) {
        splashed = true;
        stopSplash = splashBurst(scene, world(Vector3.Zero()), Math.max(fishUnits, 0.6));
      }

      // Scale references pop in while the camera dollies back.
      for (const r of refs) {
        const s = Math.max(0, Math.min(1, (t - r.appearAt) / 0.45));
        r.scale = s > 0 ? easeOutBack(s) : 0;
      }
      placeRefs(time);

      const dolly = ease((t - RISE_END) / (DOLLY_END - RISE_END));
      const radius = closeRadius * Math.pow(farRadius / closeRadius, dolly);
      Vector3.LerpToRef(world(fishHover), world(farTarget), dolly, camera.target);
      camera.alpha = Math.PI / 2 - 0.12 + dolly * 0.2;
      camera.beta = 1.5 - dolly * 0.12;
      camera.radius = radius;
    },

    labels(cssScale) {
      if (!onStage) return [];
      const engine = scene.getEngine();
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const viewport = camera.viewport.toGlobal(w, h);
      const transform = scene.getTransformMatrix();
      const label = (key: string, at: Vector3, visible: boolean): RevealLabel => {
        const p = Vector3.Project(at, Matrix.IdentityReadOnly, transform, viewport);
        return { key, x: p.x * cssScale, y: p.y * cssScale, visible: visible && p.z > 0 && p.z < 1 };
      };
      // A density mutant is a speck: point at it, so viewers know what they are looking at.
      const tiny =
        denseShown && fishModel
          ? [
              label(
                playing ? "tinyFish" : "tinyFishZoom",
                world(fishModel.root.position).add(new Vector3(0, fishModel.root.scaling.y * 0.35 + 0.08, 0)),
                !playing || t < DENSE_FALL_AT + 0.2,
              ),
            ]
          : [];
      if (playing && dense) return t >= DENSE_IMPLODE_END ? tiny : [];
      return [...refs.map((r) => label(r.key, world(r.node.position).add(new Vector3(0, (r.key === "human" ? r.height * 1.12 : r.height) * r.scale + 0.05, 0)), r.scale > 0.6)), ...tiny];
    },
  };
}
