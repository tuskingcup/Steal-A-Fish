import type { Scene } from "@babylonjs/core/scene";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
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

/**
 * Tail fin around the pivot (x = 0), with a base `b` tall that reaches forward into the body
 * (x > 0) so the tail never looks detached while it wiggles.
 */
/**
 * A paired fin rooted at `at`, swept back along -x and tilted out from the body by `splay`
 * (0 = flat against the flank, π/2 = straight down/out).
 */
function sideFin(scene: Scene, name: string, at: Vector3, side: number, splay: number, len: number, hex: string): Mesh {
  const fin = finMesh(scene, name, [[[0.03, 0.012], [-len, -len * 0.25], [-len * 0.55, -len * 0.55]], [[0.03, 0.012], [-len * 0.55, -len * 0.55], [0.0, -0.02]]], 0, hex);
  fin.rotation.x = side * splay;
  fin.position = at;
  fin.bakeCurrentTransformIntoVertices();
  return fin;
}

function tailTris(kind: Tail, h: number, b: number): [number, number][][] {
  const s = h * 0.95;
  const base: [number, number][][] = [
    [[0.07, b], [0, b], [0, -b]],
    [[0.07, b], [0, -b], [0.07, -b]],
  ];
  const lobes = (upTip: [number, number], notch: [number, number], downTip: [number, number]): [number, number][][] => [
    [[0, b], upTip, notch],
    [[0, b], notch, [0, -b]],
    [[0, -b], notch, downTip],
  ];
  switch (kind) {
    case "fork":
      return [...base, ...lobes([-0.32, s], [-0.17, 0], [-0.32, -s])];
    case "shark":
      return [...base, ...lobes([-0.3, s * 1.25], [-0.15, 0], [-0.24, -s * 0.85])];
    case "fan":
      return [...base, ...lobes([-0.26, s * 0.9], [-0.3, 0], [-0.26, -s * 0.9])];
    case "long":
      return [...base, ...lobes([-0.45, s * 0.4], [-0.4, 0], [-0.45, -s * 0.4])];
    case "round":
      return [
        ...base,
        [[0, b], [-0.2, s * 0.7], [-0.26, s * 0.3]],
        [[0, b], [-0.26, s * 0.3], [0, -b]],
        [[0, -b], [-0.26, s * 0.3], [-0.26, -s * 0.3]],
        [[0, -b], [-0.26, -s * 0.3], [-0.2, -s * 0.7]],
      ];
  }
}

/** Taper of the body cross-section along its length (thick middle, thin tail, blunt head). */
function bodyTaper(look: FishLook, x: number): number {
  return x < 0 ? 1 - Math.pow(Math.abs(x) / 0.5, look.taper) * 0.8 : 1 - Math.pow(x / 0.5, 2) * 0.3;
}

/** Height of a body vertex after the species shaping (hump, flat head, belly, upturned mouth). */
function shapeY(look: FishLook, x: number, y: number): number {
  const h = look.height;
  y *= bodyTaper(look, x);
  if (y > 0) {
    y += look.hump * (1 - Math.pow(x / 0.5, 2)) * (y / (h / 2));
    if (x > 0.15) y *= 1 - look.headFlat * ((x - 0.15) / 0.35);
  } else {
    y *= 1 + look.belly * 3 * (1 - Math.abs(x) * 2);
  }
  if (look.mouth === "up" && x > 0.3) y += (x - 0.3) * 0.25;
  return y;
}

/** Body top/bottom edge at x, exactly as the body mesh is shaped. */
function edgeAt(look: FishLook, x: number, top: boolean): number {
  const r = (look.height / 2) * Math.sqrt(Math.max(0, 1 - 4 * x * x));
  return shapeY(look, x, top ? r : -r);
}

/** Fins start this far inside the body, so the low-poly surface never shows a gap under them. */
const FIN_INSET = 0.035;

