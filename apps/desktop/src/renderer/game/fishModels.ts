import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { MutationId } from "@saf/core";
import { hash01 } from "./materials";

/**
 * Low-poly fish, one model per species, built from a few parameters: a tapered, flat-shaded body
 * with a two-tone gradient and a pattern baked into vertex colours, fins, eyes and extras
 * (whiskers, crest, horns). Models face +x and are 1 unit long; scale them to size.
 * Mutations are materials (gold, diamond, lava, neutron star, black hole with an orbiting ring).
 */

type Rgb = [number, number, number];
type Tail = "fork" | "round" | "fan" | "long";
type Dorsal = "small" | "long" | "sail" | "crest";
type Pattern = "none" | "stripes" | "spots" | "bands" | "scales" | "diagonal";

interface FishLook {
  height: number;
  width: number;
  /** Raised back/forehead (0 = none). */
  hump: number;
  top: string;
  belly: string;
  fin: string;
  tail: Tail;
  dorsal: Dorsal;
  pattern: Pattern;
  patternColor: string;
  whiskers?: boolean;
  horns?: boolean;
}

const LOOKS: Record<string, FishLook> = {
  tilapia: { height: 0.42, width: 0.16, hump: 0.05, top: "#5F6B73", belly: "#C9CED1", fin: "#8C5A5A", tail: "round", dorsal: "long", pattern: "stripes", patternColor: "#4A545B" },
  walkingCatfish: { height: 0.2, width: 0.18, hump: 0, top: "#4A4238", belly: "#9A8E7C", fin: "#3C352D", tail: "round", dorsal: "long", pattern: "none", patternColor: "#000000", whiskers: true },
  snakehead: { height: 0.22, width: 0.18, hump: 0, top: "#3F4A35", belly: "#B8B49A", fin: "#4B4A3A", tail: "round", dorsal: "long", pattern: "bands", patternColor: "#262B20" },
  climbingPerch: { height: 0.36, width: 0.16, hump: 0.04, top: "#6E7A3E", belly: "#C8C48A", fin: "#7E6B3A", tail: "round", dorsal: "long", pattern: "spots", patternColor: "#3E4524" },
  snakeskinGourami: { height: 0.38, width: 0.12, hump: 0.02, top: "#6D7B5E", belly: "#C7C2A4", fin: "#8A8A60", tail: "round", dorsal: "small", pattern: "diagonal", patternColor: "#3C4636" },
  giantGourami: { height: 0.46, width: 0.18, hump: 0.12, top: "#8C7E86", belly: "#E3D2CF", fin: "#A2848C", tail: "fan", dorsal: "small", pattern: "none", patternColor: "#000000" },
  clownFeatherback: { height: 0.4, width: 0.1, hump: 0.18, top: "#8D949B", belly: "#D9DDE0", fin: "#B5BCC2", tail: "long", dorsal: "small", pattern: "spots", patternColor: "#20242A" },
  arowana: { height: 0.3, width: 0.13, hump: 0, top: "#9AA6A0", belly: "#E8EDE6", fin: "#C2A060", tail: "fan", dorsal: "small", pattern: "scales", patternColor: "#D3B76A", whiskers: true },
  giantSnakehead: { height: 0.24, width: 0.2, hump: 0, top: "#2F3A2E", belly: "#C9A86A", fin: "#2A2A22", tail: "round", dorsal: "long", pattern: "bands", patternColor: "#151915" },
  mekongGiantCatfish: { height: 0.3, width: 0.26, hump: 0.03, top: "#5D6670", belly: "#D5D9DC", fin: "#4B535B", tail: "fork", dorsal: "sail", pattern: "none", patternColor: "#000000", whiskers: true },
  nagaFish: { height: 0.3, width: 0.16, hump: 0.04, top: "#B8322E", belly: "#F2C14E", fin: "#E3A72F", tail: "long", dorsal: "crest", pattern: "scales", patternColor: "#F2C14E", horns: true },
};

const FALLBACK = LOOKS.tilapia!;

