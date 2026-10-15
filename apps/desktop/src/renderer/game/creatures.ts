import type { Scene } from "@babylonjs/core/scene";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { hash01 } from "./materials";
import { finMesh, hexRgb, mix, paintFaces, sideFin, smooth, tailTris, type Rgb } from "./modelKit";

/**
 * The big ones, each built from its own parts rather than the fish parameter table: shark,
 * megalodon (open jaws full of teeth), orca and blue whale (horizontal flukes), the Bloop (a pale
 * deep-sea giant whose head is one enormous gaping mouth lined with teeth), El Gran Maja (a dark-blue whale-shaped titan with a huge black mouth, jagged teeth and
 * a row of glowing cyan eyes), Nessie (a cheerful orange plesiosaur), Godzilla (an upright kaiju with glowing back plates) and the Sea
 * Eater (a worm-like body that is all mouth, rings of needle teeth, on four long spindly legs).
 *
 * Like the fish, models face +x, are about 1 unit long and centred on the origin. Static parts
 * merge into one vertex-coloured mesh; tails, jaws and legs are moving parts on pivots; glowing
 * parts (eyes, plates) keep their light under any mutation.
 */

export interface MovingPart {
  /** Built in the pivot's local space. */
  mesh: Mesh;
  pivot: Vector3;
  axis: "x" | "y" | "z";
  amp: number;
  speed: number;
  phase?: number;
  /** Glowing bits that move with this part. */
  glow?: Mesh;
}

export interface CreatureTemplate {
  body: Mesh;
  moving: MovingPart[];
  glow?: Mesh;
  glowColor?: string;
}

type Paint = string | Rgb | ((x: number, y: number, z: number) => Rgb);

// ---------- Building blocks ----------

function finish(mesh: Mesh, paint: Paint): Mesh {
  mesh.bakeCurrentTransformIntoVertices();
  mesh.convertToFlatShadedMesh();
  if (typeof paint === "function") paintFaces(mesh, paint);
  else {
    const solid = typeof paint === "string" ? hexRgb(paint) : paint;
    paintFaces(mesh, () => solid);
  }
  return mesh;
}

/** An ellipsoid with radii r, reshaped in its own space by `deform`, then placed. */
function ell(scene: Scene, r: [number, number, number], at: Vector3, paint: Paint, opts: { seg?: number; rot?: Vector3; deform?: (p: Vector3) => void } = {}): Mesh {
  const m = CreateSphere("part", { segments: opts.seg ?? 10, diameterX: r[0] * 2, diameterY: r[1] * 2, diameterZ: r[2] * 2 }, scene);
  if (opts.deform) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    const p = new Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      p.set(pos[i]!, pos[i + 1]!, pos[i + 2]!);
      opts.deform(p);
      pos[i] = p.x;
      pos[i + 1] = p.y;
      pos[i + 2] = p.z;
    }
    m.setVerticesData(VertexBuffer.PositionKind, pos);
  }
  if (opts.rot) m.rotation.copyFrom(opts.rot);
  m.position.copyFrom(at);
  return finish(m, paint);
}

/** A cone from `base` to `tip` (teeth, claws, spikes). */
function cone(scene: Scene, base: Vector3, tip: Vector3, radius: number, paint: Paint, tessellation = 5): Mesh {
  const d = tip.subtract(base);
  const len = d.length();
  const m = CreateCylinder("cone", { height: len, diameterTop: 0, diameterBottom: radius * 2, tessellation }, scene);
  const q = new Quaternion();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.normalizeToNew(), q);
  m.rotationQuaternion = q;
  m.position = base.add(d.scale(0.5));
  return finish(m, paint);
}

/** A tube along `path`, tapering from r0 to r1 (legs, arms, tails, frowns). */
function tube(scene: Scene, path: Vector3[], r0: number, r1: number, paint: Paint, tessellation = 8): Mesh {
  const n = path.length - 1;
  const m = CreateTube("tube", { path, radiusFunction: (i) => r0 + (r1 - r0) * (i / n), tessellation, cap: Mesh.CAP_ALL }, scene);
  return finish(m, paint);
}

/** A smooth path through control points (Catmull-Rom), for limbs. */
function curve(points: Vector3[], steps = 6): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < steps; k++) out.push(Vector3.CatmullRom(points[Math.max(0, i - 1)]!, points[i]!, points[i + 1]!, points[Math.min(points.length - 1, i + 2)]!, k / steps));
  }
  out.push(points[points.length - 1]!.clone());
  return out;
}

