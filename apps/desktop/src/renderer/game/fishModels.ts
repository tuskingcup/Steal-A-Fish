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
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { MutationId } from "@saf/core";
import { hash01 } from "./materials";

/**
 * Low-poly fish, one model per species, built from parameters that give each species its own
 * silhouette: body proportions (deep, eel-like, knife-shaped, flat-headed), fins (spiny, long,
 * sail, ribbon, set far back), mouths (wide, upturned, thick lips), whiskers, feelers, patterns
 * baked into vertex colours. The mythic พญานาค is not a fish at all: a three-headed Thai naga with
 * a serpent body that sways, a flame crest, gold crowns and fangs. Models face +x and are 1 unit
 * long; scale them to size. Mutations are materials (the rarest one decides the look).
 */

type Rgb = [number, number, number];
type Tail = "fork" | "round" | "fan" | "long" | "shark";
type Dorsal = "spiny" | "long" | "sail" | "small" | "rear";
type Anal = "short" | "long" | "ribbon" | "rear";
type Pattern = "none" | "bars" | "spots" | "bands" | "scales" | "diagonal" | "ocelli" | "stripe";
type Mouth = "normal" | "up" | "lips" | "wide";

interface FishLook {
  height: number;
  width: number;
  /** Raised back/forehead. */
  hump: number;
  /** Extra belly depth mid-body (knife-shaped featherback). */
  belly: number;
  /** Flattens the top of the head (snakeheads, catfish). */
  headFlat: number;
  /** How long the body stays thick before the tail (higher = thinner tail sooner). */
  taper: number;
  top: string;
  under: string;
  fin: string;
  tail: Tail;
  dorsal: Dorsal;
  anal: Anal;
  pattern: Pattern;
  patternColor: string;
  mouth: Mouth;
  eye: number;
  /** Whisker pairs and their length. */
  barbels?: [number, number];
  /** Long thread-like ventral fins (gouramis). */
  feelers?: boolean;
}

const LOOKS: Record<string, FishLook> = {
  tilapia: { height: 0.44, width: 0.15, hump: 0.05, belly: 0.04, headFlat: 0, taper: 1.5, top: "#6B7680", under: "#D3D6D8", fin: "#C85A50", tail: "round", dorsal: "spiny", anal: "short", pattern: "bars", patternColor: "#47515A", mouth: "lips", eye: 0.042 },
  walkingCatfish: { height: 0.16, width: 0.17, hump: 0, belly: 0, headFlat: 0.55, taper: 0.7, top: "#3D362E", under: "#8E8270", fin: "#352F28", tail: "round", dorsal: "long", anal: "long", pattern: "spots", patternColor: "#2A251F", mouth: "wide", eye: 0.022, barbels: [4, 0.26] },
  snakehead: { height: 0.2, width: 0.18, hump: 0, belly: 0, headFlat: 0.45, taper: 1.0, top: "#3F4A35", under: "#C2BE9F", fin: "#4B4A3A", tail: "round", dorsal: "long", anal: "long", pattern: "bands", patternColor: "#20251B", mouth: "wide", eye: 0.034 },
  climbingPerch: { height: 0.36, width: 0.15, hump: 0.03, belly: 0.02, headFlat: 0, taper: 1.4, top: "#6E7A3E", under: "#D3CF92", fin: "#7E6B3A", tail: "round", dorsal: "spiny", anal: "short", pattern: "spots", patternColor: "#33391C", mouth: "normal", eye: 0.05 },
  snakeskinGourami: { height: 0.38, width: 0.09, hump: 0.02, belly: 0.03, headFlat: 0, taper: 1.5, top: "#6D7B5E", under: "#CBC6A8", fin: "#8A8A60", tail: "round", dorsal: "small", anal: "long", pattern: "diagonal", patternColor: "#343E2F", mouth: "up", eye: 0.04, feelers: true },
  giantGourami: { height: 0.52, width: 0.17, hump: 0.15, belly: 0.05, headFlat: 0, taper: 1.6, top: "#8C7E86", under: "#EDDCD8", fin: "#A2848C", tail: "fan", dorsal: "long", anal: "long", pattern: "none", patternColor: "#000000", mouth: "lips", eye: 0.034, feelers: true },
  clownFeatherback: { height: 0.44, width: 0.07, hump: 0.2, belly: 0.14, headFlat: 0, taper: 2.6, top: "#8D949B", under: "#E3E6E9", fin: "#B5BCC2", tail: "long", dorsal: "small", anal: "ribbon", pattern: "ocelli", patternColor: "#161A20", mouth: "normal", eye: 0.034 },
  arowana: { height: 0.26, width: 0.11, hump: 0, belly: 0.02, headFlat: 0.15, taper: 1.2, top: "#C9A24A", under: "#F6E8B8", fin: "#D9733A", tail: "fan", dorsal: "rear", anal: "rear", pattern: "scales", patternColor: "#FFE08A", mouth: "up", eye: 0.04, barbels: [1, 0.12] },
  giantSnakehead: { height: 0.24, width: 0.2, hump: 0, belly: 0, headFlat: 0.4, taper: 1.0, top: "#263026", under: "#CDAE70", fin: "#262A22", tail: "round", dorsal: "long", anal: "long", pattern: "stripe", patternColor: "#E07A2E", mouth: "wide", eye: 0.034 },
  mekongGiantCatfish: { height: 0.3, width: 0.27, hump: 0.02, belly: 0.02, headFlat: 0.35, taper: 1.7, top: "#5D6670", under: "#E4E8EB", fin: "#4B535B", tail: "shark", dorsal: "sail", anal: "short", pattern: "none", patternColor: "#000000", mouth: "wide", eye: 0.022 },
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

const solidPaint = <T extends Mesh>(mesh: T, hex: string): T => {
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
  data.indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, data.indices, normals);
  data.normals = normals;
  data.uvs = new Array((positions.length / 3) * 2).fill(0); // merging needs matching attributes
  data.applyToMesh(mesh);
  return solidPaint(mesh, hex);
}