const hexRgb = (hex: string): Rgb => {
  const c = Color3.FromHexString(hex);
  return [c.r, c.g, c.b];
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Colour each flat-shaded triangle from its centroid (crisp low-poly look). */
function paintFaces(mesh: Mesh, color: (cx: number, cy: number, cz: number) => Rgb): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v += 3) {
    const cx = (pos[v * 3]! + pos[v * 3 + 3]! + pos[v * 3 + 6]!) / 3;
    const cy = (pos[v * 3 + 1]! + pos[v * 3 + 4]! + pos[v * 3 + 7]!) / 3;
    const cz = (pos[v * 3 + 2]! + pos[v * 3 + 5]! + pos[v * 3 + 8]!) / 3;
    const c = color(cx, cy, cz);
    for (let k = 0; k < 3; k++) colors.set([c[0], c[1], c[2], 1], (v + k) * 4);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

const solidPaint = (mesh: Mesh, hex: string) => {
  mesh.convertToFlatShadedMesh();
  const c = hexRgb(hex);
  paintFaces(mesh, () => c);
  return mesh;
};

/** Flat triangle-list mesh from points in the x/y plane at z (fins). */
function finMesh(scene: Scene, name: string, tris: [number, number][][], z: number, hex: string): Mesh {
  const positions: number[] = [];
  for (const tri of tris) for (const [x, y] of tri) positions.push(x, y, z);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = positions.map((_, i) => i).slice(0, positions.length / 3);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, data.indices, normals);
  data.normals = normals;
  data.uvs = new Array((positions.length / 3) * 2).fill(0); // merging needs matching attributes
  data.applyToMesh(mesh);
  return solidPaint(mesh, hex);
}

function tailTris(kind: Tail, h: number): [number, number][][] {
  const s = h * 0.95;
  switch (kind) {
    case "fork":
      return [
        [[0, 0], [-0.32, s], [-0.18, 0]],
        [[0, 0], [-0.18, 0], [-0.32, -s]],
      ];
    case "fan":
      return [
        [[0, 0], [-0.26, s * 0.9], [-0.3, 0]],
        [[0, 0], [-0.3, 0], [-0.26, -s * 0.9]],
      ];
    case "long":
      return [
        [[0, 0], [-0.45, s * 0.55], [-0.38, 0]],
        [[0, 0], [-0.38, 0], [-0.45, -s * 0.55]],
      ];
    case "round":
      return [
        [[0, 0], [-0.2, s * 0.7], [-0.26, s * 0.3]],
        [[0, 0], [-0.26, s * 0.3], [-0.26, -s * 0.3]],
        [[0, 0], [-0.26, -s * 0.3], [-0.2, -s * 0.7]],
      ];
  }
}

function dorsalTris(kind: Dorsal, h: number): [number, number][][] {
  const top = h / 2;
  switch (kind) {
    case "small":
      return [[[-0.08, top * 0.85], [0.06, top + 0.14], [0.14, top * 0.85]]];
    case "long":
      return [
        [[-0.38, top * 0.4], [0.18, top * 0.9], [0.18, top + 0.07]],
        [[-0.38, top * 0.4], [0.18, top + 0.07], [-0.32, top * 0.4 + 0.1]],
      ];
    case "sail":
      return [[[-0.05, top * 0.85], [0.1, top + 0.28], [0.17, top * 0.8]]];
    case "crest": {
      const tris: [number, number][][] = [];
      for (let i = 0; i < 7; i++) {
        const x = 0.25 - i * 0.09;
        const y = top * (1 - Math.abs(x) * 0.9);
        tris.push([[x - 0.045, y - 0.02], [x, y + 0.12 - i * 0.008], [x + 0.045, y - 0.02]]);
      }
      return tris;
    }
  }
}

interface SpeciesModel {
  body: Mesh;
  tail: Mesh;
}

const modelCache = new WeakMap<Scene, Map<string, SpeciesModel>>();

