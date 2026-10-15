import type { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import "@babylonjs/core/Layers/effectLayerSceneComponent";
import type { Rarity } from "@saf/core";
import type { Finish } from "./fishModels";
import { createCosmic, type Cosmic } from "./cosmic";

/**
 * Showpiece effects around a displayed fish, so rare catches feel grand: a glow layer on the fish
 * and its effects, a particle signature per mutation (gold glitter, diamond twinkles, lava embers
 * and smoke; neutron stars and black holes get the cosmic showpieces in cosmic.ts), god rays behind Legendary+ fish, and
 * for Mythic a halo, a beam of light from the sky and a purple-gold sky. Purely cosmetic; driven
 * by sine waves and particle emitters, never by game randomness.
 */

export interface Aura {
  /** Meshes the glow layer should light up. */
  glowMeshes: AbstractMesh[];
  /** `power` (0…1) scales the density mutations' cosmic effect; other effects ignore it. */
  update(timeSec: number, power?: number): void;
  dispose(): void;
}

// ---------- Shared textures ----------

const texCache = new WeakMap<Scene, { soft: DynamicTexture; star: DynamicTexture; ray: DynamicTexture; sky: DynamicTexture }>();

function textures(scene: Scene) {
  const hit = texCache.get(scene);
  if (hit) return hit;
  const make = (name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
    const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    t.hasAlpha = true;
    t.update();
    return t;
  };
  const soft = make("fxSoft", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const star = make("fxStar", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 10);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    for (const [dx, dy] of [[0, -30], [3, 0], [0, 30], [-3, 0]] as const) ctx.lineTo(32 + dx, 32 + dy);
    ctx.fill();
    ctx.beginPath();
    for (const [dx, dy] of [[-30, 0], [0, 3], [30, 0], [0, -3]] as const) ctx.lineTo(32 + dx, 32 + dy);
    ctx.fill();
  });
  const ray = make("fxRay", 16, 128, (ctx) => {
    // Faint at the base (rays overlap there and would burn the fish out), bright a little out, fading away.
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.3, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(4, 0, 8, 128);
    ctx.globalAlpha = 0.3;
    ctx.fillRect(0, 0, 16, 128);
  });
  const sky = make("fxSky", 4, 128, (ctx) => {
    // Drawn bottom-up: the bottom of the canvas lands on the dome's top pole.
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    // Deep violet overhead, magenta low in the sky, a thin gold band on the horizon (0.5). The
    // portrait camera sees only the lowest ~15° of sky, so the colours crowd towards the horizon.
    // Opaque: the stage water hides the lower half.
    g.addColorStop(0, "rgb(40,15,95)");
    g.addColorStop(0.32, "rgb(95,40,175)");
    g.addColorStop(0.44, "rgb(175,70,195)");
    g.addColorStop(0.485, "rgb(255,140,150)");
    g.addColorStop(0.5, "rgb(255,215,125)");
    g.addColorStop(1, "rgb(255,215,125)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
  });
  const all = { soft, star, ray, sky };
  texCache.set(scene, all);
  return all;
}

function additive(scene: Scene, name: string, color: string, tex?: DynamicTexture): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString(color);
  if (tex) {
    m.opacityTexture = tex;
  }
  m.alphaMode = Engine.ALPHA_ADD;
  m.backFaceCulling = false;
  m.fogEnabled = false;
  return m;
}

function particles(scene: Scene, name: string, emitter: TransformNode, tex: DynamicTexture, capacity: number): ParticleSystem {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = tex;
  ps.emitter = emitter as unknown as AbstractMesh;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  return ps;
}

// ---------- Glow ----------

const glowCache = new WeakMap<Scene, GlowLayer>();

/** One glow layer per scene, lighting only meshes explicitly added (fish and effects). */
export function glowFor(scene: Scene): GlowLayer {
  let g = glowCache.get(scene);
  if (!g) {
    g = new GlowLayer("fxGlow", scene, { blurKernelSize: 48, mainTextureSamples: 2 });
    g.intensity = 0.65;
    g.isEnabled = false; // with no meshes listed, a glow layer would light everything
    glowCache.set(scene, g);
  }
  return g;
}

// ---------- Aura ----------

/**
 * @param anchor node at the fish's centre (effects follow it)
 * @param size   fish length in scene units
 */