/** A thin rod from a to b (whiskers, feelers, spines). */
function rod(scene: Scene, a: Vector3, b: Vector3, thickness: number, hex: string): Mesh {
  const len = Vector3.Distance(a, b);
  const m = CreateBox("rod", { width: len, height: thickness, depth: thickness }, scene);
  const d = b.subtract(a);
  m.position = a.add(b).scale(0.5);
  m.rotation.y = Math.atan2(-d.z, d.x);
  m.rotation.z = Math.atan2(d.y, Math.hypot(d.x, d.z));
  m.bakeCurrentTransformIntoVertices();
  return solidPaint(m, hex);
}

function tailTris(kind: Tail, h: number): [number, number][][] {
  const s = h * 0.95;
  switch (kind) {
    case "fork":
      return [
        [[0, 0], [-0.32, s], [-0.18, 0]],
        [[0, 0], [-0.18, 0], [-0.32, -s]],
      ];
    case "shark":
      return [
        [[0, 0], [-0.3, s * 1.25], [-0.16, 0]],
        [[0, 0], [-0.16, 0], [-0.24, -s * 0.85]],
      ];
    case "fan":
      return [
        [[0, 0], [-0.26, s * 0.9], [-0.3, 0]],
        [[0, 0], [-0.3, 0], [-0.26, -s * 0.9]],
      ];
    case "long":
      return [
        [[0, 0], [-0.45, s * 0.4], [-0.4, 0]],
        [[0, 0], [-0.4, 0], [-0.45, -s * 0.4]],
      ];
    case "round":
      return [
        [[0, 0], [-0.2, s * 0.7], [-0.26, s * 0.3]],
        [[0, 0], [-0.26, s * 0.3], [-0.26, -s * 0.3]],
        [[0, 0], [-0.26, -s * 0.3], [-0.2, -s * 0.7]],
      ];
  }
}

/** Body top/bottom edge height at x (to seat fins on the body). */
function edgeAt(look: FishLook, x: number, top: boolean): number {
  const h = look.height / 2;
  const t = x < 0 ? 1 - Math.pow(Math.abs(x) / 0.5, look.taper) * 0.8 : 1 - Math.pow(x / 0.5, 2) * 0.3;
  if (top) return h * t + look.hump * (1 - Math.pow(x / 0.5, 2));
  return -h * t * (1 + look.belly * 3 * (1 - Math.abs(x) * 2));
}

