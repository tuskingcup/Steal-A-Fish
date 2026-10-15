import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { avatarKey, type Avatar } from "@saf/core";

/**
 * HD-2D fisher: a pixel-art billboard that looks right from every side.
 *
 * Instead of hand-drawing each view, a character is described as a small set of signed-distance
 * shapes built from its Avatar (local space: +z faces the water, origin = seat on the dock edge)
 * and baked into a 48×56 toon-shaded, outlined pixel frame per view direction. Baking is CPU work
 * (a few ms per frame), so it runs from a time-budgeted queue (`pumpSpriteBakes`): the direction
 * the camera needs right now goes first, the rest warm up in the background, and until a frame
 * is ready the billboard shows the nearest finished direction. Frames are cached per look, so
 * viewers who share a look share textures.
 */

const FRAME_W = 48;
const FRAME_H = 56;
/** World metres per sprite pixel. */
export const SPRITE_PX = 0.035;
const DIRECTIONS = 16;
/**
 * Characters are (near enough) left/right symmetric, so directions past half way are drawn as
 * mirror images of directions 0…8: only 9 of the 16 need baking.
 */
const BAKED_DIRS = DIRECTIONS / 2 + 1;
const POSES = 2;
/** Bake with a slight downward look so hat brims read; the billboard itself stays vertical. */
const BAKE_PITCH = 0.17;

type V3 = readonly [number, number, number];
type Rgb = [number, number, number];

export type Stance = "sit" | "stand";

/** Standing lifts the upper body by the leg length; sitting origin is the seat, standing origin the feet. */
const STAND_LIFT = 0.78;

export interface StanceGeometry {
  /**
   * Billboard centre, fisher-local. For sitting it sits just past the dock edge (local z 0.2) so
   * dangling legs aren't hidden by the dock from the front; for both stances it is just in front
   * of the hands so the 3D rod is hidden behind the body when seen from behind.
   */
  planeCenter: V3;
  /** Where the hands grip the rod. The 3D rod starts here. */
  hand: V3;
  /** Above the hat, for the name tag. */
  headTop: V3;
  /** Where the champion's crown floats. */
  crown: V3;
}

/** Fisher-local box that holds every shape of a stance (any avatar); rays outside it are skipped. */
const STANCE_BOUNDS: Record<Stance, { min: V3; max: V3 }> = {
  sit: { min: [-0.45, -0.48, -0.42], max: [0.45, 1.12, 0.66] },
  stand: { min: [-0.45, -0.02, -0.42], max: [0.45, 1.9, 0.66] },
};

export const STANCES: Record<Stance, StanceGeometry> = {
  // Hands on the centre line keep the character left/right symmetric, so mirrored frames line up with the rod.
  sit: { planeCenter: [0, 0.25, 0.25], hand: [0, 0.36, 0.3], headTop: [0, 1.18, 0.05], crown: [0, 1.32, 0.05] },
  stand: {
    planeCenter: [0, 0.95, 0.25],
    hand: [0, 0.36 + STAND_LIFT, 0.3],
    headTop: [0, 1.18 + STAND_LIFT, 0.05],
    crown: [0, 1.32 + STAND_LIFT, 0.05],
  },
};

const OUTLINE = hexRgb("#1E1424");
const STRAW = "#E8C273";

type SdfFn = (x: number, y: number, z: number) => number;
/** Bounding sphere: centre x, y, z and radius. */
type Bound = [number, number, number, number];

interface Shape {
  sdf: SdfFn;
  bound: Bound;
}

interface Prim {
  sdf: SdfFn;
  bound: Bound;
  color: (x: number, y: number, z: number) => Rgb;
  /** Prims in the same group don't draw inner outlines against each other. */
  group: number;
}

export interface FisherSprite {
  plane: Mesh;
  /** Uniform scale for pop-in/out (the sprite handles its own mirroring). */
  setScale(s: number): void;
  /** Move with the spot (boats rock). */
  setBase(pos: Vector3): void;
  update(camera: Camera, timeSec: number): void;
  dispose(): void;
}