/** A flat fin in the x/y plane, optionally turned and moved. */
function flatFin(scene: Scene, tris: [number, number][][], paint: string, opts: { rot?: Vector3; at?: Vector3; z?: number } = {}): Mesh {
  const m = finMesh(scene, "fin", tris, opts.z ?? 0, paint);
  if (opts.rot) m.rotation.copyFrom(opts.rot);
  if (opts.at) m.position.copyFrom(opts.at);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

/** Horizontal tail flukes (whales), in the x/z plane, around the pivot. */
function flukes(scene: Scene, span: number, len: number, base: number, paint: string): Mesh {
  const tris: [number, number][][] = [
    [[0.06, base], [0, base], [0, -base]],
    [[0.06, base], [0, -base], [0.06, -base]],
  ];
  for (const s of [1, -1]) {
    tris.push([[0, s * base], [-len * 0.8, s * span], [-len, s * span * 0.82]], [[0, s * base], [-len, s * span * 0.82], [-len * 0.62, 0]]);
  }
  tris.push([[0, base], [-len * 0.62, 0], [0, -base]]);
  return flatFin(scene, tris, paint, { rot: new Vector3(Math.PI / 2, 0, 0) });
}

/** Read a built body's surface back from its vertices, to seat fins, teeth and eyes on it. */
function probe(mesh: Mesh) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const near = (x: number, band: number, pick: (vx: number, vy: number, vz: number) => number | null, best: (a: number, b: number) => number, start: number) => {
    let v = start;
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i]! - x) > band) continue;
      const got = pick(pos[i]!, pos[i + 1]!, pos[i + 2]!);
      if (got !== null) v = best(v, got);
    }
    return v === start ? 0 : v;
  };
  return {
    top: (x: number) => near(x, 0.03, (_x, y, z) => (Math.abs(z) < 0.03 ? y : null), Math.max, -1e9),
    bottom: (x: number) => near(x, 0.03, (_x, y, z) => (Math.abs(z) < 0.03 ? y : null), Math.min, 1e9),
    halfWidth: (x: number, y: number) => near(x, 0.03, (_x, vy, z) => (Math.abs(vy - y) < 0.03 ? Math.abs(z) : null), Math.max, -1e9),
  };
}

function merge(name: string, parts: Mesh[]): Mesh {
  const m = Mesh.MergeMeshes(parts, true)!;
  m.name = name;
  m.isVisible = false;
  return m;
}

function hide(m: Mesh): Mesh {
  m.isVisible = false;
  return m;
}

const rough = (base: Rgb, dark: Rgb, x: number, y: number, z: number, k = 60) =>
  mix(base, dark, hash01(Math.floor(x * k) * 31 + Math.floor(y * k) * 17 + Math.floor(z * k) * 7) * 0.55);

// ---------- Sharks ----------