function dorsalTris(look: FishLook): [number, number][][] {
  const top = (x: number) => edgeAt(look, x, true) - FIN_INSET;
  switch (look.dorsal) {
    case "small":
      return [[[-0.06, top(-0.06)], [0.04, top(0.04) + FIN_INSET + 0.12], [0.12, top(0.12)]]];
    case "rear":
      return [[[-0.42, top(-0.42)], [-0.36, top(-0.36) + FIN_INSET + 0.12], [-0.24, top(-0.24)]]];
    case "sail":
      return [[[-0.04, top(-0.04)], [0.08, top(0.08) + FIN_INSET + 0.3], [0.16, top(0.16)]]];
    case "long": {
      const tris: [number, number][][] = [];
      for (let x = -0.4; x < 0.18; x += 0.08) tris.push([[x, top(x)], [x + 0.04, top(x + 0.04) + FIN_INSET + 0.06], [x + 0.08, top(x + 0.08)]], [[x, top(x)], [x + 0.08, top(x + 0.08)], [x + 0.04, top(x + 0.04) + FIN_INSET + 0.06]]);
      return tris;
    }
    case "spiny": {
      const tris: [number, number][][] = [];
      for (let i = 0; i < 9; i++) {
        const x = 0.2 - i * 0.05;
        tris.push([[x, top(x)], [x - 0.012, top(x) + FIN_INSET + 0.12 - Math.abs(i - 3) * 0.008], [x - 0.05, top(x - 0.05) + FIN_INSET + 0.045]], [[x, top(x)], [x - 0.05, top(x - 0.05) + FIN_INSET + 0.045], [x - 0.05, top(x - 0.05)]]);
      }
      return tris;
    }
  }
}