// ---------- Bake queue ----------

interface BakeTask {
  id: string;
  run(): void;
  /** False once nobody with this look is on screen; queued background work is then dropped. */
  wanted(): boolean;
}

interface BakeQueue {
  urgent: BakeTask[];
  background: BakeTask[];
  queued: Set<string>;
}

const frameCache = new WeakMap<Scene, Map<string, (DynamicTexture | undefined)[]>>();
const bakeQueues = new WeakMap<Scene, BakeQueue>();
/** How many live sprites use each look, per scene. */
const lookUsers = new WeakMap<Scene, Map<string, number>>();

function queueFor(scene: Scene): BakeQueue {
  let q = bakeQueues.get(scene);
  if (!q) bakeQueues.set(scene, (q = { urgent: [], background: [], queued: new Set() }));
  return q;
}

function enqueue(scene: Scene, task: BakeTask, urgent: boolean): void {
  const q = queueFor(scene);
  if (q.queued.has(task.id)) {
    if (!urgent) return;
    // Promote: drop the background copy so it isn't baked twice.
    const i = q.background.findIndex((t) => t.id === task.id);
    if (i < 0) return;
    q.background.splice(i, 1);
  }
  q.queued.add(task.id);
  (urgent ? q.urgent : q.background).push(task);
}

/**
 * Bake queued sprite frames for up to `budgetMs` this frame (always at least one urgent frame,
 * so new fishers appear). Call once per rendered frame.
 */
export function pumpSpriteBakes(scene: Scene, budgetMs: number): void {
  const q = queueFor(scene);
  const start = performance.now();
  let first = true;
  while (q.urgent.length > 0 || q.background.length > 0) {
    if (!first && performance.now() - start > budgetMs) return;
    const task = (q.urgent.length > 0 ? q.urgent : q.background).shift()!;
    q.queued.delete(task.id);
    if (!task.wanted()) continue;
    task.run();
    first = false;
  }
}

/**
 * @param seat  world position of the seat (dock edge)
 * @param yaw   facing: 0 = +z, π/2 = +x
 */