/** Hidden per-species source meshes (body + separately animated tail). */
function speciesModel(scene: Scene, speciesId: string): SpeciesModel {
  let perScene = modelCache.get(scene);
  if (!perScene) modelCache.set(scene, (perScene = new Map()));
  const hit = perScene.get(speciesId);
  if (hit) return hit;

  const look = LOOKS[speciesId] ?? FALLBACK;
  const top = hexRgb(look.top);
  const belly = hexRgb(look.belly);
  const pat = hexRgb(look.patternColor);

  // Body: an ellipsoid tapered to the tail and blunted at the head, plus an optional hump.
  const body = CreateSphere(`fishBody_${speciesId}`, { segments: 6, diameterX: 1, diameterY: look.height, diameterZ: look.width }, scene);
  const pos = body.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!;
    const t = x < 0 ? 1 - Math.pow(Math.abs(x) / 0.5, 1.5) * 0.78 : 1 - Math.pow(x / 0.5, 2) * 0.3;
    pos[i + 1] = pos[i + 1]! * t;
    pos[i + 2] = pos[i + 2]! * t;
    if (pos[i + 1]! > 0) pos[i + 1] = pos[i + 1]! + look.hump * (1 - Math.pow(x / 0.5, 2)) * (pos[i + 1]! / (look.height / 2));
  }
  body.setVerticesData(VertexBuffer.PositionKind, pos);
  body.convertToFlatShadedMesh();
  const h = look.height;
  paintFaces(body, (x, y, z) => {
    let c = mix(belly, top, smooth(-h * 0.15, h * 0.2, y));
    const upper = y > -h * 0.05;
    switch (look.pattern) {
      case "stripes":
        if (upper && Math.sin(x * 38) > 0.55) c = mix(c, pat, 0.7);
        break;
      case "bands":
        if (Math.sin(x * 16 + 1) > 0.5) c = mix(c, pat, 0.75);
        break;
      case "spots":
        if (hash01(Math.floor(x * 14) * 7 + Math.floor(y * 14) * 13 + Math.floor(z * 14)) > 0.72) c = mix(c, pat, 0.8);
        break;
      case "scales":
        if ((Math.floor(x * 18) + Math.floor(y * 18)) % 2 === 0) c = mix(c, pat, 0.35);
        break;
      case "diagonal":
        if (upper && Math.sin((x + y) * 30) > 0.4) c = mix(c, pat, 0.6);
        break;
      case "none":
        break;
    }
    // A little darker towards the tail, a little brighter at the snout.
    return mix(c, [0, 0, 0], Math.max(0, -x) * 0.25);
  });

  const parts: Mesh[] = [body];
  for (const side of [-1, 1]) {
    const eye = solidPaint(CreateIcoSphere(`eye${side}`, { radius: 0.035, subdivisions: 1 }, scene), "#15120F");
    eye.position = new Vector3(0.36, h * 0.1, side * look.width * 0.3);
    eye.bakeCurrentTransformIntoVertices();
    parts.push(eye);
    const pectoral = finMesh(scene, `pec${side}`, [[[0.2, -h * 0.15], [0.02, -h * 0.32], [0.08, -h * 0.12]]], side * look.width * 0.42, look.fin);
    parts.push(pectoral);
    if (look.whiskers) {
      for (const [len, dy] of [[0.28, -0.02], [0.2, -0.06]] as const) {
        const w = solidPaint(CreateBox("whisker", { width: len, height: 0.012, depth: 0.012 }, scene), look.fin);
        w.position = new Vector3(0.5 + len * 0.35, dy, side * 0.05);
        w.rotation.y = side * 0.5;
        w.rotation.z = -0.35;
        w.bakeCurrentTransformIntoVertices();
        parts.push(w);
      }
    }
    if (look.horns) {
      const horn = solidPaint(CreateCylinder("horn", { height: 0.16, diameterTop: 0, diameterBottom: 0.05, tessellation: 4 }, scene), "#F2C14E");
      horn.position = new Vector3(0.3, h * 0.55, side * 0.06);
      horn.rotation.z = -0.6;
      horn.rotation.x = side * 0.3;
      horn.bakeCurrentTransformIntoVertices();
      parts.push(horn);
    }
  }
  parts.push(finMesh(scene, "dorsal", dorsalTris(look.dorsal, h), 0, look.fin));
  parts.push(finMesh(scene, "anal", [[[-0.32, -h * 0.25], [-0.05, -h * 0.42], [-0.02, -h * 0.28]]], 0, look.fin));

  const merged = Mesh.MergeMeshes(parts, true)!;
  merged.name = `fish_${speciesId}`;
  merged.isVisible = false;
  const tail = finMesh(scene, `fishTail_${speciesId}`, tailTris(look.tail, h), 0, look.fin);
  tail.isVisible = false;

  const model = { body: merged, tail };
  perScene.set(speciesId, model);
  return model;
}

// ---------- Mutation materials ----------

type Finish = "normal" | MutationId;

const finishCache = new WeakMap<Scene, Map<Finish, StandardMaterial>>();