function sharkLike(scene: Scene, id: string, mega: boolean): CreatureTemplate {
  const ry = mega ? 0.14 : 0.12;
  const rz = mega ? 0.13 : 0.11;
  const top = hexRgb(mega ? "#3D4953" : "#5F7180");
  const under = hexRgb(mega ? "#C9CCC6" : "#F1F1EC");
  const gill = mix(top, [0, 0, 0], 0.5);
  const scar = mix(top, [1, 1, 1], 0.35);
  const fin = mega ? "#36424C" : "#566876";
  const body = ell(
    scene,
    [0.5, ry, rz],
    Vector3.Zero(),
    (x, y, z) => {
      let c = y > -0.012 + 0.012 * Math.sin(x * 35) ? top : under;
      if (x > 0.17 && x < 0.29 && Math.abs(y) < 0.05 && Math.abs(z) > 0.05 && (x * 45) % 1 < 0.28) c = gill;
      if (mega && y > 0 && hash01(Math.floor(x * 30) * 13 + Math.floor(z * 30)) > 0.93) c = scar;
      return c;
    },
    {
      seg: 16,
      deform: (p) => {
        const t = p.x < 0 ? 1 - Math.pow(-p.x / 0.5, 1.5) * 0.85 : 1 - Math.pow(p.x / 0.5, 2) * 0.3;
        p.y *= t;
        p.z *= t;
        if (p.x > 0.3) p.y += (p.x - 0.3) * 0.07; // the snout points slightly up
        if (p.y < 0 && p.x > 0.15) p.y *= 0.85;
      },
    },
  );
  const s = probe(body);
  const parts: Mesh[] = [body];
  const inset = 0.03;
  parts.push(flatFin(scene, [[[-0.07, s.top(-0.07) - inset], [0.12, s.top(0.12) - inset], [-0.1, s.top(0) + (mega ? 0.22 : 0.2)]]], fin));
  parts.push(flatFin(scene, [[[-0.33, s.top(-0.33) - 0.02], [-0.27, s.top(-0.27) - 0.02], [-0.34, s.top(-0.3) + 0.045]]], fin));
  parts.push(flatFin(scene, [[[-0.3, s.bottom(-0.3) + 0.02], [-0.24, s.bottom(-0.24) + 0.02], [-0.31, s.bottom(-0.27) - 0.04]]], fin));
  for (const side of [-1, 1]) {
    const yPec = s.bottom(0.14) * 0.5;
    parts.push(sideFin(scene, "pec", new Vector3(0.16, yPec, side * (s.halfWidth(0.16, yPec) - 0.01)), side, 1.05, mega ? 0.3 : 0.26, fin));
    parts.push(sideFin(scene, "pelvic", new Vector3(-0.12, s.bottom(-0.12) * 0.7, side * s.halfWidth(-0.12, s.bottom(-0.12) * 0.7) * 0.5), side, 1.2, 0.08, fin));
    const ey = s.top(0.36) * 0.35;
    parts.push(ell(scene, [0.014, 0.014, 0.01], new Vector3(0.36, ey, side * (s.halfWidth(0.36, ey) - 0.003)), "#0B0B0D"));
  }

  const moving: MovingPart[] = [];
  if (mega) {
    // Open jaws: a dark red mouth under the snout, rows of teeth above and on the moving jaw.
    parts.push(ell(scene, [0.14, 0.04, 0.075], new Vector3(0.31, -0.075, 0), "#4A0F14"));
    for (const side of [-1, 1]) {
      for (let x = 0.24; x <= 0.45; x += 0.026) {
        const y = s.bottom(x) + 0.012;
        const z = side * Math.max(0.01, s.halfWidth(x, y) * 0.82);
        const len = 0.034 + hash01(Math.round(x * 100) + side) * 0.018;
        parts.push(cone(scene, new Vector3(x, y, z), new Vector3(x + 0.006, y - len, z * 0.92), 0.008, "#F4F0E4", 4));
      }
    }
    const pivot = new Vector3(0.17, -0.08, 0);
    const jawParts: Mesh[] = [ell(scene, [0.15, 0.03, 0.085], new Vector3(0.13, -0.015, 0), under, { rot: new Vector3(0, 0, -0.38) })];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const lx = 0.06 + k * 0.03;
        const base = new Vector3(lx, 0.012 - lx * 0.38, side * (0.07 - k * 0.006));
        jawParts.push(cone(scene, base, base.add(new Vector3(-0.004, 0.03 + (k % 2) * 0.01, -side * 0.004)), 0.007, "#F4F0E4", 4));
      }
    }
    moving.push({ mesh: hide(merge(`${id}Jaw`, jawParts)), pivot, axis: "z", amp: 0.1, speed: 0.6 });
  } else {
    // Closed mouth with a few teeth showing under the snout.
    for (const side of [-1, 1]) {
      for (let x = 0.3; x <= 0.42; x += 0.03) {
        const y = s.bottom(x) + 0.006;
        const z = side * Math.max(0.008, s.halfWidth(x, y) * 0.75);
        parts.push(cone(scene, new Vector3(x, y, z), new Vector3(x + 0.004, y - 0.016, z), 0.005, "#F4F0E4", 4));
      }
    }
  }
  const b = Math.max(0.012, s.top(-0.42) * 0.8);
  moving.push({ mesh: hide(finMesh(scene, `${id}Tail`, tailTris("shark", ry * 2, b), 0, fin)), pivot: new Vector3(-0.44, 0, 0), axis: "y", amp: 0.4, speed: 2.5 });
  return { body: merge(id, parts), moving };
}

// ---------- Whales ----------

function orca(scene: Scene): CreatureTemplate {
  const black = hexRgb("#121417");
  const white = hexRgb("#F4F4F0");
  const saddle = hexRgb("#868A90");
  const body = ell(
    scene,
    [0.5, 0.14, 0.13],
    Vector3.Zero(),
    (x, y, z) => {
      const belly = y < -0.035 + 0.06 * Math.exp(-Math.pow((x + 0.18) / 0.07, 2)) && x > -0.34;
      const patch = Math.abs(z) > 0.04 && Math.pow((x - 0.29) / 0.075, 2) + Math.pow((y - 0.04) / 0.024, 2) < 1;
      if (belly || patch) return white;
      if (y > 0.085 && x > -0.14 && x < 0.02) return saddle;
      return black;
    },
    {
      seg: 16,
      deform: (p) => {
        const t = p.x < 0 ? 1 - Math.pow(-p.x / 0.5, 1.4) * 0.85 : 1 - Math.pow(p.x / 0.5, 3) * 0.5;
        p.y *= t;
        p.z *= t;
      },
    },
  );
  const s = probe(body);
  const parts: Mesh[] = [body];
  parts.push(flatFin(scene, [[[-0.04, s.top(-0.04) - 0.03], [0.09, s.top(0.09) - 0.03], [-0.01, s.top(0.02) + 0.27]]], "#121417"));
  for (const side of [-1, 1]) {
    const y = s.bottom(0.2) * 0.6;
    parts.push(sideFin(scene, "pec", new Vector3(0.22, y, side * (s.halfWidth(0.22, y) - 0.01)), side, 1.25, 0.17, "#121417"));
  }
  const tailParts = [ell(scene, [0.07, 0.025, 0.03], new Vector3(0.03, 0, 0), "#121417"), flukes(scene, 0.17, 0.15, 0.025, "#121417")];
  return { body: merge("orca", parts), moving: [{ mesh: hide(merge("orcaFlukes", tailParts)), pivot: new Vector3(-0.45, 0, 0), axis: "z", amp: 0.3, speed: 2 }] };
}