function analTris(look: FishLook): [number, number][][] {
  const bot = (x: number) => edgeAt(look, x, false) + FIN_INSET;
  switch (look.anal) {
    case "short":
      return [[[-0.3, bot(-0.3)], [-0.12, bot(-0.12) - FIN_INSET - 0.09], [-0.05, bot(-0.05)]]];
    case "rear":
      return [[[-0.42, bot(-0.42)], [-0.34, bot(-0.34) - FIN_INSET - 0.1], [-0.24, bot(-0.24)]]];
    case "long": {
      const tris: [number, number][][] = [];
      for (let x = -0.42; x < 0.04; x += 0.08) tris.push([[x, bot(x)], [x + 0.04, bot(x + 0.04) - FIN_INSET - 0.05], [x + 0.08, bot(x + 0.08)]]);
      return tris;
    }
    case "ribbon": {
      // Featherback: one long wavy fin along the belly that runs into the tail.
      const tris: [number, number][][] = [];
      for (let x = -0.5; x < 0.14; x += 0.04) {
        const depth = FIN_INSET + 0.07 + Math.sin(x * 22) * 0.015;
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
  const body = CreateSphere(`fishBody_${speciesId}`, { segments: 12, diameterX: 1, diameterY: h, diameterZ: look.width }, scene);
  const pos = body.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!;
    let z = pos[i + 2]! * bodyTaper(look, x);
    if (look.mouth === "wide" && x > 0.25) z *= 1 + 0.5 * ((x - 0.25) / 0.25);
    pos[i + 1] = shapeY(look, x, pos[i + 1]!);
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
    // Pectoral fin just behind the gill, swept back and splayed out from the flank.
    const halfW = (x: number) => (look.width / 2) * Math.sqrt(1 - 4 * x * x) * bodyTaper(look, x);
    parts.push(sideFin(scene, `pec${side}`, new Vector3(0.2, -h * 0.1, side * (halfW(0.2) - 0.01)), side, 0.55, h * 0.4, look.fin));
    // Pelvic fin under the belly, pointing down and back.
    const pelvicY = edgeAt(look, 0.08, false) * 0.75;
    parts.push(sideFin(scene, `pelvic${side}`, new Vector3(0.1, pelvicY, side * halfW(0.08) * 0.45), side, 1.15, h * 0.3, look.fin));

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
  const tailBase = Math.max(0.012, edgeAt(look, -0.4, true) * 0.8);
  const tail = finMesh(scene, `fishTail_${speciesId}`, tailTris(look.tail, h, tailBase), 0, look.fin);
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
const UP = new Vector3(0, 1, 0);
type NagaMats = Record<"scales" | "headScales" | "gold" | "flame" | "mouth" | "fang" | "eye" | "pupil", StandardMaterial>;
const nagaMats = new WeakMap<Scene, NagaMats>();

function nagaMaterials(scene: Scene): NagaMats {
  const hit = nagaMats.get(scene);
  if (hit) return hit;
  // Green-gold scales: overlapping arcs, a gold rim on each.
  const scaleTexture = (name: string, uScale: number, vScale: number): DynamicTexture => {
    const tex = new DynamicTexture(name, { width: 64, height: 64 }, scene, true);
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
    tex.uScale = uScale;
    tex.vScale = vScale;
    return tex;
  };
  // The body tube stretches the pattern along its length; heads use it at their own size.
  const tex = scaleTexture("nagaScales", 3, 26);
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
  gold.backFaceCulling = false; // flame plates are single sheets
  const eye = new StandardMaterial("nagaEye", scene);
  eye.diffuseColor = Color3.FromHexString("#FFD23F");
  eye.emissiveColor = Color3.FromHexString("#FF8A00");
  eye.disableLighting = true;
  const pupil = new StandardMaterial("nagaPupil", scene);
  pupil.diffuseColor = Color3.Black();
  pupil.disableLighting = true;
  const headScales = scales.clone("nagaHeadScalesMat");
  headScales.diffuseTexture = scaleTexture("nagaHeadScales", 3, 3);
  const mats = { scales, headScales, gold, flame, mouth, fang, eye, pupil };
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
  const jaws: TransformNode[] = [];
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
    jaws.push(buildNagaHead(scene, head, mats, finish === "normal" ? mats.headScales : skin, add));
  }

  const tangent = new Vector3();
  const normal = new Vector3();
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
        // Stand on the back of the body (perpendicular to it, even where it rears up), leaning back.
        path[i + 1]!.subtractToRef(path[i - 1]!, tangent).normalize();
        UP.subtractToRef(tangent.scale(Vector3.Dot(UP, tangent)), normal).normalize();
        const lean = 0.45;
        const along = normal.scale(Math.cos(lean)).subtract(tangent.scale(Math.sin(lean)));
        orient(f, tangent.scale(Math.cos(lean)).add(normal.scale(Math.sin(lean))), along);
        // The cone's base sits inside the body surface.
        f.position.copyFrom(p).addInPlace(normal.scale(r * 0.75)).addInPlace(along.scale(size / 2));
        f.scaling.set(size * 1.4, size, size * 1.4 * 0.25);
      });
      const neck = path[NAGA_POINTS - 1]!;
      headRoot.position.copyFrom(neck);
      heads.forEach((h, i) => {
        h.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.12;
        h.rotation.y = Math.sin(t * 0.9 + i) * 0.15;
      });
      // Jaws open in a slow roar, each head out of step.
      jaws.forEach((j, i) => {
        j.rotation.z = -0.32 - Math.max(0, Math.sin(t * 1.1 + i * 2.1)) * 0.22;
      });
    },
    dispose() {
      root.dispose(); // naga meshes are its own; shared materials stay cached
    },
  };
}

// ---------- Naga head ----------

/** Point a part: local +x along `dir`, local +y towards `up`. */
function orient(mesh: TransformNode, dir: Vector3, up: Vector3): void {
  const x = dir.normalizeToNew();
  const y = up.subtract(x.scale(Vector3.Dot(x, up))).normalize();
  const z = Vector3.Cross(x, y);
  mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(x, y, z);
}

/**
 * A flame tongue (กนก): a flat, tapering blade along +x whose tip curls towards +y.
 * `curl` is the total turn in radians.
 */
