import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

const cache = new WeakMap<Scene, Map<string, StandardMaterial>>();

/** Matte flat-colour material, shared per scene by colour. */
export function lowPolyMat(scene: Scene, hex: string, opts: { specular?: number; emissive?: number } = {}): StandardMaterial {
  const key = `${hex}|${opts.specular ?? 0.04}|${opts.emissive ?? 0}`;
  let perScene = cache.get(scene);
  if (!perScene) cache.set(scene, (perScene = new Map()));
  const hit = perScene.get(key);
  if (hit) return hit;

  const mat = new StandardMaterial(`mat${hex}`, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  const s = opts.specular ?? 0.04;
  mat.specularColor = new Color3(s, s, s);
  mat.emissiveColor = color.scale(opts.emissive ?? 0);
  perScene.set(key, mat);
  return mat;
}

/** Faceted look: unshare vertices so every triangle gets its own normal. */
export function flat<T extends Mesh>(mesh: T): T {
  mesh.convertToFlatShadedMesh();
  return mesh;
}

/** Deterministic 0..1 hash for decorative jitter (not game RNG). */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