function blueWhale(scene: Scene): CreatureTemplate {
  const base = hexRgb("#4E6C87");
  const mottle = hexRgb("#7E98AE");
  const grooveA = hexRgb("#A9BCCB");
  const grooveB = hexRgb("#8197AA");
  const mouth = hexRgb("#22303B");
  const body = ell(
    scene,
    [0.5, 0.085, 0.095],
    Vector3.Zero(),
    (x, y, z) => {
      if (Math.abs(y + 0.014) < 0.006 && x > 0.2 && Math.abs(z) > 0.03) return mouth;
      if (y < -0.03 && x > -0.12) return Math.sin(z * 150) > 0.2 ? grooveA : grooveB;
      return hash01(Math.floor(x * 40) * 7 + Math.floor(y * 40) * 3 + Math.floor(z * 40)) > 0.72 ? mottle : base;
    },
    {
      seg: 18,
      deform: (p) => {
        const t = p.x < 0 ? 1 - Math.pow(-p.x / 0.5, 1.3) * 0.85 : 1 - Math.pow(p.x / 0.5, 2) * 0.2;
        p.y *= t;
        p.z *= t;
        if (p.y > 0 && p.x > 0.15) p.y *= 1 - 0.35 * ((p.x - 0.15) / 0.35); // broad, flat head
      },
    },
  );
  const s = probe(body);
  const parts: Mesh[] = [body];
  parts.push(flatFin(scene, [[[-0.31, s.top(-0.31) - 0.02], [-0.24, s.top(-0.24) - 0.02], [-0.3, s.top(-0.27) + 0.04]]], "#425E78"));
  for (const side of [-1, 1]) {
    const y = s.bottom(0.18) * 0.55;
    parts.push(sideFin(scene, "pec", new Vector3(0.18, y, side * (s.halfWidth(0.18, y) - 0.008)), side, 0.95, 0.2, "#4A6782"));
    parts.push(ell(scene, [0.012, 0.004, 0.006], new Vector3(0.3, s.top(0.3), side * 0.012), "#1E2A34"));
    parts.push(ell(scene, [0.007, 0.007, 0.005], new Vector3(0.33, -0.004, side * (s.halfWidth(0.33, -0.004) - 0.002)), "#101418"));
  }
  const tailParts = [ell(scene, [0.06, 0.02, 0.025], new Vector3(0.03, 0, 0), "#4A6782"), flukes(scene, 0.16, 0.13, 0.02, "#4A6782")];
  return { body: merge("whale", parts), moving: [{ mesh: hide(merge("whaleFlukes", tailParts)), pivot: new Vector3(-0.46, 0, 0), axis: "z", amp: 0.25, speed: 1.6 }] };
}

// ---------- Bloop ----------

