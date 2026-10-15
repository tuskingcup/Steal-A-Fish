import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { flat, hash01, lowPolyMat } from "./materials";

/** Top of the dock planks (world y). */
export const DOCK_TOP = 0.9;
/** Sea-side end of the dock (world z). The fisher sits here, facing +z. */
export const DOCK_END = 4;

export const HORIZON = "#FFE2B8";

export function waveHeight(x: number, z: number, t: number): number {
  return Math.sin(x * 0.42 + t * 1.1) * 0.07 + Math.sin(z * 0.55 - t * 1.35 + x * 0.18) * 0.07;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Beach height: under water near the dock end, rising inland, with a wavy coastline. */
export function beachHeight(x: number, z: number): number {
  const zz = z + Math.sin(x * 0.07) * 3 + Math.sin(x * 0.19 + 1) * 1.2;
  const s = smoothstep(-1, -14, zz);
  const bumps = Math.sin(x * 0.5) * 0.12 + Math.cos(x * 0.23 + z * 0.4) * 0.16;
  return -0.9 + 1.75 * s + bumps * s;
}

// ---------- Pixel textures ----------

type PixelPainter = (px: (x: number, y: number, color: string) => void) => void;

function pixelTexture(scene: Scene, name: string, w: number, h: number, paint: PixelPainter, uScale = 1, vScale = 1): Texture {
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  paint((x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  });
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = uScale;
  tex.vScale = vScale;
  return tex;
}

function texturedMat(scene: Scene, name: string, tex: Texture, specular = 0.03): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(specular, specular, specular);
  return mat;
}

const pick = <T,>(arr: readonly T[], n: number): T => arr[Math.floor(hash01(n) * arr.length) % arr.length]!;

function woodTexture(scene: Scene, name: string, base: readonly string[]): Texture {
  return pixelTexture(scene, name, 32, 8, (px) => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 32; x++) {
        const grain = (y === 2 || y === 5) && hash01(x * 7 + y) > 0.25;
        const c = y === 0 || y === 7 ? base[2]! : grain ? base[1]! : pick(base.slice(0, 2), x * 13 + y * 31 + 0.5);
        px(x, y, c);
      }
    px(4, 3, base[2]!); // nail heads
    px(27, 4, base[2]!);
  });
}

function speckleTexture(scene: Scene, name: string, size: number, colors: readonly string[], weights: readonly number[], u: number, v: number): Texture {
  return pixelTexture(
    scene,
    name,
    size,
    size,
    (px) => {
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const h = hash01(x * 17.3 + y * 91.7 + name.length);
          let acc = 0;
          let c = colors[0]!;
          for (let i = 0; i < colors.length; i++) {
            acc += weights[i]!;
            if (h < acc) {
              c = colors[i]!;
              break;
            }
          }
          px(x, y, c);
        }
    },
    u,
    v,
  );
}

// ---------- Sky ----------