export function createFisherSprite(scene: Scene, avatar: Avatar, stance: Stance, seat: Vector3, yaw: number, phase = 0): FisherSprite {
  const geo = STANCES[stance];
  let perScene = frameCache.get(scene);
  if (!perScene) frameCache.set(scene, (perScene = new Map()));
  const key = `${stance}|${avatarKey(avatar)}`;
  let frames = perScene.get(key);
  if (!frames) perScene.set(key, (frames = new Array<DynamicTexture | undefined>(POSES * DIRECTIONS)));
  const cached = frames;
  let users = lookUsers.get(scene);
  if (!users) lookUsers.set(scene, (users = new Map()));
  const lookCount = users;
  lookCount.set(key, (lookCount.get(key) ?? 0) + 1);

  let poses: Prim[][] | null = null;
  const task = (i: number): BakeTask => ({
    id: `${key}#${i}`,
    wanted: () => cached[i] === undefined && (lookCount.get(key) ?? 0) > 0,
    run: () => {
      poses ??= Array.from({ length: POSES }, (_, p) => buildPrims(avatar, p, stance));
      const dir = i % DIRECTIONS;
      cached[i] = bakeFrame(scene, poses[Math.floor(i / DIRECTIONS)]!, geo.planeCenter, STANCE_BOUNDS[stance], (dir / DIRECTIONS) * Math.PI * 2, `fisher_${key}_${i}`);
    },
  });
  // Warm every direction in the background; whatever the camera needs is promoted when asked for.
  for (let pose = 0; pose < POSES; pose++)
    for (let dir = 0; dir < BAKED_DIRS; dir++) if (!cached[pose * DIRECTIONS + dir]) enqueue(scene, task(pose * DIRECTIONS + dir), false);

  /** The wanted (baked) direction if ready, else the nearest ready one, same pose first. */
  const frame = (pose: number, dir: number): DynamicTexture | undefined => {
    const i = pose * DIRECTIONS + dir;
    if (cached[i]) return cached[i];
    enqueue(scene, task(i), true);
    for (let off = 1; off < BAKED_DIRS; off++) {
      for (const p of [pose, 1 - pose]) {
        for (const near of [dir - off, dir + off]) {
          if (near < 0 || near >= BAKED_DIRS) continue;
          const tex = cached[p * DIRECTIONS + near];
          if (tex) return tex;
        }
      }
    }
    return cached[(1 - pose) * DIRECTIONS + dir];
  };

  const plane = CreatePlane("fisher", { width: FRAME_W * SPRITE_PX, height: FRAME_H * SPRITE_PX }, scene);
  const offset = rotateY(geo.planeCenter, yaw);
  plane.position = seat.add(offset);
  plane.billboardMode = Mesh.BILLBOARDMODE_Y;

  // Lighting is baked into the pixels, so the sprite is unlit; otherwise its brightness would
  // change as the billboard turns with the camera.
  const mat = new StandardMaterial("fisherMat", scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = new Color3(0.97, 0.95, 0.92);
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.5;
  mat.backFaceCulling = false;
  plane.material = mat;

  let current: DynamicTexture | null = null;
  let mirror = false;
  let scale = 1;
  plane.isVisible = false;
  return {
    plane,
    setScale(s) {
      scale = s;
    },
    setBase(pos) {
      pos.addToRef(offset, plane.position);
    },
    update(camera, timeSec) {
      const v = camera.globalPosition.subtract(plane.position);
      const step = (Math.PI * 2) / DIRECTIONS;
      const angle = Math.atan2(v.x, v.z) - yaw;
      const dir = (((Math.round(angle / step)) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
      const pose = Math.floor(timeSec * 1.6 + phase) % POSES;
      mirror = dir >= BAKED_DIRS;
      const tex = frame(pose, mirror ? DIRECTIONS - dir : dir);
      // A negative x scale flips the billboard (back faces are drawn, and the sprite is unlit).
      plane.scaling.set(mirror ? -scale : scale, scale, scale);
      plane.isVisible = tex !== undefined; // first frame still baking
      if (tex && tex !== current) {
        current = tex;
        mat.diffuseTexture = tex;
        mat.emissiveTexture = tex;
      }
    },
    dispose() {
      // Textures stay cached for the next viewer with this look.
      lookCount.set(key, (lookCount.get(key) ?? 1) - 1);
      mat.dispose();
      plane.dispose();
    },
  };
}

/** Rotate a fisher-local point by the seat's yaw (same convention as Babylon's rotation.y). */
export function rotateY(p: V3, yaw: number): Vector3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return new Vector3(p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c);
}

// ---------- Character shapes ----------

function buildPrims(a: Avatar, pose: number, stance: Stance): Prim[] {
  const prims: Prim[] = [];
  const standing = stance === "stand";
  // Upper body is modelled seated; standing lifts it onto straight legs (with a breathing bob).
  const lift = standing ? STAND_LIFT - (pose === 1 ? 0.012 : 0) : 0;
  const hand = STANCES.sit.hand; // upper body is modelled seated, then lifted
  const add = (shape: Shape, color: string | Prim["color"], group: number) =>
    prims.push({ sdf: shape.sdf, bound: shape.bound, color: typeof color === "string" ? solid(color) : color, group });

  const skin = a.skin;
  const cloth = topPattern(a);
  const sleeve = a.top === "tank" ? skin : a.top === "lifeVest" ? a.topAccent : cloth;
  const forearm = a.top === "longSleeve" ? cloth : skin;

  // Seated legs dangle over the edge and swing out of phase; standing legs are straight.
  if (standing) {
    for (const side of [-1, 1]) {
      const hip: V3 = [0.1 * side, 0.86, -0.02];
      const knee: V3 = [0.1 * side, 0.47, 0.01];
      const mid: V3 = [0.1 * side, 0.3, 0.0];
      const ankle: V3 = [0.1 * side, 0.1, -0.01];
      const baggy = a.bottom === "fishermanPants" ? 0.092 : a.bottom === "shorts" ? 0.088 : 0.08;
      const shortsEnd: V3 = [0.1 * side, 0.55, 0.01];
      add(capsule(hip, a.bottom === "shorts" ? shortsEnd : knee, baggy), a.bottomColor, 1);
      if (a.bottom === "shorts") add(capsule(shortsEnd, knee, 0.06), skin, 2);
      add(capsule(knee, mid, a.bottom === "shorts" ? 0.058 : baggy - 0.006), a.bottom === "shorts" ? skin : a.bottomColor, a.bottom === "shorts" ? 2 : 1);
      if (a.shoes === "boots") add(capsule(mid, ankle, 0.072), a.shoeColor, 3);
      else add(capsule(mid, ankle, 0.058), a.bottom === "longPants" ? a.bottomColor : skin, a.bottom === "longPants" ? 1 : 2);
      const foot: V3 = [ankle[0], 0.035, 0.05];
      if (a.shoes === "barefoot") add(roundBox(foot, [0.05, 0.03, 0.09], 0.025), skin, 2);
      else add(roundBox(foot, [0.058, a.shoes === "boots" ? 0.04 : 0.028, 0.1], 0.02), a.shoeColor, 3);
    }
  } else for (const side of [-1, 1]) {
    const swing = (pose === 0 ? 0.08 : -0.08) * side;
    const hip: V3 = [0.1 * side, 0.08, 0];
    const knee: V3 = [0.1 * side, 0.08, 0.36];
    const mid: V3 = [0.1 * side, -0.1, 0.4 + swing * 0.5];
    const ankle: V3 = [0.1 * side, -0.3, 0.42 + swing];
    const baggy = a.bottom === "fishermanPants" ? 0.092 : a.bottom === "shorts" ? 0.088 : 0.08;
    add(capsule(hip, knee, baggy), a.bottomColor, 1);
    add(capsule(knee, mid, a.bottom === "shorts" ? 0.058 : baggy - 0.006), a.bottom === "shorts" ? skin : a.bottomColor, a.bottom === "shorts" ? 2 : 1);
    if (a.shoes === "boots") add(capsule(mid, ankle, 0.072), a.shoeColor, 3);
    else add(capsule(mid, ankle, 0.058), a.bottom === "longPants" ? a.bottomColor : skin, a.bottom === "longPants" ? 1 : 2);
    const foot: V3 = [ankle[0], ankle[1] - 0.05, ankle[2] + 0.05];
    if (a.shoes === "barefoot") add(roundBox(foot, [0.05, 0.03, 0.09], 0.025), skin, 2);
    else add(roundBox(foot, [0.058, a.shoes === "boots" ? 0.04 : 0.028, 0.1], 0.02), a.shoeColor, 3);
  }
  const upperStart = prims.length;
  add(roundBox([0, 0.1, -0.04], [0.18, 0.1, 0.14], 0.06), a.bottomColor, 1);

  // Torso and arms.
  add(roundBox([0, 0.36, -0.02], [0.17, 0.19, 0.11], 0.07), a.top === "lifeVest" ? a.topAccent : cloth, 4);
  if (a.top === "lifeVest") add(roundBox([0, 0.37, -0.02], [0.185, 0.165, 0.128], 0.06), lifeVest(a.topAccent), 4);
  for (const side of [-1, 1]) {
    const shoulder: V3 = [0.2 * side, 0.5, -0.02];
    const elbow: V3 = [0.23 * side, 0.34, 0.13];
    add(capsule(shoulder, elbow, 0.058), sleeve, a.top === "tank" ? 10 : 4);
    add(capsule(elbow, hand, 0.048), forearm, a.top === "longSleeve" ? 4 : 10);
  }
  add(sphere(hand, 0.062), skin, 10);

  // Neck wear.
  if (a.neck === "phaKhaoMa") add(roundBox([0, 0.56, -0.01], [0.15, 0.035, 0.125], 0.03), plaid(a.neckColor), 5);
  if (a.neck === "towel") {
    add(roundBox([0, 0.56, -0.01], [0.155, 0.04, 0.13], 0.035), a.neckColor, 5);
    add(roundBox([0.09, 0.44, 0.1], [0.04, 0.1, 0.02], 0.015), a.neckColor, 5);
  }

  // Head, face, hair.
  add(roundBox([0, 0.74, 0.03], [0.15, 0.14, 0.13], 0.07), skin, 6);
  for (const side of [-1, 1]) {
    const ex = 0.062 * side;
    if (a.eyes === "dot") add(sphere([ex, 0.75, 0.155], 0.03), "#1B1410", 8);
    if (a.eyes === "wide") add(capsule([ex, 0.735, 0.155], [ex, 0.775, 0.155], 0.03), "#1B1410", 8);
    if (a.eyes === "happy") add(capsule([ex - 0.025, 0.75, 0.158], [ex + 0.025, 0.755, 0.158], 0.016), "#1B1410", 8);
    add(sphere([0.112 * side, 0.7, 0.14], 0.026), "#F08C7C", 6);
  }
  if (a.faceExtra === "mustache") add(capsule([-0.05, 0.695, 0.162], [0.05, 0.695, 0.162], 0.02), a.hairColor, 11);
  if (a.faceExtra === "beard") add(roundBox([0, 0.655, 0.07], [0.152, 0.065, 0.1], 0.05), a.hairColor, 11);
  if (a.faceExtra === "sunglasses") add(roundBox([0, 0.755, 0.168], [0.135, 0.032, 0.018], 0.012), "#16161C", 12);
  if (a.faceExtra === "glasses") {
    for (const side of [-1, 1]) add(ringZ([0.062 * side, 0.752, 0.172], 0.04, 0.011), "#2B2B33", 12);
  }

  const hatCoversTop = a.hat !== "none";
  if (a.hairStyle !== "bald") {
    add(roundBox([0, 0.77, -0.03], [0.158, 0.1, 0.12], 0.06), a.hairColor, 7);
    if (!hatCoversTop || a.hat === "bandana") add(roundBox([0, 0.84, 0.0], [0.16, 0.06, 0.142], 0.05), a.hairColor, 7);
    if (a.hairStyle === "long") add(roundBox([0, 0.62, -0.07], [0.165, 0.2, 0.09], 0.06), a.hairColor, 7);
    if (a.hairStyle === "bun") add(sphere([0, a.hat === "none" ? 0.93 : 0.8, -0.16], 0.075), a.hairColor, 7);
    if (a.hairStyle === "spiky" && (a.hat === "none" || a.hat === "bandana")) {
      for (const [x, z] of [[-0.08, 0], [0.08, 0], [0, -0.06], [0, 0.07]] as const)
        add(cappedCone([x, 0.86, z], [x * 1.4, 1.0, z * 1.4 - 0.03], 0.06, 0.01), a.hairColor, 7);
    }
  }

  // Hats.
  switch (a.hat) {
    case "ngob":
      add(cappedCone([0, 0.83, 0.02], [0, 1.03, 0.02], 0.32, 0.025), STRAW, 9);
      break;
    case "cap":
      add(intersect(sphere([0, 0.82, 0.02], 0.168), (_x, y) => 0.83 - y), a.hatColor, 9);
      add(roundBox([0, 0.84, 0.19], [0.12, 0.012, 0.075], 0.01), a.hatColor, 9);
      break;
    case "bucket":
      add(cappedCone([0, 0.82, 0.02], [0, 0.97, 0.02], 0.19, 0.16), a.hatColor, 9);
      add(cappedCone([0, 0.8, 0.02], [0, 0.83, 0.02], 0.26, 0.23), a.hatColor, 9);
      break;
    case "strawWide": {
      const band = (x: number, y: number, z: number): Rgb => (y < 0.87 && y > 0.83 ? hexRgb(a.hatColor) : solid(STRAW)(x, y, z));
      add(cappedCone([0, 0.83, 0.02], [0, 0.98, 0.02], 0.17, 0.15), band, 9);
      add(cappedCone([0, 0.815, 0.02], [0, 0.835, 0.02], 0.4, 0.37), STRAW, 9);
      break;
    }
    case "bandana":
      add(roundBox([0, 0.83, 0.0], [0.166, 0.075, 0.148], 0.06), dots(a.hatColor, "#F4F1E8"), 9);
      add(sphere([0, 0.8, -0.17], 0.045), a.hatColor, 9);
      break;
    case "none":
      break;
  }
  if (lift !== 0) {
    for (let i = upperStart; i < prims.length; i++) {
      const { sdf, color, bound } = prims[i]!;
      prims[i] = {
        ...prims[i]!,
        sdf: (x, y, z) => sdf(x, y - lift, z),
        color: (x, y, z) => color(x, y - lift, z),
        bound: [bound[0], bound[1] + lift, bound[2], bound[3]],
      };
    }
  }
  return prims;
}

// ---------- Cloth patterns (fisher-local coordinates) ----------

function topPattern(a: Avatar): Prim["color"] {
  const base = hexRgb(a.topColor);
  const accent = hexRgb(a.topAccent);
  if (a.top === "striped") return (_x, y) => (Math.floor(y / 0.06) % 2 === 0 ? base : accent);
  if (a.top === "hawaiian") return (x, y, z) => (cellHash(x, y, z, 0.055) > 0.7 ? accent : base);
  return () => base;
}

function lifeVest(shirt: string): Prim["color"] {
  const orange = hexRgb("#F28C28");
  const reflect = hexRgb("#F2F2E8");
  const under = hexRgb(shirt);
  return (x, y, z) => (z > 0.05 && Math.abs(x) < 0.04 ? under : Math.abs(y - 0.3) < 0.02 ? reflect : orange);
}

function plaid(color: string): Prim["color"] {
  const c = hexRgb(color);
  const white = hexRgb("#F1ECE0");
  const mid: Rgb = [(c[0] + white[0]) / 2, (c[1] + white[1]) / 2, (c[2] + white[2]) / 2];
  return (x, _y, z) => {
    const a = Math.floor((x + z) / 0.05) % 2 === 0;
    const b = Math.floor((x - z) / 0.05) % 2 === 0;
    return a && b ? c : a || b ? mid : white;
  };
}

function dots(color: string, dot: string): Prim["color"] {
  const c = hexRgb(color);
  const d = hexRgb(dot);
  return (x, y, z) => (cellHash(x, y, z, 0.05) > 0.78 ? d : c);
}

function cellHash(x: number, y: number, z: number, size: number): number {
  const n = Math.floor(x / size) * 73.1 + Math.floor(y / size) * 157.3 + Math.floor(z / size) * 311.7;
  const h = Math.sin(n) * 43758.5453;
  return h - Math.floor(h);
}

// ---------- Baker ----------

function bakeFrame(scene: Scene, prims: Prim[], center: V3, bounds: { min: V3; max: V3 }, azimuth: number, name: string): DynamicTexture {
  // Camera sits at `azimuth` around the fisher (0 = in front, seeing the face), looking slightly down.
  const cp = Math.cos(BAKE_PITCH);
  const toCam = [Math.sin(azimuth) * cp, Math.sin(BAKE_PITCH), Math.cos(azimuth) * cp];
  const d = [-toCam[0]!, -toCam[1]!, -toCam[2]!];
  // Screen right = up × d, screen up = d × right (left-handed, matches Babylon's billboard).
  const r = normalize([d[2]!, 0, -d[0]!]);
  const u = cross(d, r);

  const W = FRAME_W;
  const H = FRAME_H;
  const depth = new Float32Array(W * H).fill(Infinity);
  const prim = new Int16Array(W * H).fill(-1);
  const rgb = new Float32Array(W * H * 3);

  // Only shapes whose bounding sphere the current ray passes through are evaluated.
  const active = new Int16Array(prims.length);
  let activeCount = 0;
  // Distance to the nearest active shape; its index is left in `hitIdx` (no allocation per call).
  let hitIdx = -1;
  const sceneSdf = (x: number, y: number, z: number): number => {
    let best = Infinity;
    for (let a = 0; a < activeCount; a++) {
      const i = active[a]!;
      const v = prims[i]!.sdf(x, y, z);
      if (v < best) {
        best = v;
        hitIdx = i;
      }
    }
    return best;
  };

  const light = normalize([0.45, 0.85, 0.55]); // towards the sun, fisher-local

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const sx = (i + 0.5 - W / 2) * SPRITE_PX;
      const sy = (H / 2 - (j + 0.5)) * SPRITE_PX;
      const ox = center[0] + r[0]! * sx + u[0]! * sy - d[0]! * 2;
      const oy = center[1] + r[1]! * sx + u[1]! * sy - d[1]! * 2;
      const oz = center[2] + r[2]! * sx + u[2]! * sy - d[2]! * 2;

      // Clip the ray to the stance's bounding box: most pixels miss it entirely.
      let tNear = 0;
      let tFar = 4;
      const o = [ox, oy, oz];
      for (let a = 0; a < 3 && tNear <= tFar; a++) {
        const da = d[a]!;
        if (Math.abs(da) < 1e-6) {
          if (o[a]! < bounds.min[a]! || o[a]! > bounds.max[a]!) tFar = -1;
          continue;
        }
        let t0 = (bounds.min[a]! - o[a]!) / da;
        let t1 = (bounds.max[a]! - o[a]!) / da;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tNear = Math.max(tNear, t0);
        tFar = Math.min(tFar, t1);
      }
      if (tNear > tFar) continue;

      activeCount = 0;
      for (let i = 0; i < prims.length; i++) {
        const [cx, cy, cz, cr] = prims[i]!.bound;
        const wx = cx - ox, wy = cy - oy, wz = cz - oz;
        const along = wx * d[0]! + wy * d[1]! + wz * d[2]!;
        const ex = wx - along * d[0]!, ey = wy - along * d[1]!, ez = wz - along * d[2]!;
        const reach = cr + 0.01;
        if (ex * ex + ey * ey + ez * ez <= reach * reach) active[activeCount++] = i;
      }
      if (activeCount === 0) continue;

      let t = tNear;
      for (let step = 0; step < 64 && t <= tFar; step++) {
        const px = ox + d[0]! * t;
        const py = oy + d[1]! * t;
        const pz = oz + d[2]! * t;
        const dist = sceneSdf(px, py, pz);
        const idx = hitIdx;
        if (dist < 0.0015) {
          const k = j * W + i;
          depth[k] = t;
          prim[k] = idx;
          const e = 0.004;
          const n = normalize([
            sceneSdf(px + e, py, pz) - sceneSdf(px - e, py, pz),
            sceneSdf(px, py + e, pz) - sceneSdf(px, py - e, pz),
            sceneSdf(px, py, pz + e) - sceneSdf(px, py, pz - e),
          ]);
          const ndl = n[0]! * light[0]! + n[1]! * light[1]! + n[2]! * light[2]!;
          // Three-step toon ramp with cool shadows, the usual pixel-art shading.
          const tone = ndl > 0.45 ? [1.04, 1.02, 0.98] : ndl > -0.05 ? [0.86, 0.86, 0.9] : [0.64, 0.66, 0.8];
          const base = prims[idx]!.color(px, py, pz);
          for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.min(1, base[c]! * tone[c]!);
          break;
        }
        t += Math.max(dist, 0.002);
      }
    }
  }

  const tex = new DynamicTexture(name, { width: W, height: H }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && prim[y * W + x]! >= 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const o = k * 4;
      if (prim[k]! < 0) {
        // Outer outline: empty pixel touching the silhouette.
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          img.data[o] = OUTLINE[0] * 255;
          img.data[o + 1] = OUTLINE[1] * 255;
          img.data[o + 2] = OUTLINE[2] * 255;
          img.data[o + 3] = 255;
        }
        continue;
      }
      // Inner lines where a different part sits clearly in front (arm over body, hat over face).
      let edge = false;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (!filled(nx, ny)) continue;
        const nk = ny * W + nx;
        if (prims[prim[nk]!]!.group !== prims[prim[k]!]!.group && depth[k]! - depth[nk]! > 0.06) edge = true;
      }
      const f = edge ? 0.55 : 1;
      img.data[o] = rgb[k * 3]! * f * 255;
      img.data[o + 1] = rgb[k * 3 + 1]! * f * 255;
      img.data[o + 2] = rgb[k * 3 + 2]! * f * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  return tex;
}