function finishMaterial(scene: Scene, finish: Finish): StandardMaterial {
  let perScene = finishCache.get(scene);
  if (!perScene) finishCache.set(scene, (perScene = new Map()));
  const hit = perScene.get(finish);
  if (hit) return hit;
  const m = new StandardMaterial(`fishFinish_${finish}`, scene);
  m.backFaceCulling = false; // fins are single sheets
  m.diffuseColor = Color3.White();
  m.specularColor = new Color3(0.25, 0.25, 0.25);
  switch (finish) {
    case "gold":
      m.diffuseColor = Color3.FromHexString("#FFD45A");
      m.specularColor = new Color3(1, 0.9, 0.5);
      m.specularPower = 24;
      m.emissiveColor = Color3.FromHexString("#5A3F00");
      break;
    case "diamond":
      m.diffuseColor = Color3.FromHexString("#CFF6FF");
      m.specularColor = Color3.White();
      m.specularPower = 96;
      m.emissiveColor = Color3.FromHexString("#3A7A8C");
      m.alpha = 0.6;
      break;
    case "lava":
      m.diffuseColor = Color3.FromHexString("#2A1410");
      m.emissiveColor = Color3.FromHexString("#FF5A12");
      break;
    case "neutronStar":
      m.diffuseColor = Color3.FromHexString("#DDEBFF");
      m.emissiveColor = Color3.FromHexString("#BFD8FF");
      break;
    case "blackHole":
      m.diffuseColor = Color3.FromHexString("#08060C");
      m.specularColor = new Color3(0.6, 0.4, 1);
      m.emissiveColor = Color3.FromHexString("#120822");
      break;
    case "normal":
      break;
  }
  perScene.set(finish, m);
  return m;
}

const accretionCache = new WeakMap<Scene, StandardMaterial>();

function accretionMaterial(scene: Scene): StandardMaterial {
  let m = accretionCache.get(scene);
  if (!m) {
    m = new StandardMaterial("accretionMat", scene);
    m.emissiveColor = Color3.FromHexString("#B46CFF");
    m.disableLighting = true;
    accretionCache.set(scene, m);
  }
  return m;
}

/** The mutation that decides how a fish looks: the rarest one it has. */
function finishFor(mutations: readonly MutationId[]): Finish {
  const order: MutationId[] = ["blackHole", "neutronStar", "lava", "diamond", "gold"];
  return order.find((m) => mutations.includes(m)) ?? "normal";
}

/** Density mutations are the opposite joke: absurdly heavy, but drawn tiny. */
export function isDense(mutations: readonly MutationId[]): boolean {
  return mutations.includes("blackHole") || mutations.includes("neutronStar");
}

export interface FishModel {
  root: TransformNode;
  /** Wiggle the tail and run mutation effects. `swim` is the swim phase (radians). */
  update(timeSec: number, swim: number): void;
  dispose(): void;
}

export function createFishModel(scene: Scene, speciesId: string, mutations: readonly MutationId[]): FishModel {
  const model = speciesModel(scene, speciesId);
  const finish = finishFor(mutations);
  const material = finishMaterial(scene, finish);
  // Vertex colours give the species pattern; strong finishes cover it completely.
  const keepPattern = finish === "normal" || finish === "gold" || finish === "diamond";

  const root = new TransformNode(`fishModel_${speciesId}`, scene);
  const body = model.body.clone(`fishBody`, root, true)!;
  body.isVisible = true;
  body.material = material;
  body.useVertexColors = keepPattern;
  const tailPivot = new TransformNode("tailPivot", scene);
  tailPivot.parent = root;
  tailPivot.position.x = -0.44;
  const tail = model.tail.clone("fishTail", tailPivot, true)!;
  tail.isVisible = true;
  tail.material = material;
  tail.useVertexColors = keepPattern;

  // Black hole: an orbiting accretion ring of glowing specks.
  let ring: TransformNode | null = null;
  if (finish === "blackHole") {
    ring = new TransformNode("accretion", scene);
    ring.parent = root;
    const disc = CreateTorus("accretionRing", { diameter: 1.6, thickness: 0.05, tessellation: 24 }, scene);
    disc.parent = ring;
    const glow = accretionMaterial(scene);
    disc.material = glow;
    for (let i = 0; i < 10; i++) {
      const speck = CreateIcoSphere("speck", { radius: 0.045, subdivisions: 1 }, scene);
      const a = (i / 10) * Math.PI * 2;
      speck.parent = ring;
      speck.position = new Vector3(Math.cos(a) * 0.85, (hash01(i) - 0.5) * 0.06, Math.sin(a) * 0.85);
      speck.material = glow;
    }
    ring.rotation.x = 0.45;
  }

  return {
    root,
    update(t, swim) {
      tailPivot.rotation.y = Math.sin(swim * 3) * 0.45;
      if (finish === "lava") material.emissiveColor.set(0.8 + Math.sin(t * 4) * 0.2, 0.28 + Math.sin(t * 4) * 0.08, 0.05);
      if (ring) ring.rotation.y = t * 2.2;
    },
    dispose() {
      root.dispose(); // clones share geometry with the cached templates; materials are shared
    },
  };
}
