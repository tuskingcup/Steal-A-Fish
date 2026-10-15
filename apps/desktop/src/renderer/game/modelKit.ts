import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";

/** Shared low-poly building blocks for fish and creature models: flat-shaded, vertex-coloured. */

export type Rgb = [number, number, number];
export type Tail = "fork" | "round" | "fan" | "long" | "shark";

export const hexRgb = (hex: string): Rgb => {
  const c = Color3.FromHexString(hex);
  return [c.r, c.g, c.b];
};
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Colour each flat-shaded triangle from its centroid (crisp low-poly look). */
export function paintFaces(mesh: Mesh, color: (cx: number, cy: number, cz: number) => Rgb): void {
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

export const solidPaint = <T extends Mesh>(mesh: T, hex: string): T => {
  mesh.convertToFlatShadedMesh();
  const c = hexRgb(hex);
  paintFaces(mesh, () => c);
  return mesh;
};

/** Flat triangle-list mesh from points in the x/y plane at z (fins). */
export function finMesh(scene: Scene, name: string, tris: [number, number][][], z: number, hex: string): Mesh {
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
export function rod(scene: Scene, a: Vector3, b: Vector3, thickness: number, hex: string): Mesh {
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
export function sideFin(scene: Scene, name: string, at: Vector3, side: number, splay: number, len: number, hex: string): Mesh {
  const fin = finMesh(scene, name, [[[0.03, 0.012], [-len, -len * 0.25], [-len * 0.55, -len * 0.55]], [[0.03, 0.012], [-len * 0.55, -len * 0.55], [0.0, -0.02]]], 0, hex);
  fin.rotation.x = side * splay;
  fin.position = at;
  fin.bakeCurrentTransformIntoVertices();
  return fin;
}

export function tailTris(kind: Tail, h: number, b: number): [number, number][][] {
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