function flameBlade(scene: Scene, len: number, width: number, curl: number): Mesh {
  const n = 9;
  const pts: Vector3[] = [];
  let p = Vector3.Zero();
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push(p);
    const heading = curl * s * s;
    p = p.add(new Vector3(Math.cos(heading), Math.sin(heading), 0).scale(len / n));
  }
  const positions: number[] = [];
  const edge = (i: number, sign: number) => {
    const s = i / n;
    const heading = curl * s * s;
    const w = width * Math.pow(1 - s, 0.85) * (0.55 + 0.45 * Math.sin(Math.min(1, s * 2.2) * Math.PI * 0.5));
    return pts[i]!.add(new Vector3(-Math.sin(heading), Math.cos(heading), 0).scale((sign * w) / 2));
  };
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = [edge(i, 1), edge(i, -1), edge(i + 1, 1), edge(i + 1, -1)];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z);
  }
  const mesh = new Mesh("flameBlade", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, data.indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

/** A curling whisker (หนวด): a thin gold tube sweeping back from the snout and rolling up. */
function whisker(scene: Scene, side: number): Mesh {
  const path: Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    const roll = s * s * 4.2;
    path.push(new Vector3(-0.1 * s + Math.sin(roll) * 0.012 * s, -0.012 * s + (1 - Math.cos(roll)) * 0.014 * s, side * (0.035 * s + 0.008 * Math.sin(s * 3))));
  }
  return CreateTube("whisker", { path, radiusFunction: (i) => 0.0034 * (1 - (i / 14) * 0.75), tessellation: 5, cap: Mesh.CAP_ALL }, scene);
}

/** Naga skull half-extents (before shaping) and the lower jaw's, in head units. */
const SKULL = { x: 0.065, y: 0.03, z: 0.035 };
const JAW = { x: 0.044, y: 0.011, z: 0.024, cx: 0.044, cy: -0.004 };

const skullU = (x: number) => (x + SKULL.x) / (SKULL.x * 2); // 0 back … 1 nose
/** Narrowing towards the snout. */
const skullTaper = (x: number) => 1 - 0.5 * smooth(0.4, 1, skullU(x));
/** Height of a skull vertex after shaping (`z` is already tapered). */
function skullShapeY(x: number, y: number, z: number): number {
  const u = skullU(x);
  if (y > 0) {
    y *= 0.8 - 0.35 * smooth(0.5, 1, u);
    y += 0.014 * Math.exp(-Math.pow((u - 0.42) / 0.12, 2)) * smooth(0.01, 0.03, Math.abs(z)); // brow ridges
  } else {
    y *= 0.55;
  }
  return y + 0.03 * smooth(0.82, 1, u) * smooth(0.82, 1, u); // upturned nose
}
const skullHalfWidth = (x: number) => SKULL.z * Math.sqrt(Math.max(0, 1 - (x / SKULL.x) ** 2)) * skullTaper(x);
/** The skull's top (or underside) surface at (x, z), exactly as the mesh is shaped. */
function skullSurfaceY(x: number, z: number, top: boolean): number {
  const z0 = z / skullTaper(x);
  const r = SKULL.y * Math.sqrt(Math.max(0, 1 - (x / SKULL.x) ** 2 - (z0 / SKULL.z) ** 2));
  return skullShapeY(x, top ? r : -r, z);
}
const jawTaper = (localX: number) => 1 - 0.45 * smooth(-0.02, 0.05, localX);
const jawHalfWidth = (x: number) => JAW.z * Math.sqrt(Math.max(0, 1 - ((x - JAW.cx) / JAW.x) ** 2)) * jawTaper(x - JAW.cx);
/** Top of the lower jaw at (x, z), in hinge space. */
function jawTop(x: number, z: number): number {
  const lx = x - JAW.cx;
  const z0 = z / jawTaper(lx);
  return JAW.cy + JAW.y * Math.sqrt(Math.max(0, 1 - (lx / JAW.x) ** 2 - (z0 / JAW.z) ** 2));
}

/** Place a cone (tip along local +y) so its base sits at `base`, tipped by `roll` around z. */
function seat(cone: Mesh, base: Vector3, roll: number, len: number): void {
  cone.rotation.z = roll;
  cone.position = base.add(new Vector3(-Math.sin(roll), Math.cos(roll), 0).scale(len / 2));
}

