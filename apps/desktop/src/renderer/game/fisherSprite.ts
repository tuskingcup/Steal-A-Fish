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

/**
 * HD-2D fisher: a pixel-art billboard that looks right from every side.
 *
 * Instead of hand-drawing each view, the character is described once as a small set of
 * signed-distance shapes (local space: +z faces the sea, origin = seat on the dock) and baked
 * at load into a 48×56 toon-shaded, outlined pixel sprite for each of 16 view directions.
 * At runtime the billboard picks the frame matching the camera's angle around the fisher,
 * so orbiting the camera shows the front, sides and back like a sprite sheet would.
 */

const FRAME_W = 48;
const FRAME_H = 56;
/** World metres per sprite pixel. */
export const SPRITE_PX = 0.035;
const DIRECTIONS = 16;
const POSES = 2;
/** Bake with a slight downward look so the hat brim reads; the billboard itself stays vertical. */
const BAKE_PITCH = 0.17;

type V3 = readonly [number, number, number];

/**
 * Billboard centre in fisher-local space. It sits just past the dock edge (local z 0.2) so the
 * dangling legs aren't hidden by the dock from the front, and just in front of the hands so the
 * 3D rod is hidden behind the body when seen from behind.
 */
const PLANE_CENTER: V3 = [0, 0.25, 0.25];
/** Where the hands grip the rod, fisher-local. The 3D rod starts here. */
export const HAND_LOCAL: V3 = [0.05, 0.36, 0.3];

const PALETTE = {
  skin: "#F2C194",
  hair: "#2A1E18",
  eye: "#1B1410",
  blush: "#F08C7C",
  shirt: "#EDE6D3",
  scarf: "#D2453B",
  pants: "#34488A",
  sandal: "#6B4226",
  hat: "#E8C273",
  outline: "#1E1424",
} as const;

interface Prim {
  sdf: (x: number, y: number, z: number) => number;
  rgb: [number, number, number];
  /** Prims in the same group don't draw inner outlines against each other. */
  group: number;
}

export interface FisherSprite {
  plane: Mesh;
  update(camera: Camera, timeSec: number): void;
}