function bloop(scene: Scene): CreatureTemplate {
  const skin = hexRgb("#A7B5A6");
  const vein = hexRgb("#7E8E7F");
  const belly = hexRgb("#C9D2C5");
  const scar = hexRgb("#DCE3D8");
  const throat = hexRgb("#0C0405");
  // The jaws gape wider towards the front: the upper half lifts, the lower half drops, and the
  // skin stretched across the gap between them becomes the black throat.
  const open = (x: number) => smooth(0.0, 0.46, x);
  const UP = 0.15;
  const DOWN = 0.19;
  const inMouth = (x: number, y: number) => open(x) > 0.05 && y < UP * open(x) - 0.004 && y > -DOWN * open(x) + 0.004;
  const body = ell(
    scene,
    [0.5, 0.17, 0.16],
    Vector3.Zero(),
    (x, y, z) => {
      if (inMouth(x, y)) return throat;
      if (hash01(Math.floor(x * 50) * 11 + Math.floor(z * 50) * 5) > 0.95) return scar;
      const base = y < -0.06 - DOWN * open(x) ? belly : skin;
      return Math.sin(x * 60 + Math.sin(y * 40) * 2 + z * 30) > 0.75 ? vein : base;
    },
    {
      seg: 20,
      deform: (p) => {
        const t = p.x < 0 ? 1 - Math.pow(-p.x / 0.5, 1.3) * 0.86 : 1 - Math.pow(p.x / 0.5, 3) * 0.25;
        p.y *= t;
        p.z *= t;
        p.y += p.y >= 0 ? UP * open(p.x) : -DOWN * open(p.x);
      },
    },
  );
  const s = probe(body);
  const parts: Mesh[] = [body];
  for (const side of [-1, 1]) {
    // Rows of teeth along both jaws, pointing across the gape.
    for (let x = 0.08, k = 0; x <= 0.47; x += 0.03, k++) {
      const o = open(x);
      const len = (0.02 + hash01(k * 7 + side) * 0.02) * (0.6 + o);
      const yu = UP * o;
      const zu = side * Math.max(0.006, s.halfWidth(x, yu) * 0.9);
      parts.push(cone(scene, new Vector3(x, yu + 0.004, zu), new Vector3(x + 0.004, yu - len, zu * 0.9), 0.006, "#E9E4D6", 4));
      const yl = -DOWN * o;
      const zl = side * Math.max(0.006, s.halfWidth(x, yl) * 0.9);
      parts.push(cone(scene, new Vector3(x, yl - 0.004, zl), new Vector3(x + 0.004, yl + len * 0.9, zl * 0.9), 0.006, "#E9E4D6", 4));
    }
    // A small dark eye high on the head.
    const ex = 0.3;
    const ey = UP * open(ex) + 0.07;
    parts.push(ell(scene, [0.014, 0.012, 0.008], new Vector3(ex, ey, side * (s.halfWidth(ex, ey) - 0.002)), "#0B0D0C"));
    const py = s.bottom(0.0) * 0.55;
    parts.push(sideFin(scene, "pec", new Vector3(0.02, py, side * (s.halfWidth(0.02, py) - 0.01)), side, 1.0, 0.18, "#8F9E8F"));
  }
  parts.push(flatFin(scene, [[[-0.3, s.top(-0.3) - 0.02], [-0.22, s.top(-0.22) - 0.02], [-0.29, s.top(-0.26) + 0.05]]], "#8F9E8F"));
  const tailParts = [ell(scene, [0.06, 0.025, 0.028], new Vector3(0.03, 0, 0), "#8F9E8F"), flukes(scene, 0.17, 0.14, 0.024, "#8F9E8F")];
  return { body: merge("bloop", parts), moving: [{ mesh: hide(merge("bloopFlukes", tailParts)), pivot: new Vector3(-0.46, 0, 0), axis: "z", amp: 0.25, speed: 1.4 }] };
}

// ---------- El Gran Maja ----------

function elGranMaja(scene: Scene): CreatureTemplate {
  const back = hexRgb("#1A4470");
  const side = hexRgb("#1E4C7A");
  const belly = hexRgb("#29608F");
  const black = hexRgb("#050608");
  // The mouth: an ellipse on the side of the huge head.
  const mouthC = { x: 0.27, y: -0.025, a: 0.25, b: 0.09 };
  const inMouth = (x: number, y: number) => Math.pow((x - mouthC.x) / mouthC.a, 2) + Math.pow((y - mouthC.y) / mouthC.b, 2) < 1;
  const mouthEdge = (x: number, sign: number) => mouthC.y + sign * mouthC.b * Math.sqrt(Math.max(0, 1 - Math.pow((x - mouthC.x) / mouthC.a, 2)));
  const body = ell(
    scene,
    [0.5, 0.2, 0.17],
    Vector3.Zero(),
    (x, y) => (inMouth(x, y) ? black : y > 0.1 ? back : y > -0.02 ? side : belly),
    {
      seg: 20,
      deform: (p) => {
        const t = p.x > 0 ? 1 - Math.pow(p.x / 0.5, 4) * 0.4 : 1 - Math.pow(-p.x / 0.5, 1.25) * 0.88;
        p.y *= t;
        p.z *= t;
        if (p.x < -0.05) p.y += 0.28 * Math.pow((-p.x - 0.05) / 0.45, 2); // the tail sweeps up
      },
    },
  );
  const s = probe(body);
  const parts: Mesh[] = [body];
  const glowParts: Mesh[] = [];
  for (const sd of [-1, 1]) {
    // Jagged white teeth along the top and bottom of the mouth, flat on the flank.
    for (let x = 0.07, k = 0; x <= 0.44; x += 0.042, k++) {
      const len = 0.022 + hash01(k * 3 + (sd > 0 ? 1 : 0)) * 0.03;
      const yt = mouthEdge(x, 1) - 0.004;
      const zt = sd * (s.halfWidth(x, yt) + 0.004);
      parts.push(flatFin(scene, [[[x - 0.019, yt], [x + 0.019, yt], [x + 0.004, yt - len]]], "#ECE8E0", { z: zt }));
      const yb = mouthEdge(x + 0.02, -1) + 0.004;
      const zb = sd * (s.halfWidth(x + 0.02, yb) + 0.004);
      parts.push(flatFin(scene, [[[x + 0.002, yb], [x + 0.036, yb], [x + 0.021, yb + len * 0.75]]], "#ECE8E0", { z: zb }));
    }
    // A row of glowing cyan eyes above the mouth.
    const eyes: [number, number][] = [[0.11, 0.03], [0.18, 0.028], [0.24, 0.02], [0.29, 0.018], [0.35, 0.022], [0.41, 0.026]];
    for (const [x, r] of eyes) {
      const y = mouthEdge(x, 1) + 0.035;
      const z = sd * (s.halfWidth(x, y) - r * 0.4);
      glowParts.push(ell(scene, [r, r, r * 0.6], new Vector3(x, y, z), "#5FF3FF", { seg: 8 }));
    }
    const py = s.bottom(0.0) * 0.6;
    parts.push(sideFin(scene, "pec", new Vector3(0.02, py, sd * (s.halfWidth(0.02, py) - 0.01)), sd, 1.0, 0.14, "#173E66"));
  }
  // A forked tail at the top of the upward sweep.
  const tail = finMesh(scene, "majaTail", tailTris("fork", 0.3, 0.025), 0, "#1A4470");
  tail.rotation.z = -0.8;
  tail.bakeCurrentTransformIntoVertices();
  return {
    body: merge("elGranMaja", parts),
    glow: merge("elGranMajaEyes", glowParts),
    glowColor: "#5FF3FF",
    moving: [{ mesh: hide(tail), pivot: new Vector3(-0.47, s.top(-0.47) - 0.03, 0), axis: "y", amp: 0.35, speed: 1.6 }],
  };
}