function dorsalTris(look: FishLook): [number, number][][] {
  const top = (x: number) => edgeAt(look, x, true) - 0.01;
  switch (look.dorsal) {
    case "small":
      return [[[-0.06, top(-0.06)], [0.04, top(0.04) + 0.12], [0.12, top(0.12)]]];
    case "rear":
      return [[[-0.42, top(-0.42)], [-0.36, top(-0.36) + 0.12], [-0.24, top(-0.24)]]];
    case "sail":
      return [[[-0.04, top(-0.04)], [0.08, top(0.08) + 0.3], [0.16, top(0.16)]]];
    case "long": {
      const tris: [number, number][][] = [];
      for (let x = -0.4; x < 0.18; x += 0.08) tris.push([[x, top(x)], [x + 0.04, top(x + 0.04) + 0.06], [x + 0.08, top(x + 0.08)]], [[x, top(x)], [x + 0.08, top(x + 0.08)], [x + 0.04, top(x + 0.04) + 0.06]]);
      return tris;
    }
    case "spiny": {
      const tris: [number, number][][] = [];
      for (let i = 0; i < 9; i++) {
        const x = 0.2 - i * 0.05;
        tris.push([[x, top(x)], [x - 0.012, top(x) + 0.13 - Math.abs(i - 3) * 0.008], [x - 0.05, top(x - 0.05) + 0.05]]);
      }
      return tris;
    }
  }
}