/**
 * One naga head, about 0.13 long, facing +x: a sculpted skull with heavy brows, an upturned snout
 * and an open jaw full of fangs, glowing slit eyes, flame brows, curling whiskers, a hood of flame
 * tongues and a tiered Thai crown (ชฎา). Returns the jaw hinge (animated).
 */
function buildNagaHead(scene: Scene, head: TransformNode, mats: NagaMats, skin: StandardMaterial, add: (m: Mesh, mat: StandardMaterial) => Mesh): TransformNode {
  // Skull: a sphere pushed into a wedge — wide brows, narrow snout, nose tip curling up.
  const skull = CreateSphere("skull", { segments: 10, diameterX: SKULL.x * 2, diameterY: SKULL.y * 2, diameterZ: SKULL.z * 2 }, scene);
  const pos = skull.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!;
    const z = pos[i + 2]! * skullTaper(x);
    pos[i + 1] = skullShapeY(x, pos[i + 1]!, z);
    pos[i + 2] = z;
  }
  skull.setVerticesData(VertexBuffer.PositionKind, pos);
  skull.convertToFlatShadedMesh();
  add(skull, skin);
  // Roof of the mouth: a shrunken copy of the skull whose underside shows just below it, red.
  const palate = add(skull.clone("palate"), mats.mouth);
  palate.scaling.set(0.8, 0.5, 0.8);
  palate.position.set(-0.003, -0.0095, 0);

  // Lower jaw on a hinge under the back of the skull; it ends behind the snout tip.
  const hinge = new TransformNode("jawHinge", scene);
  hinge.parent = head;
  hinge.position.set(-0.03, -0.012, 0);
  hinge.rotation.z = -0.35;
  const jaw = CreateSphere("jaw", { segments: 8, diameterX: JAW.x * 2, diameterY: JAW.y * 2, diameterZ: JAW.z * 2 }, scene);
  const jp = jaw.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < jp.length; i += 3) jp[i + 2] = jp[i + 2]! * jawTaper(jp[i]!);
  jaw.setVerticesData(VertexBuffer.PositionKind, jp);
  jaw.convertToFlatShadedMesh();
  add(jaw, skin).parent = hinge;
  jaw.position.set(JAW.cx, JAW.cy, 0);
  // Inside of the mouth: a flatter copy of the jaw whose top shows red within the jaw's rim.
  const tongueBed = add(jaw.clone("mouth"), mats.mouth);
  tongueBed.parent = hinge;
  tongueBed.scaling.set(0.88, 0.6, 0.78);
  tongueBed.position.set(JAW.cx + 0.002, JAW.cy + 0.006, 0);
  // Forked tongue lying in the jaw, the fork just past its tip.
  const tongue = add(CreateBox("tongue", { width: 0.05, height: 0.0025, depth: 0.004 }, scene), mats.mouth);
  tongue.parent = hinge;
  tongue.position.set(JAW.cx + 0.01, jawTop(JAW.cx + 0.01, 0) + 0.001, 0);
  tongue.rotation.z = 0.08;
  for (const z of [-1, 1]) {
    const prong = add(CreateBox("tongueFork", { width: 0.014, height: 0.002, depth: 0.0025 }, scene), mats.mouth);
    prong.parent = hinge;
    prong.position.set(JAW.cx + 0.04, tongue.position.y + 0.003, z * 0.004);
    prong.rotation.set(0, z * 0.55, 0.08);
  }

  for (const side of [-1, 1]) {
    // Upper fangs rooted in the skull's underside, curving down and forward.
    for (const [x, len] of [[0.042, 0.032], [0.018, 0.018]] as const) {
      const z = side * skullHalfWidth(x) * 0.6;
      const fang = add(CreateCylinder("fang", { height: len, diameterTop: 0, diameterBottom: 0.009, tessellation: 5 }, scene), mats.fang);
      seat(fang, new Vector3(x, skullSurfaceY(x, z, false) + 0.004, z), Math.PI + 0.25, len);
    }
    // Lower fangs rooted in the jaw, pointing up.
    const lx = JAW.cx + 0.022;
    const lz = side * jawHalfWidth(lx) * 0.6;
    const low = add(CreateCylinder("fangLow", { height: 0.016, diameterTop: 0, diameterBottom: 0.007, tessellation: 5 }, scene), mats.fang);
    low.parent = hinge;
    seat(low, new Vector3(lx, jawTop(lx, lz) - 0.003, lz), -0.2, 0.016);

    // Glowing eye set into the side of the head under the brow, a black slit pupil.
    const ex = 0.012;
    const ez = side * skullHalfWidth(ex) * 0.8;
    const eye = add(CreateSphere("eye", { segments: 6, diameterX: 0.022, diameterY: 0.013, diameterZ: 0.01 }, scene), mats.eye);
    eye.position.set(ex, 0.011, ez);
    eye.rotation.set(0, side * 0.45, side * -0.15);
    const slit = add(CreateBox("pupil", { width: 0.003, height: 0.012, depth: 0.004 }, scene), mats.pupil);
    slit.position.set(ex + 0.002, 0.011, ez + side * 0.0045);
    slit.rotation.y = side * 0.45;

    // Flame brows rooted on the brow ridge, hugging the head as they sweep back.
    const bz = side * 0.014;
    const brow = add(flameBlade(scene, 0.062, 0.015, 1.2), mats.gold);
    brow.position.set(0.02, skullSurfaceY(0.02, bz, true) - 0.003, bz);
    orient(brow, new Vector3(-1, 0.28, side * 0.42), new Vector3(0, 1, 0));

    // Whiskers from the corners of the snout.
    const w = add(whisker(scene, side), mats.gold);
    w.position.set(0.05, -0.002, side * skullHalfWidth(0.05) * 0.75);

    // Cheek flames fanning back from below the eye.
    const cheek = add(flameBlade(scene, 0.05, 0.014, -1.1), mats.flame);
    cheek.position.set(-0.01, -0.005, side * skullHalfWidth(-0.01) * 0.8);
    orient(cheek, new Vector3(-1, -0.35, side * 0.7), new Vector3(0, -1, 0));
  }

  // Hood: a fan of flame tongues behind the head, gold outside and red within, tips curling back.
  for (let k = 0; k < 7; k++) {
    const a = -1 + (k / 6) * 2; // an arc over the top of the head
    const outer = add(flameBlade(scene, 0.085 - Math.abs(a) * 0.02, 0.03, -1.2), mats.gold);
    outer.position.set(-0.045, 0.006, 0);
    orient(outer, new Vector3(-0.45, Math.cos(a), Math.sin(a)), new Vector3(-1, 0, 0));
    if (k % 2 === 0) {
      const inner = add(flameBlade(scene, 0.06 - Math.abs(a) * 0.012, 0.02, -1.4), mats.flame);
      inner.position.set(-0.04, 0.008, 0);
      orient(inner, new Vector3(-0.3, Math.cos(a), Math.sin(a)), new Vector3(-1, 0, 0));
    }
  }

  // Tiered Thai crown (ชฎา): stacked rings narrowing to a slim spire with a red jewel.
  const crownBase = skullSurfaceY(-0.012, 0, true) - 0.003;
  let y = crownBase;
  for (let tier = 0; tier < 4; tier++) {
    const d = 0.028 - tier * 0.005;
    const ring = add(CreateCylinder("crownTier", { height: 0.008, diameterTop: d * 0.8, diameterBottom: d, tessellation: 10 }, scene), mats.gold);
    ring.position.set(-0.012, y + 0.004, 0);
    y += 0.0075;
  }
  const spire = add(CreateCylinder("crownSpire", { height: 0.034, diameterTop: 0, diameterBottom: 0.009, tessellation: 8 }, scene), mats.gold);
  spire.position.set(-0.012, y + 0.017, 0);
  const jewel = add(CreateIcoSphere("crownJewel", { radius: 0.0055, subdivisions: 1 }, scene), mats.flame);
  jewel.position.set(-0.012, crownBase + 0.006, 0.0125);
  return hinge;
}