// ---------- Godzilla ----------

/** A jagged leaf-shaped dorsal plate, upright in the x/y plane, `h` tall. */
function plate(h: number): [number, number][][] {
  const w = h * 0.55;
  const rim: [number, number][] = [[-w, 0], [-w * 0.75, h * 0.35], [-w * 0.45, h * 0.3], [-w * 0.3, h * 0.75], [0, h * 0.62], [w * 0.15, h], [w * 0.35, h * 0.55], [w * 0.7, h * 0.6], [w, 0]];
  const tris: [number, number][][] = [];
  for (let i = 0; i < rim.length - 1; i++) tris.push([[0, -h * 0.15], rim[i]!, rim[i + 1]!]);
  return tris;
}

function godzilla(scene: Scene): CreatureTemplate {
  const skin = hexRgb("#2D3135");
  const dark = hexRgb("#1A1C1F");
  const belly = hexRgb("#4E4A42");
  const paint = (x: number, y: number, z: number) => rough(Math.abs(z) < 0.05 && x > 0.08 ? belly : skin, dark, x, y, z);
  const parts: Mesh[] = [];
  parts.push(ell(scene, [0.15, 0.25, 0.14], new Vector3(0.03, 0, 0), paint, { rot: new Vector3(0, 0, -0.3), seg: 12 }));
  parts.push(ell(scene, [0.08, 0.1, 0.075], new Vector3(0.13, 0.2, 0), paint, { rot: new Vector3(0, 0, -0.6) }));
  parts.push(ell(scene, [0.085, 0.05, 0.055], new Vector3(0.2, 0.28, 0), paint));
  parts.push(ell(scene, [0.065, 0.03, 0.042], new Vector3(0.27, 0.272, 0), paint));
  parts.push(ell(scene, [0.055, 0.018, 0.035], new Vector3(0.255, 0.238, 0), paint, { rot: new Vector3(0, 0, -0.25) }));
  parts.push(ell(scene, [0.05, 0.012, 0.03], new Vector3(0.26, 0.252, 0), "#3A0C0C"));
  for (const side of [-1, 1]) {
    parts.push(ell(scene, [0.009, 0.007, 0.006], new Vector3(0.245, 0.3, side * 0.042), "#E8C860"));
    for (let k = 0; k < 3; k++) parts.push(cone(scene, new Vector3(0.24 + k * 0.022, 0.26, side * 0.022), new Vector3(0.242 + k * 0.022, 0.245, side * 0.022), 0.004, "#E8E2D2", 4));
    // Small arms with claws.
    const arm = curve([new Vector3(0.12, 0.09, side * 0.1), new Vector3(0.2, 0.03, side * 0.13), new Vector3(0.25, -0.02, side * 0.11)]);
    parts.push(tube(scene, arm, 0.03, 0.018, paint, 7));
    for (let k = -1; k <= 1; k++) parts.push(cone(scene, new Vector3(0.25, -0.02, side * 0.11 + k * 0.01), new Vector3(0.28, -0.05, side * 0.11 + k * 0.012), 0.006, "#D8D0C0", 4));
    // Thick legs and feet.
    parts.push(ell(scene, [0.09, 0.14, 0.08], new Vector3(0.0, -0.17, side * 0.11), paint));
    parts.push(ell(scene, [0.055, 0.12, 0.055], new Vector3(0.02, -0.31, side * 0.12), paint));
    parts.push(ell(scene, [0.085, 0.03, 0.062], new Vector3(0.05, -0.41, side * 0.12), paint));
    for (let k = -1; k <= 1; k++) parts.push(cone(scene, new Vector3(0.12, -0.41, side * 0.12 + k * 0.025), new Vector3(0.15, -0.43, side * 0.12 + k * 0.03), 0.01, "#D8D0C0", 4));
  }
  // Glowing dorsal plates in three rows down the back, the middle row tallest.
  const glow: Mesh[] = [];
  for (let k = 0; k < 9; k++) {
    const s = k / 8;
    const x = 0.12 - s * 0.26;
    const y = 0.25 - s * 0.36;
    const h = 0.05 + Math.sin(s * Math.PI) * 0.07;
    glow.push(flatFin(scene, plate(h), "#BFE8FF", { rot: new Vector3(0, 0, 0.5), at: new Vector3(x - 0.02, y + 0.02, 0) }));
    for (const side of [-1, 1]) glow.push(flatFin(scene, plate(h * 0.65), "#BFE8FF", { rot: new Vector3(side * 0.35, 0, 0.5), at: new Vector3(x - 0.03, y, side * 0.035) }));
  }
  // The tail swings from the hips: a long tapering tube curving down, with plates along it.
  const tailPath: Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    tailPath.push(new Vector3(-0.42 * s, -0.26 * Math.pow(s, 1.2) + 0.04 * Math.sin(Math.PI * s), 0));
  }
  const tail = finish(CreateTube("tail", { path: tailPath, radiusFunction: (i) => 0.085 * Math.pow(1 - i / 14, 0.9) + 0.008, tessellation: 9, cap: Mesh.CAP_ALL }, scene), paint);
  const tailGlow: Mesh[] = [];
  for (let k = 1; k < 7; k++) {
    const p = tailPath[k * 2]!;
    const r = 0.085 * Math.pow(1 - (k * 2) / 14, 0.9);
    tailGlow.push(flatFin(scene, plate(0.03 + r * 0.5), "#BFE8FF", { rot: new Vector3(0, 0, 0.4), at: new Vector3(p.x, p.y + r * 0.85, 0) }));
  }
  return {
    body: merge("godzilla", parts),
    glow: merge("godzillaPlates", glow),
    glowColor: "#7FD0FF",
    moving: [{ mesh: hide(tail), pivot: new Vector3(-0.08, -0.12, 0), axis: "y", amp: 0.25, speed: 1.1, glow: hide(merge("godzillaTailPlates", tailGlow)) }],
  };
}