// ---------- SDF helpers (Inigo Quilez) ----------

const mid = (a: V3, b: V3): [number, number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const halfLen = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;

function sphere(c: V3, rad: number): Shape {
  return { sdf: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - rad, bound: [c[0], c[1], c[2], rad] };
}

function capsule(a: V3, b: V3, rad: number): Shape {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  return {
    sdf: (x, y, z) => {
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / baba));
      return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - rad;
    },
    bound: [...mid(a, b), halfLen(a, b) + rad],
  };
}

function roundBox(c: V3, half: V3, rad: number): Shape {
  return {
    sdf: (x, y, z) => {
      const qx = Math.abs(x - c[0]) - half[0] + rad;
      const qy = Math.abs(y - c[1]) - half[1] + rad;
      const qz = Math.abs(z - c[2]) - half[2] + rad;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
    },
    bound: [c[0], c[1], c[2], Math.hypot(half[0], half[1], half[2])],
  };
}

/** Ring facing +z (glasses rims). */
function ringZ(c: V3, rad: number, thickness: number): Shape {
  return {
    sdf: (x, y, z) => {
      const q = Math.hypot(x - c[0], y - c[1]) - rad;
      return Math.hypot(q, z - c[2]) - thickness;
    },
    bound: [c[0], c[1], c[2], rad + thickness],
  };
}