function analTris(look: FishLook): [number, number][][] {
  const bot = (x: number) => edgeAt(look, x, false) + 0.01;
  switch (look.anal) {
    case "short":
      return [[[-0.3, bot(-0.3)], [-0.12, bot(-0.12) - 0.09], [-0.05, bot(-0.05)]]];
    case "rear":
      return [[[-0.42, bot(-0.42)], [-0.34, bot(-0.34) - 0.1], [-0.24, bot(-0.24)]]];
    case "long": {
      const tris: [number, number][][] = [];
      for (let x = -0.42; x < 0.04; x += 0.08) tris.push([[x, bot(x)], [x + 0.04, bot(x + 0.04) - 0.05], [x + 0.08, bot(x + 0.08)]]);
      return tris;
    }
    case "ribbon": {
      // Featherback: one long wavy fin along the belly that runs into the tail.
      const tris: [number, number][][] = [];
      for (let x = -0.5; x < 0.14; x += 0.04) {
        const depth = 0.07 + Math.sin(x * 22) * 0.015;
        tris.push([[x, bot(x)], [x, bot(x) - depth], [x + 0.04, bot(x + 0.04)]], [[x + 0.04, bot(x + 0.04)], [x, bot(x) - depth], [x + 0.04, bot(x + 0.04) - depth]]);
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
  const under = hexRgb(look.under);
  const pat = hexRgb(look.patternColor);
  const h = look.height;

  // Body: an ellipsoid shaped per species — tapered tail, flat head, hump, deep belly, wide mouth.
  const body = CreateSphere(`fishBody_${speciesId}`, { segments: 8, diameterX: 1, diameterY: h, diameterZ: look.width }, scene);
  const pos = body.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!;
    let y = pos[i + 1]!;
    let z = pos[i + 2]!;
    const t = x < 0 ? 1 - Math.pow(Math.abs(x) / 0.5, look.taper) * 0.8 : 1 - Math.pow(x / 0.5, 2) * 0.3;
    y *= t;
    z *= t;
    if (y > 0) {
      y += look.hump * (1 - Math.pow(x / 0.5, 2)) * (y / (h / 2));
      if (x > 0.15) y *= 1 - look.headFlat * ((x - 0.15) / 0.35);
    } else {
      y *= 1 + look.belly * 3 * (1 - Math.abs(x) * 2);
    }
    if (look.mouth === "wide" && x > 0.25) z *= 1 + 0.5 * ((x - 0.25) / 0.25);
    if (look.mouth === "up" && x > 0.3) y += (x - 0.3) * 0.25;
    pos[i + 1] = y;
    pos[i + 2] = z;
  }
  body.setVerticesData(VertexBuffer.PositionKind, pos);
  body.convertToFlatShadedMesh();
  paintFaces(body, (x, y, z) => {
    let c = mix(under, top, smooth(-h * 0.15, h * 0.2, y));
    const upper = y > -h * 0.05;
    switch (look.pattern) {
      case "bars":
        if (upper && Math.sin(x * 30) > 0.55) c = mix(c, pat, 0.7);
        break;
      case "bands":
        if (Math.sin(x * 16 + 1) > 0.5) c = mix(c, pat, 0.75);
        break;
      case "spots":
        if (hash01(Math.floor(x * 16) * 7 + Math.floor(y * 16) * 13 + Math.floor(z * 16)) > 0.72) c = mix(c, pat, 0.8);
        break;
      case "scales":
        if ((Math.floor(x * 12) + Math.floor(y * 12)) % 2 === 0) c = mix(c, pat, 0.4);
        break;
      case "diagonal":
        if (upper && Math.sin((x + y) * 30) > 0.4) c = mix(c, pat, 0.6);
        break;
      case "stripe":
        if (Math.abs(y + h * 0.02) < h * 0.08 && x < 0.3) c = mix(c, pat, 0.85);
        break;
      case "ocelli": {
        // Featherback: a row of dark eye-spots with pale rings along the lower flank.
        for (let k = 0; k < 7; k++) {
          const d = Math.hypot(x - (-0.38 + k * 0.08), y - -h * 0.12);
          if (d < 0.022) c = pat;
          else if (d < 0.034) c = [0.95, 0.95, 0.92];
        }
        break;
      }
      case "none":
        break;
    }
    return mix(c, [0, 0, 0], Math.max(0, -x) * 0.25);
  });

  const parts: Mesh[] = [body];
  const eyeX = look.headFlat > 0.3 ? 0.4 : 0.36;
  const eyeY = look.headFlat > 0.3 ? h * 0.12 : h * 0.1;
  for (const side of [-1, 1]) {
    const zEye = side * look.width * (look.mouth === "wide" ? 0.42 : 0.32);
    const white = solidPaint(CreateIcoSphere(`eyeW${side}`, { radius: look.eye, subdivisions: 1 }, scene), "#F2EEE6");
    white.position = new Vector3(eyeX, eyeY, zEye);
    white.bakeCurrentTransformIntoVertices();
    const pupil = solidPaint(CreateIcoSphere(`eyeP${side}`, { radius: look.eye * 0.62, subdivisions: 1 }, scene), "#120F0C");
    pupil.position = new Vector3(eyeX + look.eye * 0.2, eyeY, zEye + side * look.eye * 0.45);
    pupil.bakeCurrentTransformIntoVertices();
    parts.push(white, pupil);
    parts.push(finMesh(scene, `pec${side}`, [[[0.2, -h * 0.15], [0.02, -h * 0.32], [0.08, -h * 0.12]]], side * look.width * 0.45, look.fin));

    if (look.barbels) {
      const [pairs, len] = look.barbels;
      for (let k = 0; k < pairs; k++) {
        const root = new Vector3(0.48, -0.01 - k * 0.012, side * (0.025 + k * 0.012));
        const tip = root.add(new Vector3(len * (0.4 - k * 0.1), -len * (0.25 + k * 0.12), side * len * (0.6 + k * 0.12)));
        parts.push(rod(scene, root, tip, 0.012, look.fin));
      }
    }
    if (look.feelers) {
      const root = new Vector3(0.16, -h * 0.42, side * look.width * 0.2);
      parts.push(rod(scene, root, root.add(new Vector3(-0.42, -h * 0.55, side * 0.03)), 0.01, look.fin));
    }
  }
  if (look.mouth === "lips") {
    const lips = solidPaint(CreateTorus("lips", { diameter: h * 0.18, thickness: h * 0.07, tessellation: 8 }, scene), "#C99A98");
    lips.rotation.z = Math.PI / 2;
    lips.position = new Vector3(0.49, -h * 0.04, 0);
    lips.bakeCurrentTransformIntoVertices();
    parts.push(lips);
  }
  if (look.mouth === "up") {
    const jaw = solidPaint(CreateBox("jaw", { width: 0.12, height: 0.03, depth: look.width * 0.5 }, scene), look.under);
    jaw.position = new Vector3(0.46, -0.02, 0);
    jaw.rotation.z = 0.6;
    jaw.bakeCurrentTransformIntoVertices();
    parts.push(jaw);
  }
  parts.push(finMesh(scene, "dorsal", dorsalTris(look), 0, look.fin));
  parts.push(finMesh(scene, "anal", analTris(look), 0, look.fin));

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

export type Finish = "normal" | MutationId;

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
      m.emissiveColor = Color3.FromHexString("#6A4A00");
      break;
    case "diamond":
      m.diffuseColor = Color3.FromHexString("#D6F8FF");
      m.specularColor = Color3.White();
      m.specularPower = 128;
      m.emissiveColor = Color3.FromHexString("#4A93A8");
      m.alpha = 0.62;
      break;
    case "lava":
      m.diffuseColor = Color3.FromHexString("#2A1410");
      m.emissiveColor = Color3.FromHexString("#FF5A12");
      break;
    case "neutronStar":
      m.diffuseColor = Color3.FromHexString("#DDEBFF");
      m.emissiveColor = Color3.FromHexString("#CFE2FF");
      break;
    case "blackHole":
      m.diffuseColor = Color3.FromHexString("#08060C");
      m.specularColor = new Color3(0.6, 0.4, 1);
      m.emissiveColor = Color3.FromHexString("#140A28");
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
export function finishFor(mutations: readonly MutationId[]): Finish {
  const order: MutationId[] = ["blackHole", "neutronStar", "lava", "diamond", "gold"];
  return order.find((m) => mutations.includes(m)) ?? "normal";
}

/** Density mutations are the opposite joke: absurdly heavy, but drawn tiny. */
export function isDense(mutations: readonly MutationId[]): boolean {
  return mutations.includes("blackHole") || mutations.includes("neutronStar");
}

export interface FishModel {
  root: TransformNode;
  /** Every mesh of the model (for the glow layer). */
  meshes: Mesh[];
  /** Animate: `swim` is the swim phase (radians). */
  update(timeSec: number, swim: number): void;
  dispose(): void;
}

export function createFishModel(scene: Scene, speciesId: string, mutations: readonly MutationId[]): FishModel {
  const finish = finishFor(mutations);
  if (speciesId === "nagaFish") return createNaga(scene, finish);

  const model = speciesModel(scene, speciesId);
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
  const meshes: Mesh[] = [body, tail];

  let ring: TransformNode | null = null;
  if (finish === "blackHole") {
    ring = new TransformNode("accretion", scene);
    ring.parent = root;
    const disc = CreateTorus("accretionRing", { diameter: 1.6, thickness: 0.05, tessellation: 24 }, scene);
    disc.parent = ring;
    disc.material = accretionMaterial(scene);
    meshes.push(disc);
    ring.rotation.x = 0.45;
  }

  return {
    root,
    meshes,
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

// ---------- พญานาค: a three-headed Thai naga ----------

const NAGA_POINTS = 44;
const nagaMats = new WeakMap<Scene, { scales: StandardMaterial; gold: StandardMaterial; flame: StandardMaterial; mouth: StandardMaterial; fang: StandardMaterial; eye: StandardMaterial }>();

function nagaMaterials(scene: Scene) {
  const hit = nagaMats.get(scene);
  if (hit) return hit;
  // Green-gold scales: overlapping arcs, a gold rim on each.
  const tex = new DynamicTexture("nagaScales", { width: 64, height: 64 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#145C38";
  ctx.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const cx = col * 16 + (row % 2 ? 8 : 0);
      const cy = row * 14;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI);
      ctx.fillStyle = row % 2 ? "#1F8A4C" : "#1A7A44";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#E8B73C";
      ctx.stroke();
    }
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 3;
  tex.vScale = 26;
  const scales = new StandardMaterial("nagaScalesMat", scene);
  scales.diffuseTexture = tex;
  scales.emissiveColor = new Color3(0.08, 0.16, 0.1);
  scales.specularColor = new Color3(0.9, 0.8, 0.4);
  scales.specularPower = 32;
  const gold = new StandardMaterial("nagaGold", scene);
  gold.diffuseColor = Color3.FromHexString("#FFC93C");
  gold.specularColor = new Color3(1, 0.9, 0.5);
  gold.emissiveColor = Color3.FromHexString("#7A5200");
  const flame = new StandardMaterial("nagaFlame", scene);
  flame.diffuseColor = Color3.FromHexString("#FF6A2A");
  flame.emissiveColor = Color3.FromHexString("#C2301A");
  flame.backFaceCulling = false;
  const mouth = new StandardMaterial("nagaMouth", scene);
  mouth.diffuseColor = Color3.FromHexString("#9E1B2A");
  mouth.emissiveColor = Color3.FromHexString("#3A0610");
  const fang = new StandardMaterial("nagaFang", scene);
  fang.diffuseColor = Color3.FromHexString("#FFF8E8");
  fang.emissiveColor = Color3.FromHexString("#5A554C");
  const eye = new StandardMaterial("nagaEye", scene);
  eye.diffuseColor = Color3.FromHexString("#FFD23F");
  eye.emissiveColor = Color3.FromHexString("#FFB000");
  eye.disableLighting = true;
  const mats = { scales, gold, flame, mouth, fang, eye };
  nagaMats.set(scene, mats);
  return mats;
}

/** Body centre line: tail low in the water, sweeping S-curves, the front rearing up. Length ≈ 1. */
function nagaPath(t: number, out: Vector3[]): void {
  for (let i = 0; i < NAGA_POINTS; i++) {
    const s = i / (NAGA_POINTS - 1);
    const rear = smooth(0.62, 1, s);
    out[i]!.set(
      -0.5 + s * 0.78,
      0.06 * Math.sin(s * Math.PI * 2.6 - t * 1.6) * (1 - rear) + rear * 0.36 - 0.05,
      0.09 * Math.sin(s * Math.PI * 2.1 - t * 1.2) * (1 - rear * 0.8),
    );
  }
}

const nagaRadius = (i: number) => {
  const s = i / (NAGA_POINTS - 1);
  return 0.006 + 0.036 * smooth(0, 0.4, s) - 0.006 * smooth(0.85, 1, s);
};

function createNaga(scene: Scene, finish: Finish): FishModel {
  const mats = nagaMaterials(scene);
  const skin = finish === "normal" ? mats.scales : finishMaterial(scene, finish);
  const root = new TransformNode("naga", scene);
  const meshes: Mesh[] = [];

  const path = Array.from({ length: NAGA_POINTS }, () => Vector3.Zero());
  nagaPath(0, path);
  const body = CreateTube("nagaBody", { path, radiusFunction: nagaRadius, tessellation: 10, updatable: true, cap: Mesh.CAP_ALL }, scene);
  body.parent = root;
  body.material = skin;
  meshes.push(body);

  // Flame crest along the spine, re-seated on the body every frame.
  const crest: Mesh[] = [];
  for (let k = 0; k < 16; k++) {
    const f = CreateCylinder(`nagaCrest${k}`, { height: 1, diameterTop: 0, diameterBottom: 0.5, tessellation: 4 }, scene);
    f.parent = root;
    f.scaling.z = 0.25;
    f.material = k % 3 === 0 ? mats.gold : mats.flame;
    crest.push(f);
    meshes.push(f);
  }

  // Three heads on short necks, fanned out like a Thai naga balustrade.
  const headRoot = new TransformNode("nagaHeads", scene);
  headRoot.parent = root;
  const heads: TransformNode[] = [];
  for (const [i, side] of [-1, 0, 1].entries()) {
    const big = side === 0 ? 1.55 : 1.3;
    const pivot = new TransformNode(`nagaNeck${i}`, scene);
    pivot.parent = headRoot;
    pivot.rotation.x = side * 0.75;
    pivot.rotation.z = side === 0 ? 0.1 : -0.1;
    const neck = CreateCylinder("neck", { height: 0.12 * big, diameterTop: 0.05 * big, diameterBottom: 0.07, tessellation: 8 }, scene);
    neck.parent = pivot;
    neck.position.y = 0.06 * big;
    neck.material = skin;
    const head = new TransformNode(`nagaHead${i}`, scene);
    head.parent = pivot;
    head.position.y = 0.13 * big;
    head.scaling.setAll(big);
    heads.push(head);
    const add = (mesh: Mesh, mat: StandardMaterial) => {
      mesh.parent = head;
      mesh.material = mat;
      meshes.push(mesh);
      return mesh;
    };
    const skull = add(CreateIcoSphere("skull", { radius: 0.04, subdivisions: 2 }, scene), skin);
    skull.scaling = new Vector3(1.35, 0.9, 1);
    // Tapered snout and an open lower jaw (cones lying along +x), red mouth between them.
    const snout = add(CreateCylinder("snout", { height: 0.08, diameterTop: 0.022, diameterBottom: 0.055, tessellation: 8 }, scene), skin);
    snout.rotation.z = -Math.PI / 2;
    snout.position = new Vector3(0.065, 0.004, 0);
    snout.scaling.z = 1.15;
    const jaw = add(CreateCylinder("jaw", { height: 0.075, diameterTop: 0.012, diameterBottom: 0.04, tessellation: 8 }, scene), skin);
    jaw.rotation.z = -Math.PI / 2 - 0.45;
    jaw.position = new Vector3(0.05, -0.03, 0);
    const mouth = add(CreateCylinder("mouth", { height: 0.06, diameterTop: 0.01, diameterBottom: 0.04, tessellation: 8 }, scene), mats.mouth);
    mouth.rotation.z = -Math.PI / 2 - 0.2;
    mouth.position = new Vector3(0.05, -0.014, 0);
    for (const z of [-0.014, 0.014]) {
      const fang = add(CreateCylinder("fang", { height: 0.022, diameterTop: 0, diameterBottom: 0.008, tessellation: 4 }, scene), mats.fang);
      fang.position = new Vector3(0.075, -0.016, z);
      fang.rotation.z = Math.PI;
      const eye = add(CreateIcoSphere("eye", { radius: 0.009, subdivisions: 1 }, scene), mats.eye);
      eye.position = new Vector3(0.025, 0.022, z * 1.9);
      // Whiskers curling back from the snout.
      const whisker = add(CreateCylinder("whisker", { height: 0.09, diameter: 0.004, tessellation: 4 }, scene), mats.gold);
      whisker.position = new Vector3(0.05, -0.005, z * 2.4);
      whisker.rotation = new Vector3(z > 0 ? 0.9 : -0.9, 0, 1.2);
    }
    // Gold crown (มงกุฎ): a tall spire on a band, small points around it.
    const band = add(CreateCylinder("crownBand", { height: 0.016, diameter: 0.05, tessellation: 8 }, scene), mats.gold);
    band.position = new Vector3(-0.005, 0.036, 0);
    const spire = add(CreateCylinder("crownSpire", { height: 0.08, diameterTop: 0, diameterBottom: 0.034, tessellation: 8 }, scene), mats.gold);
    spire.position = new Vector3(-0.005, 0.083, 0);
    for (let p = 0; p < 4; p++) {
      const a = (p / 4) * Math.PI * 2;
      const point = add(CreateCylinder("crownPoint", { height: 0.03, diameterTop: 0, diameterBottom: 0.012, tessellation: 4 }, scene), mats.gold);
      point.position = new Vector3(-0.005 + Math.cos(a) * 0.022, 0.055, Math.sin(a) * 0.022);
    }
    // Flame frill fanning out behind the head.
    for (let p = 0; p < 5; p++) {
      const fl = add(CreateCylinder("frill", { height: 0.07, diameterTop: 0, diameterBottom: 0.022, tessellation: 4 }, scene), p % 2 ? mats.gold : mats.flame);
      const a = -0.9 + p * 0.45;
      fl.position = new Vector3(-0.045 + Math.cos(a) * -0.01, 0.01 + Math.sin(a) * 0.02, Math.sin(a) * 0.035);
      fl.rotation = new Vector3(a * 0.9, 0, 1.2);
    }
  }

  const tangent = new Vector3();
  return {
    root,
    meshes,
    update(t) {
      nagaPath(t, path);
      CreateTube("nagaBody", { path, radiusFunction: nagaRadius, instance: body });
      // Crest flames stand up from the spine, flickering.
      crest.forEach((f, k) => {
        const i = Math.round(6 + (k / (crest.length - 1)) * (NAGA_POINTS - 10));
        const p = path[i]!;
        const r = nagaRadius(i);
        const size = r * (1.6 + Math.sin(t * 9 + k) * 0.25);
        f.position.set(p.x, p.y + r + size * 0.4, p.z);
        f.scaling.set(size * 1.4, size, size * 1.4 * 0.25);
        path[i + 1]!.subtractToRef(path[i - 1]!, tangent);
        f.rotation.set(0, Math.atan2(-tangent.z, tangent.x), -0.5 + Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)));
      });
      const neck = path[NAGA_POINTS - 1]!;
      headRoot.position.copyFrom(neck);
      heads.forEach((h, i) => {
        h.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.12;
        h.rotation.y = Math.sin(t * 0.9 + i) * 0.15;
      });
    },
    dispose() {
      root.dispose(); // naga meshes are its own; shared materials stay cached
    },
  };
}