export function createSky(scene: Scene): void {
  const tex = new DynamicTexture("skyTex", { width: 4, height: 256 }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#3F86CF");
  g.addColorStop(0.32, "#8EC6EA");
  g.addColorStop(0.47, HORIZON);
  g.addColorStop(0.5, HORIZON);
  g.addColorStop(1, "#6FB7C9");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  tex.update();

  const sky = CreateSphere("sky", { diameter: 800, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const mat = new StandardMaterial("skyMat", scene);
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.fogEnabled = false;
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;

  // Puffy low-poly clouds.
  const cloudMat = lowPolyMat(scene, "#FFFFFF", { emissive: 0.55 });
  cloudMat.fogEnabled = false;
  const clouds: [number, number, number, number][] = [
    [-60, 38, 120, 1.2],
    [20, 46, 150, 1.6],
    [80, 34, 100, 1],
    [-120, 40, 30, 1.3],
    [110, 42, -60, 1.4],
    [-40, 36, -140, 1.1],
  ];
  clouds.forEach(([x, y, z, s], i) => {
    for (let k = 0; k < 4; k++) {
      const puff = flat(CreateIcoSphere(`cloud${i}_${k}`, { radius: 6 * s * (k === 1 ? 1.4 : 1), subdivisions: 1 }, scene));
      puff.position = new Vector3(x + (k - 1.5) * 8 * s, y + (k === 1 ? 2 : 0), z + hash01(i * 4 + k) * 4);
      puff.scaling.y = 0.55;
      puff.material = cloudMat;
    }
  });
}

// ---------- Sea ----------

export interface Sea {
  update(t: number): void;
}

/** Faceted sea: unshared triangles so each facet catches the sun separately; animated on the CPU. */
export function createSea(scene: Scene): Sea {
  const N = 72;
  const x0 = -90;
  const z0 = -20;
  const size = 180;
  const cell = size / N;
  const vertCount = N * N * 6;
  const pos = new Float32Array(vertCount * 3);
  const nor = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 4);
  const idx = new Uint32Array(vertCount);

  const shallow = Color3.FromHexString("#45C9C1");
  const deep = Color3.FromHexString("#1E6F9A");
  let v = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const xa = x0 + i * cell;
      const za = z0 + j * cell;
      const corners = [
        [xa, za],
        [xa, za + cell],
        [xa + cell, za],
        [xa + cell, za],
        [xa, za + cell],
        [xa + cell, za + cell],
      ];
      for (let tri = 0; tri < 2; tri++) {
        const cz = za + cell / 2;
        const shore = smoothstep(26, -4, cz);
        const jitter = (hash01(i * 131 + j * 17 + tri * 7) - 0.5) * 0.06;
        const c = Color3.Lerp(deep, shallow, Math.min(1, shore * 0.9));
        for (let k = 0; k < 3; k++) {
          const [x, z] = corners[tri * 3 + k]!;
          pos[v * 3] = x!;
          pos[v * 3 + 2] = z!;
          col[v * 4] = c.r + jitter;
          col[v * 4 + 1] = c.g + jitter;
          col[v * 4 + 2] = c.b + jitter;
          col[v * 4 + 3] = 1;
          idx[v] = v;
          v++;
        }
      }
    }
  }

  const mesh = new Mesh("sea", scene);
  const data = new VertexData();
  data.positions = pos;
  data.normals = nor;
  data.colors = col;
  data.indices = idx;
  data.applyToMesh(mesh, true);
  const mat = new StandardMaterial("seaMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.9, 0.85, 0.7);
  mat.specularPower = 48;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.alwaysSelectAsActiveMesh = true;

  const update = (t: number): void => {
    for (let k = 0; k < vertCount; k++) pos[k * 3 + 1] = waveHeight(pos[k * 3]!, pos[k * 3 + 2]!, t);
    for (let k = 0; k < vertCount; k += 3) {
      const a = k * 3;
      const b = a + 3;
      const c = a + 6;
      const e1x = pos[b]! - pos[a]!, e1y = pos[b + 1]! - pos[a + 1]!, e1z = pos[b + 2]! - pos[a + 2]!;
      const e2x = pos[c]! - pos[a]!, e2y = pos[c + 1]! - pos[a + 1]!, e2z = pos[c + 2]! - pos[a + 2]!;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1);
      nx /= l;
      ny /= l;
      nz /= l;
      for (let q = 0; q < 3; q++) {
        nor[a + q * 3] = nx;
        nor[a + q * 3 + 1] = ny;
        nor[a + q * 3 + 2] = nz;
      }
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    mesh.updateVerticesData(VertexBuffer.NormalKind, nor);
  };
  update(0);
  return { update };
}

// ---------- Beach, hills, palms, rocks ----------

/** Palm trees on the beach: x, z, seed. */
export const PALMS: readonly (readonly [number, number, number])[] = [
  [-5.5, -12, 0],
  [-9, -9.5, 1],
  [6.5, -11, 2],
  [10.5, -15, 3],
  [-14, -17, 4],
  [3, -20, 5],
  [16, -10.5, 6],
  [-20, -12, 7],
  [22, -18, 8],
];

/** Rocks along the shore: x, z, size. */
export const ROCKS: readonly (readonly [number, number, number])[] = [
  [-3.2, -6.5, 0.9],
  [3.4, -5.8, 0.7],
  [-2.4, 2.2, 0.6],
  [2.8, 5.5, 0.8],
  [-4.5, 6.8, 0.5],
  [9, -6.5, 1.2],
  [-11, -5.5, 1],
];

/** z where the sand meets the water at x (the beach slopes down towards +z). */
export function shorelineZ(x: number, height = 0.12): number {
  let lo = -20;
  let hi = 0;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (beachHeight(x, mid) > height) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function createBeach(scene: Scene, shadows: ShadowGenerator): void {
  const beach = CreateGround("beach", { width: 200, height: 90, subdivisions: 80, updatable: true }, scene);
  beach.position.z = -45 + 1;
  const p = beach.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < p.length; i += 3) p[i + 1] = beachHeight(p[i]!, p[i + 2]! + beach.position.z);
  beach.updateVerticesData(VertexBuffer.PositionKind, p);
  flat(beach);
  beach.material = texturedMat(
    scene,
    "sandMat",
    speckleTexture(scene, "sand", 16, ["#EFD29A", "#E2C083", "#F8E3B2", "#D9B477"], [0.55, 0.25, 0.14, 0.06], 50, 22),
  );
  beach.receiveShadows = true;

  // Jungle hills behind the beach.
  const grass = texturedMat(
    scene,
    "grassMat",
    speckleTexture(scene, "grass", 16, ["#5FA24A", "#4E8C3E", "#73B957", "#3F7A35"], [0.45, 0.3, 0.15, 0.1], 6, 6),
  );
  const hills: [number, number, number, number, number][] = [
    [-30, -42, 20, 9, 14],
    [5, -50, 26, 12, 14],
    [40, -44, 22, 8, 14],
    [-65, -34, 22, 10, 18],
    [75, -30, 22, 9, 18],
  ];
  hills.forEach(([x, z, rx, ry, rz], i) => {
    const hill = flat(CreateIcoSphere(`hill${i}`, { radius: 1, subdivisions: 2 }, scene));
    hill.scaling = new Vector3(rx, ry, rz);
    hill.position = new Vector3(x, -1, z);
    hill.material = grass;
  });

  // Distant islands on the horizon.
  const island = lowPolyMat(scene, "#5E9A63");
  const islands: [number, number, number, number][] = [
    [-45, 95, 16, 5],
    [30, 120, 22, 7],
    [85, 90, 12, 4],
  ];
  islands.forEach(([x, z, r, h], i) => {
    const m = flat(CreateIcoSphere(`island${i}`, { radius: 1, subdivisions: 1 }, scene));
    m.scaling = new Vector3(r, h, r * 0.6);
    m.position = new Vector3(x, -0.5, z);
    m.material = island;
  });

  for (const [x, z, seed] of PALMS) palm(scene, shadows, x, z, seed);

  const rockMat = texturedMat(scene, "rockMat", speckleTexture(scene, "rock", 8, ["#9A9C97", "#83857F", "#B0B2AA"], [0.5, 0.3, 0.2], 2, 2));
  ROCKS.forEach(([x, z, s], i) => {
    const rock = flat(CreateIcoSphere(`rock${i}`, { radius: s, subdivisions: 1 }, scene));
    rock.position = new Vector3(x, Math.max(beachHeight(x, z), -0.6) + s * 0.25, z);
    rock.rotation.y = hash01(i) * 6;
    rock.scaling = new Vector3(1 + hash01(i + 9) * 0.4, 0.6, 1);
    rock.material = rockMat;
    rock.receiveShadows = true;
    shadows.addShadowCaster(rock);
  });
}

function palm(scene: Scene, shadows: ShadowGenerator, x: number, z: number, seed: number): void {
  const h = 4.5 + hash01(seed) * 2.5;
  const lean = (hash01(seed + 3) - 0.5) * 2.4;
  const leanZ = (hash01(seed + 5) - 0.3) * 2;
  const baseY = beachHeight(x, z) - 0.2;
  const path: Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const s = i / 6;
    path.push(new Vector3(x + lean * s * s, baseY + s * h, z + leanZ * s * s));
  }
  const trunkTex = pixelTexture(
    scene,
    `trunk${seed}`,
    8,
    8,
    (px) => {
      for (let y = 0; y < 8; y++) for (let xx = 0; xx < 8; xx++) px(xx, y, y % 4 === 0 ? "#6E5034" : xx % 3 === 0 ? "#8E6B45" : "#9C7A50");
    },
    3,
    6,
  );
  const trunk = flat(CreateTube(`trunk${seed}`, { path, radiusFunction: (i) => 0.26 - i * 0.022, tessellation: 6, cap: Mesh.CAP_START }, scene));
  trunk.material = texturedMat(scene, `trunkMat${seed}`, trunkTex);
  shadows.addShadowCaster(trunk);

  const top = path[path.length - 1]!;
  const crown = new TransformNode(`crown${seed}`, scene);
  crown.position = top;
  const leafA = lowPolyMat(scene, "#3E9A48");
  const leafB = lowPolyMat(scene, "#2F7E3C");
  const count = 8;
  for (let k = 0; k < count; k++) {
    const yaw = new TransformNode(`leafYaw${seed}_${k}`, scene);
    yaw.parent = crown;
    yaw.rotation.y = (k / count) * Math.PI * 2 + hash01(seed * 10 + k) * 0.4;
    // Two segments per frond: rising, then drooping.
    const inner = CreateBox(`leafIn${seed}_${k}`, { width: 0.55, height: 0.05, depth: 1.4 }, scene);
    inner.parent = yaw;
    inner.rotation.x = -0.35;
    inner.position = new Vector3(0, 0.22, 0.65);
    const outer = CreateBox(`leafOut${seed}_${k}`, { width: 0.4, height: 0.05, depth: 1.5 }, scene);
    outer.parent = yaw;
    outer.rotation.x = 0.55;
    outer.position = new Vector3(0, 0.1, 1.95);
    inner.material = k % 2 ? leafA : leafB;
    outer.material = k % 2 ? leafB : leafA;
    shadows.addShadowCaster(inner);
    shadows.addShadowCaster(outer);
  }
  const nut = lowPolyMat(scene, "#6B4A2B");
  for (let k = 0; k < 3; k++) {
    const c = flat(CreateIcoSphere(`coco${seed}_${k}`, { radius: 0.15, subdivisions: 1 }, scene));
    c.parent = crown;
    c.position = new Vector3(Math.cos(k * 2.1) * 0.2, -0.15, Math.sin(k * 2.1) * 0.2);
    c.material = nut;
  }
}