export function createFisherSprite(scene: Scene, origin: Vector3): FisherSprite {
  const frames: DynamicTexture[][] = [];
  for (let pose = 0; pose < POSES; pose++) {
    const prims = buildPrims(pose);
    const row: DynamicTexture[] = [];
    for (let dir = 0; dir < DIRECTIONS; dir++) row.push(bakeFrame(scene, prims, (dir / DIRECTIONS) * Math.PI * 2, `fisher_${pose}_${dir}`));
    frames.push(row);
  }

  const plane = CreatePlane("fisher", { width: FRAME_W * SPRITE_PX, height: FRAME_H * SPRITE_PX }, scene);
  plane.position = origin.add(new Vector3(...PLANE_CENTER));
  plane.billboardMode = Mesh.BILLBOARDMODE_Y;

  // Lighting is baked into the pixels (toon ramp from the sun's side), so the sprite is unlit;
  // otherwise its brightness would change as the billboard turns with the camera.
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
  const show = (tex: DynamicTexture): void => {
    if (tex === current) return;
    current = tex;
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
  };

  return {
    plane,
    update(camera, timeSec) {
      const v = camera.globalPosition.subtract(plane.position);
      const angle = Math.atan2(v.x, v.z);
      const step = (Math.PI * 2) / DIRECTIONS;
      const dir = (((Math.round(angle / step)) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
      const pose = Math.floor(timeSec * 1.6) % POSES;
      show(frames[pose]![dir]!);
    },
  };
}

// ---------- Character shapes ----------

function buildPrims(pose: number): Prim[] {
  const P = PALETTE;
  const prims: Prim[] = [];
  const add = (sdf: Prim["sdf"], hex: string, group: number) => prims.push({ sdf, rgb: hexRgb(hex), group });

  // Legs dangle over the dock edge and swing out of phase.
  for (const side of [-1, 1]) {
    const swing = (pose === 0 ? 0.08 : -0.08) * side;
    const hip: V3 = [0.1 * side, 0.08, 0];
    const knee: V3 = [0.1 * side, 0.08, 0.36];
    const mid: V3 = [0.1 * side, -0.1, 0.4 + swing * 0.5];
    const ankle: V3 = [0.1 * side, -0.3, 0.42 + swing];
    add(capsule(hip, knee, 0.085), P.pants, 1);
    add(capsule(knee, mid, 0.078), P.pants, 1);
    add(capsule(mid, ankle, 0.058), P.skin, 2);
    add(roundBox([ankle[0], ankle[1] - 0.05, ankle[2] + 0.05], [0.055, 0.03, 0.1], 0.02), P.sandal, 3);
  }
  add(roundBox([0, 0.1, -0.04], [0.18, 0.1, 0.14], 0.06), P.pants, 1);

  // Torso, scarf (pha khao ma), head.
  add(roundBox([0, 0.36, -0.02], [0.17, 0.19, 0.11], 0.07), P.shirt, 4);
  add(roundBox([0, 0.56, -0.01], [0.15, 0.035, 0.125], 0.03), P.scarf, 5);
  add(roundBox([0, 0.74, 0.03], [0.15, 0.14, 0.13], 0.07), P.skin, 6);
  add(roundBox([0, 0.77, -0.03], [0.158, 0.1, 0.12], 0.06), P.hair, 7);
  for (const side of [-1, 1]) {
    add(sphere([0.062 * side, 0.75, 0.155], 0.03), P.eye, 8);
    add(sphere([0.112 * side, 0.7, 0.14], 0.026), P.blush, 6);
  }

  // Ngob (conical straw hat).
  add(cappedCone([0, 0.83, 0.02], [0, 1.03, 0.02], 0.32, 0.025), P.hat, 9);

  // Arms reach forward to the rod grip.
  for (const side of [-1, 1]) {
    const shoulder: V3 = [0.2 * side, 0.5, -0.02];
    const elbow: V3 = [0.23 * side, 0.34, 0.13];
    add(capsule(shoulder, elbow, 0.058), P.shirt, 4);
    add(capsule(elbow, HAND_LOCAL, 0.048), P.skin, 10);
  }
  add(sphere(HAND_LOCAL, 0.062), P.skin, 10);
  return prims;
}

// ---------- Baker ----------

function bakeFrame(scene: Scene, prims: Prim[], azimuth: number, name: string): DynamicTexture {
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

  const sceneSdf = (x: number, y: number, z: number): [number, number] => {
    let best = Infinity;
    let idx = -1;
    for (let i = 0; i < prims.length; i++) {
      const v = prims[i]!.sdf(x, y, z);
      if (v < best) {
        best = v;
        idx = i;
      }
    }
    return [best, idx];
  };

  const light = normalize([0.45, 0.85, 0.55]); // towards the sun, fisher-local

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const sx = (i + 0.5 - W / 2) * SPRITE_PX;
      const sy = (H / 2 - (j + 0.5)) * SPRITE_PX;
      const ox = PLANE_CENTER[0] + r[0]! * sx + u[0]! * sy - d[0]! * 2;
      const oy = PLANE_CENTER[1] + r[1]! * sx + u[1]! * sy - d[1]! * 2;
      const oz = PLANE_CENTER[2] + r[2]! * sx + u[2]! * sy - d[2]! * 2;

      let t = 0.8; // the character fits well within 1.2 m of the plane
      for (let step = 0; step < 64 && t < 3.2; step++) {
        const px = ox + d[0]! * t;
        const py = oy + d[1]! * t;
        const pz = oz + d[2]! * t;
        const [dist, idx] = sceneSdf(px, py, pz);
        if (dist < 0.0015) {
          const k = j * W + i;
          depth[k] = t;
          prim[k] = idx;
          const e = 0.004;
          const n = normalize([
            sceneSdf(px + e, py, pz)[0] - sceneSdf(px - e, py, pz)[0],
            sceneSdf(px, py + e, pz)[0] - sceneSdf(px, py - e, pz)[0],
            sceneSdf(px, py, pz + e)[0] - sceneSdf(px, py, pz - e)[0],
          ]);
          const ndl = n[0]! * light[0]! + n[1]! * light[1]! + n[2]! * light[2]!;
          // Three-step toon ramp with cool shadows, the usual pixel-art shading.
          const tone = ndl > 0.45 ? [1.04, 1.02, 0.98] : ndl > -0.05 ? [0.86, 0.86, 0.9] : [0.64, 0.66, 0.8];
          const base = prims[idx]!.rgb;
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
  const outline = hexRgb(PALETTE.outline);
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && prim[y * W + x]! >= 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const o = k * 4;
      if (prim[k]! < 0) {
        // Outer outline: empty pixel touching the silhouette.
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          img.data[o] = outline[0] * 255;
          img.data[o + 1] = outline[1] * 255;
          img.data[o + 2] = outline[2] * 255;
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

function sphere(c: V3, rad: number): Prim["sdf"] {
  return (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - rad;
}

function capsule(a: V3, b: V3, rad: number): Prim["sdf"] {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / baba));
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - rad;
  };
}

function roundBox(c: V3, half: V3, rad: number): Prim["sdf"] {
  return (x, y, z) => {
    const qx = Math.abs(x - c[0]) - half[0] + rad;
    const qy = Math.abs(y - c[1]) - half[1] + rad;
    const qz = Math.abs(z - c[2]) - half[2] + rad;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
  };
}

function cappedCone(a: V3, b: V3, ra: number, rb: number): Prim["sdf"] {
  const rba = rb - ra;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  return (x, y, z) => {
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
    const s = cbx < 0 && cay < 0 ? -1 : 1;
    return s * Math.sqrt(Math.min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba));
  };
}

function normalize(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
