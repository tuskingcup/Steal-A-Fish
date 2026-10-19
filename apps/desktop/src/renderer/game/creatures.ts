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
 * megalodon (a mouth cut into the head, a hinged open jaw, teeth set into both rims), orca and blue whale (horizontal flukes), the Bloop (a pale
 * deep-sea giant whose head is one enormous gaping mouth lined with teeth), El Gran Maja (a dark-blue whale-shaped titan with a huge black mouth, jagged teeth and
 * a row of glowing cyan eyes), Nessie (a cheerful orange plesiosaur), Godzilla (an upright kaiju with glowing back plates) and the Sea
 * Eater (a worm-like body that is all mouth, rings of needle teeth, on four long spindly legs) and
 * Gyarados (a blue sea serpent in an S-curve, cream belly plates, roaring head with a navy crest).
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

// ---------- Megalodon ----------

function megalodon(scene: Scene): CreatureTemplate {
  // A massive, thick-set prehistoric shark: slate above and white below with a ragged line
  // between, gill slits, a tall swept dorsal and a huge crescent tail. Its mouth is part of the
  // head: the underside of the snout is cut away into a dark palate, ringed with rows of big
  // triangular teeth set into it, and a hinged lower jaw (pink floor, white chin, its own teeth
  // set into its rim) hangs wide open beneath — nothing floats.
  const top = hexRgb("#46525D");
  const topDark = hexRgb("#36414B");
  const under = hexRgb("#E6E6E0");
  const gill = hexRgb("#232A31");
  const palate = hexRgb("#5E1620");
  const throat = hexRgb("#1A0306");
  const toothWhite = "#F4F0E4";
  const R: [number, number, number] = [0.5, 0.155, 0.145];
  const taper = (x: number) => (x < 0 ? 1 - Math.pow(-x / R[0], 1.5) * 0.85 : 1 - Math.pow(x / R[0], 2) * 0.35);
  const snoutLift = (x: number) => Math.max(0, x - 0.3) * 0.12;
  const HINGE = 0.17;
  /** Height of the mouth roof (the cut underside of the head), rising towards the snout. */
  const roof = (x: number) => -0.088 + ((x - HINGE) / (0.45 - HINGE)) * 0.058;
  const halfWidth = (x: number, y: number) => {
    const Y = (y - snoutLift(x)) / taper(x);
    const q = 1 - (x / R[0]) ** 2 - (Y / R[1]) ** 2;
    return q <= 0 ? 0 : R[2] * Math.sqrt(q) * taper(x);
  };
  const body = ell(
    scene,
    R,
    Vector3.Zero(),
    (x, y, z) => {
      if (x > HINGE + 0.01 && y < roof(x) + 0.004) return x < HINGE + 0.06 ? throat : palate;
      const line = -0.02 + 0.03 * x + 0.006 * Math.sin(x * 22);
      if (x > -0.02 && x < 0.1 && Math.abs(y) < 0.06 && Math.abs(z) > 0.06 && (x * 52) % 1 < 0.22) return gill;
      if (y < line) return under;
      return y > 0.09 ? topDark : top;
    },
    {
      seg: 30,
      deform: (p) => {
        const t = taper(p.x);
        p.y = p.y * t + snoutLift(p.x);
        p.z *= t;
        if (p.x > HINGE && p.y < roof(p.x)) p.y = roof(p.x); // the mouth roof
      },
    },
  );
  const parts: Mesh[] = [body];
  // Upper teeth: one neat row of straight triangular teeth set into the rim of the roof, evenly
  // spaced and growing a little towards the front.
  for (let x = HINGE + 0.035; x < 0.465; x += 0.024) {
    const y = roof(x);
    const w = halfWidth(x, y + 0.002);
    if (w < 0.02) continue;
    const len = 0.02 + 0.012 * ((x - HINGE) / (0.465 - HINGE));
    for (const sd of [-1, 1]) {
      const base = new Vector3(x, y + 0.007, sd * w * 0.88);
      parts.push(cone(scene, base, base.add(new Vector3(0, -len - 0.007, 0)), 0.0085, toothWhite, 3));
    }
  }
  // The dark throat at the back of the gape closes the hinge.
  parts.push(ell(scene, [0.03, 0.035, 0.075], new Vector3(HINGE + 0.015, -0.095, 0), throat));
  for (const sd of [-1, 1]) {
    const ey = 0.04;
    parts.push(ell(scene, [0.013, 0.012, 0.008], new Vector3(0.36, ey, sd * (halfWidth(0.36, ey) - 0.004)), "#060708"));
  }
  // Fins: a tall swept dorsal, small second dorsal and anal, big pectorals.
  const topAt = (x: number) => R[1] * Math.sqrt(Math.max(0, 1 - (x / R[0]) ** 2)) * taper(x) + snoutLift(x);
  const finCol = "#3B4651";
  parts.push(flatFin(scene, [[[-0.1, topAt(-0.1) - 0.03], [0.13, topAt(0.13) - 0.03], [-0.13, topAt(0) + 0.24]], [[0.13, topAt(0.13) - 0.03], [0.02, topAt(0) + 0.12], [-0.13, topAt(0) + 0.24]]], finCol));
  parts.push(flatFin(scene, [[[-0.34, topAt(-0.34) - 0.015], [-0.28, topAt(-0.28) - 0.015], [-0.35, topAt(-0.31) + 0.05]]], finCol));
  parts.push(flatFin(scene, [[[-0.31, -topAt(-0.31) + 0.015], [-0.25, -topAt(-0.25) + 0.015], [-0.32, -topAt(-0.28) - 0.045]]], finCol));
  for (const sd of [-1, 1]) {
    const y = -0.07;
    parts.push(sideFin(scene, "pec", new Vector3(0.04, y, sd * (halfWidth(0.04, y) - 0.012)), sd, 1.0, 0.32, finCol));
  }
  // The lower jaw, hinged at the corner of the mouth and hanging open: a trough whose top is the
  // pink floor of the mouth, white underneath, with its teeth set into the rim.
  const jawLen = 0.45 - HINGE;
  /** The jaw is as wide as the head where it hinges, narrowing to the chin. */
  const jawW = (lx: number) => 0.122 * (1 - Math.pow(Math.max(0, lx - 0.02) / jawLen, 1.8) * 0.72);
  // It reaches a little behind the hinge (BACK) into the body, so there is no gap at the corner.
  const BACK = 0.05;
  const jawMid = (jawLen - BACK) / 2;
  const jawParts: Mesh[] = [
    // Built centred (deform runs in its own space, then it is moved into place).
    ell(scene, [(jawLen + BACK) / 2, 0.06, 1], new Vector3(jawMid, -0.035, 0), (_x, y) => (y > -0.011 ? hexRgb("#7A2230") : y > -0.024 ? top : under) /* white chin like the belly, a grey lip */, {
      seg: 22,
      deform: (p) => {
        p.z *= jawW(p.x + jawMid);
        p.y = Math.min(p.y, 0.03); // a flat floor at y = -0.005 once placed
      },
    }),
  ];
  for (let lx = 0.035; lx < jawLen - 0.015; lx += 0.024) {
    const w = jawW(lx) * 0.82;
    const len = 0.016 + 0.008 * (lx / jawLen);
    for (const sd of [-1, 1]) {
      const base = new Vector3(lx, -0.013, sd * w);
      jawParts.push(cone(scene, base, base.add(new Vector3(0, len + 0.008, 0)), 0.0075, toothWhite, 3));
    }
  }
  const jaw = merge("megalodonJaw", jawParts);
  jaw.rotation.z = -0.16; // a little open, showing the teeth
  jaw.bakeCurrentTransformIntoVertices();
  // A huge crescent tail.
  const tail = flatFin(
    scene,
    [
      [[0.06, 0.03], [0, 0.03], [0, -0.03]],
      [[0.06, 0.03], [0, -0.03], [0.06, -0.03]],
      [[0, 0.03], [-0.2, 0.34], [-0.08, 0.02]],
      [[0, 0.03], [-0.08, 0.02], [0, -0.03]],
      [[0, -0.03], [-0.08, 0.02], [-0.17, -0.27]],
    ],
    finCol,
  );
  return {
    body: merge("megalodon", parts),
    moving: [
      { mesh: hide(jaw), pivot: new Vector3(HINGE, roof(HINGE) - 0.005, 0), axis: "z", amp: 0.05, speed: 0.7 },
      { mesh: hide(tail), pivot: new Vector3(-0.45, 0.01, 0), axis: "y", amp: 0.35, speed: 2.2 },
    ],
  };
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
  // A colossal, blimp-round whale: a blunt rounded head, a deep body tapering to a short lifted
  // tail stock, blue above and a huge pale belly that sweeps up over the whole lower face, with
  // long throat pleats; a tiny eye, swept-back flippers and small flukes make it look even bigger.
  const blue = hexRgb("#3D84C6");
  const shine = hexRgb("#62A6DE");
  const belly = hexRgb("#DCDFE0");
  const bellyShade = hexRgb("#C6CBCD");
  const R: [number, number, number] = [0.52, 0.245, 0.235];
  // Plump all the way back (it only narrows near the tail) and a very blunt, round head.
  const taper = (x: number) => (x < 0 ? 1 - Math.pow(-x / R[0], 2.8) * 0.72 : 1 - Math.pow(x / R[0], 6) * 0.12);
  const lift = (x: number) => (x < 0 ? 0.07 * Math.pow(-x / R[0], 3) : 0);
  /** The exact (smooth) half-width of the body at (x, y), or null off the body. */
  const halfWidth = (x: number, y: number): number | null => {
    const Y = (y - lift(x)) / taper(x);
    const q = 1 - (x / R[0]) ** 2 - (Y / R[1]) ** 2;
    return q <= 0 ? null : R[2] * Math.sqrt(q) * taper(x);
  };
  // The belly line: high on the face, sweeping down towards the tail stock.
  const bellyLine = (x: number) => -0.05 + ((x + 0.3) / 0.8) * 0.17;
  /** Where blue meets the pale belly: the belly line, then curving up along the tail stock. */
  const STOCK_END = new Vector3(-0.53, lift(-0.4) + 0.035, 0);
  const boundary = (x: number) => (x >= -0.3 ? bellyLine(x) : bellyLine(-0.3) + Math.min(1, (-0.3 - x) / 0.23) * (STOCK_END.y - 0.012 - bellyLine(-0.3)));
  const body = ell(
    scene,
    R,
    Vector3.Zero(),
    (x, y, z) => {
      if (y < boundary(x)) return y < -0.16 ? bellyShade : belly;
      return y > 0.15 && x > 0.02 && x < 0.34 && Math.abs(z) < 0.08 ? shine : blue;
    },
    {
      seg: 28,
      deform: (p) => {
        const t = taper(p.x);
        p.y = p.y * t + lift(p.x);
        p.z *= t;
      },
    },
  );
  const parts: Mesh[] = [body];
  for (const side of [-1, 1]) {
    // Long throat pleats: thin dark grooves on the belly, parallel to the belly line.
    for (let k = 1; k <= 7; k++) {
      const path: Vector3[] = [];
      for (let x = 0.49; x >= -0.32; x -= 0.02) {
        const y = bellyLine(x) - k * 0.032;
        const w = halfWidth(x, y);
        if (w === null || w < 0.02) {
          if (path.length > 0) break;
          continue;
        }
        path.push(new Vector3(x, y, side * (w + 0.001)));
      }
      if (path.length > 2) parts.push(tube(scene, path, 0.0032, 0.0032, "#59646A", 4));
    }
    // A tiny eye just above the belly line: it is what makes the rest look enormous.
    const ey = bellyLine(0.36) + 0.045;
    parts.push(ell(scene, [0.01, 0.01, 0.006], new Vector3(0.36, ey, side * ((halfWidth(0.36, ey) ?? 0.1) - 0.002)), "#121619"));
    // Swept-back flippers standing out from the flanks (solid, so they catch the light), a
    // smaller pair further back. Each is a flattened ellipsoid drawn to a point at its tip.
    for (const [x, len] of [[0.02, 0.22], [-0.24, 0.15]] as const) {
      const y = bellyLine(x) + 0.06;
      const root = new Vector3(x, y, side * ((halfWidth(x, y) ?? 0.1) - 0.01));
      const fin = ell(scene, [len / 2, len * 0.32, 0.012], Vector3.Zero(), "#4A93D3", {
        seg: 10,
        deform: (p) => {
          const k = Math.pow(Math.min(1, Math.max(0, 0.5 + p.x / len)), 0.7); // 0 at the tip (−x), 1 at the root
          p.y *= k;
          p.z *= 0.4 + 0.6 * k;
          p.x -= len / 2; // the root at the origin, the tip back along −x
        },
      });
      // Tip swept up and back, the blade turned out from the body.
      fin.rotation.set(side * 0.7, 0, -0.45);
      fin.position.copyFrom(root);
      fin.bakeCurrentTransformIntoVertices();
      parts.push(fin);
    }
  }
  // A short, stubby tail stock tapering out of the round body and rising a little (blue above,
  // pale below): cute rather than long.
  // It starts inside the body (where the body is still wider) and meets its surface around
  // x ≈ −0.4, so there is no seam.
  const stockFrom = new Vector3(-0.25, lift(-0.25), 0);
  const stockTo = STOCK_END;
  const stockPath = curve([stockFrom, new Vector3(-0.4, lift(-0.4) + 0.01, 0), new Vector3(-0.47, lift(-0.4) + 0.022, 0), stockTo], 6);
  const stockR = (i: number) => 0.15 - 0.08 * Math.pow(i / (stockPath.length - 1), 0.8);
  const stock = CreateTube("whaleStock", { path: stockPath, radiusFunction: stockR, tessellation: 14, cap: Mesh.CAP_ALL }, scene);
  stock.convertToFlatShadedMesh();
  paintFaces(stock, (x, y) => (y < boundary(x) ? belly : blue));
  parts.push(stock);
  const tailParts = [ell(scene, [0.05, 0.03, 0.035], new Vector3(0.03, 0, 0), "#3577B6"), flukes(scene, 0.2, 0.12, 0.045, "#3577B6")];
  const moving: MovingPart[] = [{ mesh: merge("whaleFlukes", tailParts), pivot: stockTo.clone(), axis: "z", amp: 0.22, speed: 1.2 }];
  // Built a little long (about 1.17 units with the flukes); scale it back to the usual ~1 unit,
  // centred, so true-scale comparisons on the reveal stage stay right.
  const S = 0.86;
  const shift = new Vector3(0.065, 0, 0);
  const fit = (m: Mesh) => {
    m.scaling.setAll(S);
    m.position.copyFrom(shift.scale(S));
    m.bakeCurrentTransformIntoVertices();
  };
  const whale = merge("whale", parts);
  fit(whale);
  for (const mp of moving) {
    mp.mesh.scaling.setAll(S);
    mp.mesh.bakeCurrentTransformIntoVertices(); // pivot space: scale only
    mp.pivot = mp.pivot.add(shift).scale(S);
    hide(mp.mesh);
  }
  return { body: whale, moving };
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
  // A dark-blue deep-sea titan. Its head flares out flat and very wide (like a hammerhead, the
  // wing tips drooping a little) and the whole broad front is one enormous gaping mouth carved
  // into the mesh: black inside, with red gums carrying dense rows of glowing white teeth, top
  // and bottom. A little row of pale violet eyes sits on the brow above it. Behind the head the
  // body narrows into a long stalk curving up to a forked tail.
  const back = hexRgb("#1B3B78");
  const side = hexRgb("#21468A");
  const belly = hexRgb("#2B559C");
  const lip = hexRgb("#142C5C");
  const black = hexRgb("#040507");
  const R: [number, number, number] = [0.5, 0.17, 0.19];
  const FRONT = 0.3; // the head is cut flat here, and the mouth is carved into that face
  const taper = (x: number) => (x < 0 ? 1 - Math.pow(-x / R[0], 1.25) * 0.9 : 1);
  const lift = (x: number) => (x < -0.05 ? 0.27 * Math.pow((-x - 0.05) / 0.45, 2.2) : 0);
  /** How much wider than tall the head flares (1 behind the head, ~2 at the front). */
  const flare = (x: number) => 1 + 1.05 * smooth(-0.1, FRONT, x);
  /** Wing tips droop: the further out on the head, the lower. */
  const droop = (x: number, z: number) => 0.05 * smooth(-0.1, FRONT, x) * (z / (R[2] * flare(x))) ** 2;
  /** Mouth on the front face: a wide lens, flatter on top, deeper below. */
  const M = { y: -0.012, top: 0.075, bottom: 0.1, rz: 0.29 };
  const inMouth = (y: number, z: number) => {
    const half = y > M.y ? M.top : M.bottom;
    return ((y - M.y) / half) ** 2 + (z / M.rz) ** 2;
  };
  // The mouth corners wrap round onto the flanks as a gape, so it still shows from the side.
  const MOUTH_BACK = 0.1;
  const gapeHalf = (x: number) => (x <= MOUTH_BACK ? 0 : 0.085 * Math.pow(Math.min(1, (x - MOUTH_BACK) / (FRONT - MOUTH_BACK)), 0.6));
  const inGape = (x: number, y: number) => {
    const h = gapeHalf(x);
    return h <= 0 ? 9 : ((y - M.y) / h) ** 2;
  };
  const body = ell(
    scene,
    R,
    Vector3.Zero(),
    (x, y, z) => {
      const d = inMouth(y + droop(x, z), z);
      if (x > FRONT - 0.2 && d < 0.92) return black; // inside the mouth
      if (x > FRONT - 0.03 && d < 1.2) return lip; // the dark lip around it
      const g = inGape(x, y + droop(x, z));
      if (g < 0.8) return black;
      if (g < 1.4) return lip;
      return y > 0.07 ? back : y > -0.05 ? side : belly;
    },
    {
      seg: 44,
      deform: (p) => {
        const t = taper(p.x);
        p.y = p.y * t + lift(p.x);
        p.z *= t * flare(p.x);
        p.y -= droop(p.x, p.z);
        const g = inGape(p.x, p.y + droop(p.x, p.z));
        if (g < 1) p.z *= 1 - 0.3 * (1 - g) * (1 - g) * (3 - 2 * (1 - g)); // a soft-edged groove
        if (p.x > FRONT) p.x = FRONT + (p.x - FRONT) * 0.12; // the flat, broad front
        // Carve the mouth: front vertices inside the lens are pushed back into a deep bowl.
        const d = inMouth(p.y + droop(p.x, p.z), p.z);
        if (p.x > FRONT - 0.05 && d < 1) p.x = FRONT - 0.18 * Math.sqrt(1 - d) - 0.01;
      },
    },
  );
  const parts: Mesh[] = [body];
  const glowParts: Mesh[] = [];
  // Red gums set back inside the mouth, each carrying a dense row of thin glowing teeth.
  const gumRed = "#C3202B";
  const row = (y: number, sign: 1 | -1, half: number, len: number) => {
    const gum: Vector3[] = [];
    const n = 12;
    for (let k = 0; k <= n; k++) {
      const z = (-1 + (2 * k) / n) * half;
      gum.push(new Vector3(FRONT - 0.075 + (z / half) ** 2 * 0.03, y + sign * (z / half) ** 2 * 0.012, z));
    }
    parts.push(tube(scene, gum, 0.02, 0.02, gumRed, 7));
    const teeth = 26;
    for (let k = 0; k < teeth; k++) {
      const u = -1 + (2 * (k + 0.5)) / teeth;
      const z = u * half * 0.95;
      const base = new Vector3(FRONT - 0.07 + u * u * 0.03, y + sign * u * u * 0.012 - sign * 0.012, z);
      const l = len * (0.92 + hash01(k * 3 + (sign > 0 ? 1 : 0)) * 0.12) * (1 - 0.25 * u * u);
      glowParts.push(cone(scene, base, base.add(new Vector3(0.004, -sign * l, 0)), 0.0065, "#FFFFFF", 4));
    }
  };
  row(M.y + M.top * 0.72, 1, 0.13, 0.06); // upper teeth hang down
  row(M.y - M.bottom * 0.72, -1, 0.11, 0.05); // lower teeth stand up
  // A row of small pale violet eyes on the brow, just above the middle of the mouth.
  for (let k = 0; k < 6; k++) {
    const u = -1 + (2 * k) / 5;
    const z = u * 0.085;
    const y = M.y + M.top + 0.03 + Math.abs(u) * 0.012;
    parts.push(ell(scene, [0.011, 0.012, 0.012], new Vector3(FRONT + 0.018, y, z), "#C7A6EE", { seg: 6 }));
  }
  // Small pectoral fins low on the narrow body behind the head.
  for (const sd of [-1, 1]) parts.push(sideFin(scene, "pec", new Vector3(-0.05, -0.1, sd * 0.15), sd, 1.0, 0.13, "#1B3B78"));
  // A forked tail at the top of the upward sweep.
  const tail = finMesh(scene, "majaTail", tailTris("fork", 0.3, 0.03), 0, "#1B3B78");
  tail.rotation.z = -0.55;
  tail.bakeCurrentTransformIntoVertices();
  return {
    body: merge("elGranMaja", parts),
    glow: merge("elGranMajaTeeth", glowParts),
    glowColor: "#F4F6FF",
    moving: [{ mesh: hide(tail), pivot: new Vector3(-0.49, lift(-0.49), 0), axis: "y", amp: 0.3, speed: 1.4 }],
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

// ---------- Gyarados ----------

function gyarados(scene: Scene): CreatureTemplate {
  const blue = hexRgb("#3DB6EC");
  const deep = hexRgb("#2D9AD8");
  const cream = hexRgb("#F7EEAA");
  const creamEdge = hexRgb("#E2CF82");
  const spot = hexRgb("#F4E79C");
  const yellow = "#F2DE84";
  const white = "#F1F5F8";
  const navy = "#2557A8";
  const parts: Mesh[] = [];
  // A thick serpent body: down from the raised head into a fat cream belly, back up in a loop and
  // down to the tail, wandering in depth so it reads as 3D from any side.
  const spine = curve(
    [
      new Vector3(0.29, 0.3, 0),
      new Vector3(0.25, 0.12, 0),
      new Vector3(0.2, -0.04, 0.02),
      new Vector3(0.08, -0.14, 0.03),
      new Vector3(-0.06, -0.08, 0),
      new Vector3(-0.14, 0.06, -0.05),
      new Vector3(-0.25, 0.1, -0.08),
      new Vector3(-0.34, 0.0, -0.06),
      new Vector3(-0.37, -0.14, -0.03),
      new Vector3(-0.42, -0.26, 0),
    ],
    6,
  );
  const n = spine.length - 1;
  const radius = (i: number) => {
    const t = i / n;
    return t < 0.3 ? 0.07 + 0.035 * smooth(0, 0.3, t) : 0.105 - 0.077 * Math.pow((t - 0.3) / 0.7, 0.9);
  };
  // Per spine point: its tangent, its left (local +y: the belly side, on the front of the S and
  // under the coil) and the arc length so far, for painting belly plates and flank spots.
  const tan = spine.map((_, i) => spine[Math.min(n, i + 1)]!.subtract(spine[Math.max(0, i - 1)]!).normalize());
  const arc: number[] = [0];
  for (let i = 1; i <= n; i++) arc.push(arc[i - 1]! + Vector3.Distance(spine[i - 1]!, spine[i]!));
  const plate = (arc[n]! / n) * 3; // three rings of the tube per belly plate
  const paint = (x: number, y: number, z: number): Rgb => {
    const p = new Vector3(x, y, z);
    let best = 0;
    for (let i = 1; i <= n; i++) if (Vector3.DistanceSquared(p, spine[i]!) < Vector3.DistanceSquared(p, spine[best]!)) best = i;
    const d = tan[best]!;
    const off = p.subtract(spine[best]!);
    const r = radius(best);
    const u = (off.x * -d.y + off.y * d.x) / r;
    const w = Math.abs(off.z) / r;
    const along = (arc[best]! + Vector3.Dot(off, d)) / plate;
    const k = Math.floor(along);
    const f = along - k;
    if (u > -0.05) return f < 0.28 ? creamEdge : cream;
    // Pale yellow oval spots down both flanks, one every other plate.
    if (k % 2 === 0 && f > 0.35 && f < 0.85 && w > 0.55 && u > -0.75 && best < n - 4) return spot;
    return u < -0.7 ? deep : blue;
  };
  const body = CreateTube("gyaradosBody", { path: spine, radiusFunction: (i) => radius(i), tessellation: 16, cap: Mesh.CAP_ALL }, scene);
  body.convertToFlatShadedMesh();
  paintFaces(body, paint);
  parts.push(body);
  // Big white fins along the back, each with three swept-back points (the first, behind the head,
  // is the largest).
  const backFin = (t: number, size: number) => {
    const i = Math.round(t * n);
    const d = tan[i]!;
    const back = new Vector3(d.y, -d.x, 0).normalize();
    const c = spine[i]!;
    const r = radius(i);
    const at = (out: number, along: number): [number, number] => [c.x + back.x * out + d.x * along, c.y + back.y * out + d.y * along];
    const rim: [number, number][] = [
      at(r * 0.5, -0.05 * size),
      at(r + 0.1 * size, -0.01 * size),
      at(r + 0.03 * size, 0.02 * size),
      at(r + 0.08 * size, 0.05 * size),
      at(r + 0.025 * size, 0.06 * size),
      at(r + 0.055 * size, 0.1 * size),
      at(r * 0.5, 0.07 * size),
    ];
    const root = at(r * 0.4, 0.01 * size);
    const tris: [number, number][][] = [];
    for (let k = 0; k < rim.length - 1; k++) tris.push([root, rim[k]!, rim[k + 1]!]);
    parts.push(flatFin(scene, tris, white, { z: c.z }));
  };
  backFin(0.05, 1.35);
  backFin(0.33, 1.0);
  backFin(0.55, 0.95);
  backFin(0.76, 0.8);

  // The head, raised and roaring: a long upturned snout, the mouth flung wide open (salmon-pink
  // inside, rimmed in yellow, two big fangs, small teeth below), angry red eyes, a navy
  // three-pointed crest sweeping back from the brow, grey frilly fins behind the jaw and long
  // whiskers that hang from the mouth corners and hook at the end.
  const H = new Vector3(0.31, 0.32, 0);
  const bodyParts = parts.length;
  parts.push(ell(scene, [0.1, 0.08, 0.08], H, blue, { seg: 14, rot: new Vector3(0, 0, 0.3) }));
  const snout = H.add(new Vector3(0.1, 0.045, 0));
  parts.push(ell(scene, [0.11, 0.04, 0.066], snout, blue, { seg: 12, rot: new Vector3(0, 0, 0.45) }));
  parts.push(ell(scene, [0.1, 0.013, 0.067], snout.add(new Vector3(0.005, -0.03, 0)), yellow, { rot: new Vector3(0, 0, 0.45) }));
  // Inside the mouth: a pink palate showing within the yellow lip, and a shallow throat at the back
  // of the gape (flat, facing out of the mouth, so nothing bulges between the jaws).
  parts.push(ell(scene, [0.085, 0.012, 0.05], snout.add(new Vector3(0.0, -0.036, 0)), "#E9837F", { rot: new Vector3(0, 0, 0.45) }));
  parts.push(ell(scene, [0.016, 0.07, 0.05], H.add(new Vector3(0.03, -0.04, 0)), "#D9666A", { rot: new Vector3(0, 0, -0.15) }));
  parts.push(ell(scene, [0.012, 0.035, 0.026], H.add(new Vector3(0.04, -0.045, 0)), "#8E2A36", { rot: new Vector3(0, 0, -0.15) }));
  const glow: Mesh[] = [];
  for (const side of [-1, 1]) {
    const lip = (t: number) => snout.add(new Vector3(-0.08 + t * 0.16, -0.075 + t * 0.075, side * (0.052 - t * 0.012)));
    parts.push(cone(scene, lip(0.88), lip(0.88).add(new Vector3(0.006, -0.05, 0)), 0.012, "#FFFFFF", 5));
    for (const t of [0.4, 0.6]) parts.push(cone(scene, lip(t), lip(t).add(new Vector3(0.003, -0.022, 0)), 0.007, "#FFFFFF", 4));
    // Angry eyes: a dark rim, a glowing red iris and a slit, slanted toward the snout.
    const eye = H.add(new Vector3(0.05, 0.05, side * 0.066));
    parts.push(ell(scene, [0.028, 0.017, 0.012], eye, "#1B2A4A", { rot: new Vector3(side * 0.5, 0, -0.45) }));
    glow.push(ell(scene, [0.02, 0.012, 0.008], eye.add(new Vector3(0.002, 0, side * 0.006)), "#FF2E45", { seg: 8, rot: new Vector3(side * 0.5, 0, -0.45) }));
    parts.push(ell(scene, [0.004, 0.01, 0.004], eye.add(new Vector3(0.004, 0, side * 0.013)), "#1A0508", { seg: 6 }));
    // Grey frilly fins behind the jaw hinge.
    const cheek = ([
      [[0.03, 0.03], [-0.12, 0.09], [-0.1, 0.04]],
      [[0.03, 0.02], [-0.1, 0.04], [-0.15, 0.01]],
      [[0.03, 0.0], [-0.15, 0.01], [-0.11, -0.03]],
      [[0.03, 0.0], [-0.11, -0.03], [-0.13, -0.08]],
      [[0.03, -0.01], [-0.13, -0.08], [-0.04, -0.05]],
    ] as [number, number][][]).map((tri) => tri.map(([x, y]): [number, number] => [x * 0.7, y * 0.7]));
    parts.push(flatFin(scene, cheek, "#C9D3DB", { rot: new Vector3(-side * 0.55, 0, 0.2), at: H.add(new Vector3(-0.03, -0.03, side * 0.07)) }));
    // Whiskers: from the mouth corners, hanging down and hooking up at the end.
    const corner = H.add(new Vector3(0.02, -0.03, side * 0.07));
    const whisker = curve([corner, corner.add(new Vector3(0.02, -0.05, side * 0.03)), corner.add(new Vector3(0.01, -0.15, side * 0.05)), corner.add(new Vector3(0.04, -0.19, side * 0.05)), corner.add(new Vector3(0.065, -0.16, side * 0.05))], 5);
    parts.push(tube(scene, whisker, 0.007, 0.003, "#3DB6EC", 5));
  }
  // The crest: three solid navy points from the brow, the middle one long and swept back.
  const point = (h: number, w: number, t: number, at: Vector3, rot: Vector3) =>
    ell(scene, [w, h / 2, t], at, navy, {
      rot,
      deform: (p) => {
        const k = Math.pow(Math.max(0, 1 - (p.y + h / 2) / h), 0.75);
        p.x *= k;
        p.z *= k;
        p.y += h / 2;
      },
    });
  const brow = H.add(new Vector3(0.05, 0.07, 0));
  parts.push(point(0.26, 0.045, 0.016, brow, new Vector3(0, 0, 0.75)));
  for (const side of [-1, 1]) parts.push(point(0.17, 0.035, 0.014, brow.add(new Vector3(-0.005, -0.01, side * 0.03)), new Vector3(side * 1.0, 0, 0.55)));
  // The lower jaw hangs wide open and works slowly; a yellow rim and small teeth line it.
  const jawPivot = H.add(new Vector3(0.0, -0.03 * 1.3, 0));
  const jawParts: Mesh[] = [
    // Painted in the jaw's own frame: pink on top (the floor of the mouth), cream underneath.
    ell(scene, [0.105, 0.03, 0.068], new Vector3(0.08, -0.05, 0), (x, y) => {
      const up = Math.sin(0.7) * (x - 0.08) + Math.cos(0.7) * (y + 0.05);
      return up > 0.012 ? hexRgb("#E9837F") : up < -0.014 ? cream : blue;
    }, { seg: 12, rot: new Vector3(0, 0, -0.7) }),
    ell(scene, [0.1, 0.008, 0.069], new Vector3(0.08, -0.034, 0), yellow, { rot: new Vector3(0, 0, -0.7) }),
    // The tongue, lying on the floor of the mouth.
    ell(scene, [0.05, 0.01, 0.026], new Vector3(0.06, -0.008, 0), "#F2A0A4", { rot: new Vector3(0, 0, -0.7) }),
  ];
  for (const side of [-1, 1]) {
    // Small teeth standing on the yellow rim (placed in the jaw's frame, tilted -0.7 about z).
    const c = Math.cos(-0.7);
    const sn = Math.sin(-0.7);
    const onJaw = (lx: number, ly: number, z: number) => new Vector3(0.08 + c * lx - sn * ly, -0.034 + sn * lx + c * ly, z);
    for (const lx of [0.0, 0.035, 0.07]) {
      const z = side * 0.062 * Math.sqrt(Math.max(0, 1 - (lx / 0.1) ** 2));
      const base = onJaw(lx, 0.004, z);
      jawParts.push(cone(scene, base, base.add(new Vector3(0.006, 0.026, -side * 0.004)), 0.007, "#FFFFFF", 4)); // pointing up into the gape
    }
  }
  // The head is built at a convenient size, then scaled up about H so it is as broad as the neck.
  const K = 1.3;
  const grow = (m: Mesh, about: Vector3) => {
    m.scaling.setAll(K);
    m.position.copyFrom(about.scale(1 - K));
    m.bakeCurrentTransformIntoVertices();
  };
  for (const m of parts.slice(bodyParts)) grow(m, H);
  for (const m of glow) grow(m, H);
  for (const m of jawParts) grow(m, Vector3.Zero()); // pivot space
  const jaw = merge("gyaradosJaw", jawParts);
  // The tail: a white fan with a jagged edge, a blue fork at its root, wiggling.
  const tailEnd = spine[n]!;
  const td = tan[n]!;
  const ang = Math.atan2(td.y, td.x);
  const polar = (a: number, r: number): [number, number] => [Math.cos(ang + a) * r, Math.sin(ang + a) * r];
  const fan: [number, number][][] = [];
  for (let k = 0; k < 10; k++) fan.push([[0, 0], polar(-0.6 + (k / 10) * 1.2, k % 2 ? 0.15 : 0.19), polar(-0.6 + ((k + 1) / 10) * 1.2, (k + 1) % 2 ? 0.15 : 0.19)]);
  const fork: [number, number][][] = [
    [polar(0, -0.02), polar(-0.5, 0.1), polar(-0.25, 0.04)],
    [polar(0, -0.02), polar(0.5, 0.1), polar(0.25, 0.04)],
  ];
  const tailFin = merge("gyaradosTail", [flatFin(scene, fan, white), flatFin(scene, fork, "#2D9AD8", { z: 0.004 })]);
  return {
    body: merge("gyarados", parts),
    glow: merge("gyaradosEyes", glow),
    glowColor: "#FF3B4A",
    moving: [
      { mesh: hide(jaw), pivot: jawPivot, axis: "z", amp: 0.1, speed: 0.8 },
      { mesh: hide(tailFin), pivot: tailEnd, axis: "y", amp: 0.4, speed: 2 },
    ],
  };
}

// ---------- Registry ----------

export const CREATURES: Record<string, (scene: Scene) => CreatureTemplate> = {
  shark: (scene) => sharkLike(scene, "shark", false),
  megalodon,
  orca,
  whale: blueWhale,
  nessie,
  bloop,
  elGranMaja,
  godzilla,
  seaEater,
  gyarados,
};