// ---------- Dock ----------

export function createDock(scene: Scene, shadows: ShadowGenerator): void {
  const plankMats = [
    texturedMat(scene, "plankA", woodTexture(scene, "woodA", ["#A8744A", "#9A6842", "#6E4529"])),
    texturedMat(scene, "plankB", woodTexture(scene, "woodB", ["#946140", "#875737", "#5F3B23"])),
  ];
  const start = -13;
  const step = 0.36;
  const planks: Mesh[][] = [[], []];
  for (let i = 0, z = start; z < DOCK_END - step / 2; i++, z += step) {
    const plank = CreateBox(`plank${i}`, { width: 2.4, height: 0.1, depth: 0.32 }, scene);
    plank.position = new Vector3((hash01(i) - 0.5) * 0.08, DOCK_TOP - 0.05 + (hash01(i + 50) - 0.5) * 0.02, z + step / 2);
    plank.rotation.y = (hash01(i + 100) - 0.5) * 0.03;
    planks[hash01(i + 200) > 0.7 ? 1 : 0]!.push(plank);
  }
  planks.forEach((group, k) => {
    const merged = Mesh.MergeMeshes(group, true);
    if (!merged) return;
    merged.material = plankMats[k]!;
    merged.receiveShadows = true;
    shadows.addShadowCaster(merged);
  });

  const beam = lowPolyMat(scene, "#5F3F27");
  for (const x of [-1, 1]) {
    const stringer = CreateBox(`stringer${x}`, { width: 0.16, height: 0.16, depth: DOCK_END - start }, scene);
    stringer.position = new Vector3(x, DOCK_TOP - 0.18, (start + DOCK_END) / 2);
    stringer.material = beam;
    shadows.addShadowCaster(stringer);
  }

  const postMat = lowPolyMat(scene, "#6B4930");
  const rope = lowPolyMat(scene, "#D9C08E");
  for (const z of [-10, -6, -2, 1.2, DOCK_END - 0.1]) {
    for (const x of [-1.1, 1.1]) {
      const tall = z > DOCK_END - 1;
      const h = tall ? 3.4 : 2.7;
      const post = CreateCylinder(`post${x}_${z}`, { diameter: 0.24, height: h, tessellation: 6 }, scene);
      post.position = new Vector3(x, DOCK_TOP - (tall ? 0.15 : 0.12) - h / 2 + (tall ? 0.5 : 0), z);
      post.material = postMat;
      post.receiveShadows = true;
      shadows.addShadowCaster(post);
      if (tall) {
        const ring = CreateTorus(`rope${x}`, { diameter: 0.28, thickness: 0.06, tessellation: 8 }, scene);
        ring.position = new Vector3(x, DOCK_TOP + 0.15, z);
        ring.material = rope;
      }
    }
  }

  // Lantern on the end post: glows into the bloom.
  const lantern = CreateBox("lantern", { width: 0.18, height: 0.24, depth: 0.18 }, scene);
  lantern.position = new Vector3(-1.1, DOCK_TOP + 0.55, DOCK_END - 0.1);
  lantern.material = lowPolyMat(scene, "#FFC86B", { emissive: 1 });
  const cap = CreateCylinder("lanternCap", { diameterTop: 0, diameterBottom: 0.28, height: 0.12, tessellation: 4 }, scene);
  cap.position = new Vector3(-1.1, DOCK_TOP + 0.73, DOCK_END - 0.1);
  cap.material = lowPolyMat(scene, "#3A2A20");
}