export function createAura(scene: Scene, anchor: TransformNode, size: number, rarity: Rarity, finish: Finish): Aura {
  const tx = textures(scene);
  const root = new TransformNode("aura", scene);
  root.parent = anchor;
  const glowMeshes: AbstractMesh[] = [];
  const systems: ParticleSystem[] = [];
  const disposables: { dispose(): void }[] = [];
  const updates: ((t: number) => void)[] = [];
  const grand = rarity === "legendary" || rarity === "mythic";
  const mythic = rarity === "mythic";

  // God rays: a slowly turning fan of light behind Legendary+ fish (always facing the camera).
  if (grand) {
    const face = new TransformNode("rayFace", scene);
    face.parent = root;
    face.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    const spin = new TransformNode("raySpin", scene);
    spin.parent = face;
    spin.position.z = size * 0.35; // just behind the fish
    const mat = additive(scene, "rayMat", mythic ? "#FFD27A" : "#FFC24A", tx.ray);
    disposables.push(mat);
    const count = mythic ? 14 : 10;
    for (let i = 0; i < count; i++) {
      const ray = CreatePlane("ray", { width: size * 0.16, height: size * 1.7 }, scene);
      ray.parent = spin;
      ray.setPivotPoint(new Vector3(0, -size * 0.85, 0));
      ray.position.y = size * 0.85;
      ray.rotation.z = (i / count) * Math.PI * 2;
      ray.material = mat;
      ray.visibility = 0.55;
    }
    updates.push((t) => {
      spin.rotation.z = t * 0.12;
    });
    disposables.push(face);
  }

  // Mythic: halo rings, a beam of light from the sky, and a darkened purple-gold sky.
  if (mythic) {
    const face = new TransformNode("haloFace", scene);
    face.parent = root;
    face.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    const goldRing = CreateTorus("halo", { diameter: size * 1.45, thickness: size * 0.025, tessellation: 48 }, scene);
    goldRing.parent = face;
    goldRing.rotation.x = Math.PI / 2;
    goldRing.position.z = size * 0.6;
    const haloMat = additive(scene, "haloMat", "#FFD86B");
    goldRing.material = haloMat;
    const inner = CreateTorus("halo2", { diameter: size * 1.2, thickness: size * 0.012, tessellation: 48 }, scene);
    inner.parent = face;
    inner.rotation.x = Math.PI / 2;
    inner.position.z = size * 0.62;
    inner.material = additive(scene, "haloMat2", "#C38BFF");
    glowMeshes.push(goldRing, inner);

    const beam = CreateCylinder("beam", { height: size * 14, diameterTop: size * 1.6, diameterBottom: size * 0.7, tessellation: 24, cap: Mesh.NO_CAP }, scene);
    beam.parent = root;
    // From the sky down to just above the fish, a little behind it, so it never covers the fish.
    beam.position.set(0, size * 7.4, -size * 0.7);
    const beamMat = additive(scene, "beamMat", "#FFE3A0", tx.ray);
    beamMat.alpha = 0.35;
    beam.material = beamMat;

    // Must stay inside the bay's sky sphere (radius 400 around the camera) or that sphere hides it.
    const skyDome = CreateSphere("mythicSky", { diameter: 480, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
    skyDome.parent = root;
    const skyMat = new StandardMaterial("mythicSkyMat", scene);
    skyMat.disableLighting = true;
    skyMat.emissiveTexture = tx.sky;
    skyMat.fogEnabled = false;
    skyDome.material = skyMat;
    updates.push((t) => {
      goldRing.rotation.y = t * 0.6;
      inner.rotation.y = -t * 0.9;
      beamMat.alpha = 0.16 + Math.sin(t * 2) * 0.05;
    });
    disposables.push(face, beam, skyDome, skyMat, beamMat, haloMat);
  }

  // Rising golden motes for anything Legendary+.
  if (grand) {
    const ps = particles(scene, "motes", root, tx.soft, 300);
    ps.minEmitBox = new Vector3(-size * 0.7, -size * 0.4, -size * 0.4);
    ps.maxEmitBox = new Vector3(size * 0.7, size * 0.2, size * 0.4);
    ps.color1 = new Color4(1, 0.85, 0.35, 1);
    ps.color2 = new Color4(1, 0.6, 0.2, 1);
    ps.colorDead = new Color4(1, 0.5, 0.1, 0);
    ps.minSize = size * 0.02;
    ps.maxSize = size * 0.05;
    ps.minLifeTime = 1.2;
    ps.maxLifeTime = 2.4;
    ps.emitRate = mythic ? 120 : 60;
    ps.direction1 = new Vector3(-0.1, 1, -0.1).scale(size * 0.25);
    ps.direction2 = new Vector3(0.1, 1, 0.1).scale(size * 0.25);
    systems.push(ps);
  }

  // Mutation signatures.
  let cosmic: Cosmic | null = null;
  const box = (ps: ParticleSystem, k = 0.55) => {
    ps.minEmitBox = new Vector3(-size * k, -size * k * 0.35, -size * k * 0.35);
    ps.maxEmitBox = new Vector3(size * k, size * k * 0.35, size * k * 0.35);
  };
  switch (finish) {
    case "gold": {
      const ps = particles(scene, "goldGlitter", root, tx.star, 250);
      box(ps);
      ps.color1 = new Color4(1, 0.88, 0.4, 1);
      ps.color2 = new Color4(1, 0.95, 0.7, 1);
      ps.colorDead = new Color4(1, 0.8, 0.3, 0);
      ps.minSize = size * 0.02;
      ps.maxSize = size * 0.06;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.9;
      ps.emitRate = 90;
      ps.minAngularSpeed = -2;
      ps.maxAngularSpeed = 2;
      ps.direction1 = new Vector3(-0.05, 0.05, -0.05).scale(size);
      ps.direction2 = new Vector3(0.05, 0.15, 0.05).scale(size);
      systems.push(ps);
      break;
    }
    case "diamond": {
      const ps = particles(scene, "diamondTwinkle", root, tx.star, 200);
      box(ps, 0.7);
      ps.color1 = new Color4(0.85, 1, 1, 1);
      ps.color2 = new Color4(0.6, 0.85, 1, 1);
      ps.colorDead = new Color4(0.8, 0.95, 1, 0);
      ps.minSize = size * 0.04;
      ps.maxSize = size * 0.1;
      ps.minLifeTime = 0.3;
      ps.maxLifeTime = 0.7;
      ps.emitRate = 45;
      ps.direction1 = Vector3.Zero();
      ps.direction2 = Vector3.Zero();
      ps.addSizeGradient(0, 0);
      ps.addSizeGradient(0.5, 1);
      ps.addSizeGradient(1, 0);
      systems.push(ps);
      break;
    }
    case "lava": {
      const embers = particles(scene, "embers", root, tx.soft, 400);
      box(embers);
      embers.color1 = new Color4(1, 0.55, 0.1, 1);
      embers.color2 = new Color4(1, 0.25, 0.05, 1);
      embers.colorDead = new Color4(0.4, 0.05, 0, 0);
      embers.minSize = size * 0.015;
      embers.maxSize = size * 0.04;
      embers.minLifeTime = 0.8;
      embers.maxLifeTime = 1.8;
      embers.emitRate = 160;
      embers.direction1 = new Vector3(-0.15, 0.6, -0.15).scale(size);
      embers.direction2 = new Vector3(0.15, 1.1, 0.15).scale(size);
      embers.gravity = new Vector3(0, size * 0.2, 0);
      const smoke = particles(scene, "smoke", root, tx.soft, 120);
      box(smoke, 0.4);
      smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      smoke.color1 = new Color4(0.15, 0.1, 0.1, 0.45);
      smoke.color2 = new Color4(0.3, 0.2, 0.15, 0.35);
      smoke.colorDead = new Color4(0.2, 0.2, 0.2, 0);
      smoke.minSize = size * 0.25;
      smoke.maxSize = size * 0.5;
      smoke.minLifeTime = 1.5;
      smoke.maxLifeTime = 3;
      smoke.emitRate = 25;
      smoke.direction1 = new Vector3(-0.05, 0.4, -0.05).scale(size);
      smoke.direction2 = new Vector3(0.05, 0.6, 0.05).scale(size);
      systems.push(embers, smoke);
      break;
    }
    case "neutronStar":
    case "blackHole": {
      // The density mutations get a full cosmic showpiece (see cosmic.ts).
      cosmic = createCosmic(scene, anchor, size, finish);
      glowMeshes.push(...cosmic.glowMeshes);
      break;
    }
    case "normal":
      break;
  }

  for (const ps of systems) ps.start();

  return {
    glowMeshes,
    update(t, power = 1) {
      for (const u of updates) u(t);
      cosmic?.update(t, power);
    },
    dispose() {
      cosmic?.dispose();
      for (const ps of systems) ps.dispose(false);
      for (const d of disposables) d.dispose();
      root.dispose(false, true);
    },
  };
}

/** A one-shot burst of spray, for the moment a fish breaks the surface. */
export function splashBurst(scene: Scene, at: Vector3, size: number): () => void {
  const tx = textures(scene);
  const node = new TransformNode("splashAt", scene);
  node.position.copyFrom(at);
  const ps = particles(scene, "splash", node, tx.soft, 900);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.minEmitBox = new Vector3(-size * 0.4, 0, -size * 0.2);
  ps.maxEmitBox = new Vector3(size * 0.4, 0, size * 0.2);
  ps.color1 = new Color4(1, 1, 1, 0.95);
  ps.color2 = new Color4(0.75, 0.92, 1, 0.9);
  ps.colorDead = new Color4(0.8, 0.95, 1, 0);
  ps.minSize = size * 0.04;
  ps.maxSize = size * 0.12;
  ps.minLifeTime = 0.8;
  ps.maxLifeTime = 1.6;
  ps.direction1 = new Vector3(-0.9, 2.2, -0.5).scale(size);
  ps.direction2 = new Vector3(0.9, 3.4, 0.5).scale(size);
  ps.gravity = new Vector3(0, -4 * size, 0);
  ps.manualEmitCount = 700;
  ps.targetStopDuration = 2;
  ps.disposeOnStop = true;
  ps.start();
  return () => {
    ps.dispose();
    node.dispose();
  };
}