// ---------- Sea Eater ----------

function seaEater(scene: Scene): CreatureTemplate {
  const bark = hexRgb("#3E3B3F");
  const barkDark = hexRgb("#232124");
  const paint = (x: number, y: number, z: number) => rough(bark, barkDark, x, y, z, 80);
  const parts: Mesh[] = [];
  // The body: a fat worm whose blunt front end is all mouth.
  parts.push(
    ell(scene, [0.36, 0.2, 0.19], new Vector3(-0.06, 0.05, 0), paint, {
      seg: 16,
      deform: (p) => {
        if (p.x > 0.18) p.x = 0.18 + (p.x - 0.18) * 0.35;
        p.y -= 0.1 * smooth(-0.1, -0.36, p.x); // the rear end sinks
      },
    }),
  );
  const mouth = new Vector3(0.2, 0.08, 0);
  const lip = CreateTorus("lip", { diameter: 0.44, thickness: 0.07, tessellation: 32 }, scene);
  lip.rotation.z = Math.PI / 2;
  lip.scaling.set(1, 1.35, 1);
  lip.position.copyFrom(mouth);
  parts.push(finish(lip, paint));
  // Throat: dark red, then black deep inside.
  // The lip flares out from the body, so a collar of skin joins them.
  parts.push(ell(scene, [0.1, 0.27, 0.21], mouth.add(new Vector3(-0.07, 0, 0)), paint));
  parts.push(ell(scene, [0.04, 0.27, 0.2], mouth.add(new Vector3(-0.015, 0, 0)), "#3A0A0C"));
  parts.push(ell(scene, [0.03, 0.17, 0.12], mouth.add(new Vector3(0.0, 0, 0)), "#070202"));
  // Rings of long needle teeth, pointing in to the throat.
  for (const [count, scale, x, len] of [[54, 1, 0.215, 0.12], [40, 0.76, 0.2, 0.09]] as const) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + scale;
      const rimPt = new Vector3(x, mouth.y + Math.sin(a) * 0.27 * scale, Math.cos(a) * 0.2 * scale);
      const inward = mouth.add(new Vector3(x - mouth.x - 0.05, 0, 0)).subtract(rimPt).normalize();
      const l = len * (0.75 + hash01(k * 5 + count) * 0.5);
      parts.push(cone(scene, rimPt, rimPt.add(inward.scale(l)), 0.006, "#D9CBB5", 3));
    }
  }
  // Four long spindly legs, up to a high knee and down to the water, swaying as it walks.
  const moving: MovingPart[] = [];
  const legs: [Vector3, Vector3, Vector3, number][] = [];
  for (const side of [-1, 1]) {
    legs.push([new Vector3(0.06, 0.18, side * 0.12), new Vector3(0.12, 0.42, side * 0.42), new Vector3(0.2, -0.3, side * 0.56), 0]);
    legs.push([new Vector3(-0.22, 0.15, side * 0.12), new Vector3(-0.3, 0.38, side * 0.4), new Vector3(-0.38, -0.3, side * 0.5), Math.PI]);
  }
  legs.forEach(([hip, knee, foot, phase], i) => {
    const local = (v: Vector3) => v.subtract(hip);
    const path = curve([local(hip), local(hip.add(knee).scale(0.5).add(new Vector3(0, 0.08, 0))), local(knee), local(knee.add(foot).scale(0.5).add(new Vector3(0, 0.05, 0))), local(foot)], 5);
    const leg = tube(scene, path, 0.032, 0.012, paint, 7);
    moving.push({ mesh: hide(leg), pivot: hip, axis: "y", amp: 0.08, speed: 0.9, phase: phase + (i % 2) * 0.5 });
  });
  return { body: merge("seaEater", parts), moving };
}