/** `a` cut by another distance function (bounded by `a`). */
function intersect(a: Shape, b: SdfFn): Shape {
  return { sdf: (x, y, z) => Math.max(a.sdf(x, y, z), b(x, y, z)), bound: a.bound };
}

function cappedCone(a: V3, b: V3, ra: number, rb: number): Shape {
  const rba = rb - ra;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  return {
    sdf: (x, y, z) => {
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const papa = pax * pax + pay * pay + paz * paz;
      const paba = (pax * bax + pay * bay + paz * baz) / baba;
      const px = Math.sqrt(Math.max(0, papa - paba * paba * baba));
      const cax = Math.max(0, px - (paba < 0.5 ? ra : rb));
      const cay = Math.abs(paba - 0.5) - 0.5;
      const k = rba * rba + baba;
      const f = Math.min(1, Math.max(0, (rba * (px - ra) + paba * baba) / k));
      const cbx = px - ra - f * rba;
      const cby = paba - f;
      const sgn = cbx < 0 && cay < 0 ? -1 : 1;
      return sgn * Math.sqrt(Math.min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba));
    },
    bound: [...mid(a, b), Math.hypot(halfLen(a, b), Math.max(ra, rb))],
  };
}

function solid(hex: string): Prim["color"] {
  const c = hexRgb(hex);
  return () => c;
}

function normalize(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