// ---------- Nessie ----------

function nessie(scene: Scene): CreatureTemplate {
  const orange = hexRgb("#F59A3C");
  const shell = hexRgb("#E4572E");
  const cream = hexRgb("#FFF1DE");
  const parts: Mesh[] = [];
  // A round body with a red-orange wavy-edged back and a cream belly.
  parts.push(
    ell(scene, [0.27, 0.15, 0.2], new Vector3(-0.06, 0, 0), (x, y, z) => (y > 0.055 + 0.018 * Math.sin(z * 45 + x * 25) ? shell : y < -0.045 ? cream : orange), {
      seg: 14,
      deform: (p) => {
        if (p.y < 0) p.y *= 0.6;
      },
    }),
  );
  // A long neck curving up to a small, smiling head.
  const neck = curve([new Vector3(0.12, 0.04, 0), new Vector3(0.24, 0.16, 0), new Vector3(0.3, 0.34, 0), new Vector3(0.36, 0.47, 0)], 6);
  parts.push(tube(scene, neck, 0.06, 0.034, orange, 10));
  parts.push(ell(scene, [0.075, 0.045, 0.045], new Vector3(0.41, 0.49, 0), orange, { rot: new Vector3(0, 0, -0.12) }));
  parts.push(ell(scene, [0.05, 0.016, 0.03], new Vector3(0.43, 0.468, 0), "#D9403A", { rot: new Vector3(0, 0, -0.15) }));
  for (const side of [-1, 1]) {
    parts.push(ell(scene, [0.016, 0.018, 0.01], new Vector3(0.42, 0.515, side * 0.04), "#FFFFFF"));
    parts.push(ell(scene, [0.009, 0.011, 0.006], new Vector3(0.428, 0.517, side * 0.047), "#1A1210"));
    const smile: Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      smile.push(new Vector3(0.39 + t * 0.075, 0.47 - Math.sin(t * Math.PI) * 0.012 + t * 0.006, side * (0.043 - t * 0.01)));
    }
    parts.push(tube(scene, smile, 0.003, 0.003, "#3A1A10", 4));
  }
  // A short tail.
  parts.push(tube(scene, curve([new Vector3(-0.28, 0, 0), new Vector3(-0.4, -0.02, 0), new Vector3(-0.5, -0.05, 0)], 4), 0.06, 0.008, orange, 8));
  // Four paddle flippers sticking out to the sides, sweeping back, flapping.
  const moving: MovingPart[] = [];
  for (const side of [-1, 1]) {
    for (const [x, len, phase] of [[0.08, 0.24, 0], [-0.2, 0.19, Math.PI]] as const) {
      const out = (v: number) => side * v;
      const tris: [number, number][][] = [
        [[0.045, 0], [-0.05, 0], [-0.12, out(len)]],
        [[0.045, 0], [-0.12, out(len)], [-0.03, out(len * 0.82)]],
      ];
      // Built in the x/y plane with y as "outward", then laid flat (y → z) and drooped a little.
      const fin = flatFin(scene, tris, "#F28A2E", { rot: new Vector3(Math.PI / 2 - side * 0.3, 0, 0) });
      moving.push({ mesh: hide(fin), pivot: new Vector3(x, -0.05, side * 0.16), axis: "x", amp: 0.3, speed: 1.4, phase: phase + (side > 0 ? 0 : Math.PI) });
    }
  }
  return { body: merge("nessie", parts), moving };
}

// ---------- Registry ----------

export const CREATURES: Record<string, (scene: Scene) => CreatureTemplate> = {
  shark: (scene) => sharkLike(scene, "shark", false),
  megalodon: (scene) => sharkLike(scene, "megalodon", true),
  orca,
  whale: blueWhale,
  nessie,
  bloop,
  elGranMaja,
  godzilla,
  seaEater,
};
