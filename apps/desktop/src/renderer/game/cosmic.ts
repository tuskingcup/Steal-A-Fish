import type { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import { hash01 } from "./materials";

/**
 * The density mutations' showpieces. A neutron-star fish is a pulsar: a blinding core, two beams
 * sweeping round like a lighthouse, magnetic field loops, shockwaves racing over the water. A
 * black-hole fish is a black hole: a black event horizon inside a bright photon ring, a spinning
 * accretion disk with its lensed halo, jets, matter and debris torn apart as they fall in, and a
 * whirlpool in the sea below. Both bring a starry sky of deep space with them.
 *
 * `power` (0…1) lets the reveal build the effect up and implode it back into the tiny fish.
 * Cosmetic only — driven by time and sine waves, never by game randomness.
 */

export type CosmicKind = "neutronStar" | "blackHole";

export interface Cosmic {
  glowMeshes: AbstractMesh[];
  update(timeSec: number, power: number): void;
  dispose(): void;
}

// ---------- Textures ----------

interface CosmicTextures {
  soft: DynamicTexture;
  flare: DynamicTexture;
  beam: DynamicTexture;
  disk: DynamicTexture;
  whirl: DynamicTexture;
  skyPulsar: DynamicTexture;
  skyVoid: DynamicTexture;
}

const texCache = new WeakMap<Scene, CosmicTextures>();

function make(scene: Scene, name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): DynamicTexture {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  draw(ctx);
  t.hasAlpha = true;
  t.update();
  return t;
}

/** Deep-space sky, drawn bottom-up (the bottom of the canvas lands on the dome's top pole). */
function starSky(scene: Scene, name: string, zenith: string, mid: string, horizon: string, glow: string): DynamicTexture {
  return make(scene, name, 1024, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 512, 0, 0);
    g.addColorStop(0, zenith);
    g.addColorStop(0.32, mid);
    g.addColorStop(0.47, horizon);
    g.addColorStop(0.5, glow);
    g.addColorStop(0.53, horizon);
    g.addColorStop(1, zenith);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    // A faint galactic band across the sky.
    for (let i = 0; i < 260; i++) {
      const x = hash01(i * 3 + 1) * 1024;
      const y = 300 + Math.sin(x / 160) * 50 + (hash01(i * 3 + 2) - 0.5) * 70;
      const r = 6 + hash01(i * 3 + 3) * 22;
      const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, "rgba(190,170,255,0.10)");
      cg.addColorStop(1, "rgba(190,170,255,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Stars, only above the horizon (the lower half of the canvas).
    for (let i = 0; i < 900; i++) {
      const x = hash01(i * 7 + 11) * 1024;
      const y = 262 + hash01(i * 7 + 12) * 250;
      const b = hash01(i * 7 + 13);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + b * 0.65})`;
      const s = b > 0.97 ? 2.2 : b > 0.85 ? 1.5 : 1;
      ctx.fillRect(x, y, s, s);
    }
  });
}

function textures(scene: Scene): CosmicTextures {
  const hit = texCache.get(scene);
  if (hit) return hit;
  const soft = make(scene, "cosmicSoft", 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,255,255,0.8)");
    g.addColorStop(0.5, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  // A lens flare: long thin spikes, a short diagonal pair, a soft centre.
  const flare = make(scene, "cosmicFlare", 256, 256, (ctx) => {
    const spike = (angle: number, len: number, width: number, alpha: number) => {
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate(angle);
      const g = ctx.createLinearGradient(-len, 0, len, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, -width);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, width);
      ctx.fill();
      ctx.restore();
    };
    spike(0, 128, 5, 1);
    spike(Math.PI / 2, 128, 5, 1);
    spike(Math.PI / 4, 70, 3, 0.6);
    spike(-Math.PI / 4, 70, 3, 0.6);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 40);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
  // Beam: brightest at one end (the star) and fading along its length, bright along its axis.
  const beam = make(scene, "cosmicBeam", 64, 256, (ctx) => {
    for (let y = 0; y < 256; y++) {
      const along = Math.pow(1 - y / 255, 1.6);
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, `rgba(255,255,255,${along})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 255 - y, 64, 1);
    }
  });
  // Accretion disk (additive): a hole in the middle, white-hot inner edge, orange, deep red,
  // with spiral streaks of hot gas.
  const disk = make(scene, "cosmicDisk", 512, 512, (ctx) => {
    const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.22, "rgba(0,0,0,1)");
    g.addColorStop(0.25, "rgb(255,250,235)");
    g.addColorStop(0.34, "rgb(255,205,120)");
    g.addColorStop(0.55, "rgb(235,110,40)");
    g.addColorStop(0.8, "rgb(110,25,20)");
    g.addColorStop(1, "rgb(0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 140; i++) {
      const r0 = 70 + hash01(i * 5 + 1) * 170;
      const a0 = hash01(i * 5 + 2) * Math.PI * 2;
      const sweep = 0.6 + hash01(i * 5 + 3) * 1.4;
      const heat = 1 - (r0 - 70) / 170;
      ctx.strokeStyle = `rgba(255,${Math.round(150 + heat * 100)},${Math.round(60 + heat * 150)},${0.12 + heat * 0.25})`;
      ctx.lineWidth = 1 + hash01(i * 5 + 4) * 3;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const s = k / 24;
        const a = a0 + s * sweep;
        const r = r0 * (1 - s * 0.18);
        const x = 256 + Math.cos(a) * r;
        const y = 256 + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  // Whirlpool (alpha-blended): dark water spiralling in, streaked with foam, fading at the rim.
  const whirl = make(scene, "cosmicWhirl", 512, 512, (ctx) => {
    const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    g.addColorStop(0, "rgba(2,6,16,1)");
    g.addColorStop(0.15, "rgba(6,20,40,0.95)");
    g.addColorStop(0.6, "rgba(12,50,80,0.6)");
    g.addColorStop(1, "rgba(20,80,110,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    for (let arm = 0; arm < 7; arm++) {
      ctx.strokeStyle = `rgba(210,240,255,${0.35 + (arm % 2) * 0.2})`;
      ctx.lineWidth = 3 + (arm % 3);
      ctx.beginPath();
      for (let k = 0; k <= 60; k++) {
        const s = k / 60;
        const r = 30 + s * 215;
        const a = (arm / 7) * Math.PI * 2 + Math.log(r / 30) * 1.9;
        const x = 256 + Math.cos(a) * r;
        const y = 256 + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  const skyPulsar = starSky(scene, "skyPulsar", "rgb(2,4,14)", "rgb(6,14,40)", "rgb(16,40,95)", "rgb(90,150,255)");
  const skyVoid = starSky(scene, "skyVoid", "rgb(3,0,8)", "rgb(16,4,32)", "rgb(48,12,70)", "rgb(255,140,70)");
  const all = { soft, flare, beam, disk, whirl, skyPulsar, skyVoid };
  texCache.set(scene, all);
  return all;
}

// ---------- Materials ----------

function glowMat(scene: Scene, name: string, color: string, opacity?: DynamicTexture): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString(color);
  if (opacity) m.opacityTexture = opacity;
  m.alphaMode = Engine.ALPHA_ADD;
  m.backFaceCulling = false;
  m.fogEnabled = false;
  return m;
}

/** Additive material whose colour comes from a texture (black = invisible). */
function texGlowMat(scene: Scene, name: string, tex: DynamicTexture): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveTexture = tex;
  m.diffuseColor = Color3.Black();
  m.alphaMode = Engine.ALPHA_ADD;
  m.backFaceCulling = false;
  m.fogEnabled = false;
  return m;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- The effect ----------

/**
 * @param anchor follows the fish
 * @param size   scale of the effect in scene units (the black hole's disk reaches ~2× this)
 */
export function createCosmic(scene: Scene, anchor: TransformNode, size: number, kind: CosmicKind): Cosmic {
  const tx = textures(scene);
  const S = size;
  const glowMeshes: AbstractMesh[] = [];
  const disposables: { dispose(): void }[] = [];
  const systems: { ps: ParticleSystem; rate: number }[] = [];
  const updates: ((t: number, p: number) => void)[] = [];

  // Around the fish, scaled by power.
  const root = new TransformNode("cosmic", scene);
  root.parent = anchor;
  // At sea level under the fish (sky, water effects), not scaled.
  const ground = new TransformNode("cosmicGround", scene);
  const mat = (m: StandardMaterial) => {
    disposables.push(m);
    return m;
  };
  const billboard = (name: string, parent: TransformNode) => {
    const n = new TransformNode(name, scene);
    n.parent = parent;
    n.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    return n;
  };
  const sprite = (name: string, parent: TransformNode, w: number, m: StandardMaterial) => {
    const p = CreatePlane(name, { size: w }, scene);
    p.parent = parent;
    p.material = m;
    p.isPickable = false;
    return p;
  };

  // Deep space overhead, and the sea darkened beneath it (kept inside the bay's sky sphere).
  const sky = CreateSphere("cosmicSky", { diameter: 480, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.parent = ground;
  const skyMat = mat(new StandardMaterial("cosmicSkyMat", scene));
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = kind === "blackHole" ? tx.skyVoid : tx.skyPulsar;
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  const shade = CreateDisc("cosmicShade", { radius: 230, tessellation: 48 }, scene);
  shade.parent = ground;
  shade.rotation.x = Math.PI / 2;
  shade.position.y = 0.02;
  const shadeMat = mat(new StandardMaterial("cosmicShadeMat", scene));
  shadeMat.disableLighting = true;
  shadeMat.diffuseColor = Color3.Black();
  shadeMat.emissiveColor = kind === "blackHole" ? Color3.FromHexString("#0B0518") : Color3.FromHexString("#040C1E");
  shadeMat.fogEnabled = false;
  shade.material = shadeMat;
  updates.push((_t, p) => {
    // Opaque once the effect is up; fades in and out with it.
    skyMat.alpha = Math.min(1, p * 1.4);
    shadeMat.alpha = Math.min(0.72, p * 0.9);
    sky.setEnabled(p > 0.02);
    shade.setEnabled(p > 0.02);
  });

  const light = new PointLight("cosmicLight", Vector3.Zero(), scene);
  light.parent = root;
  light.diffuse = kind === "blackHole" ? Color3.FromHexString("#FF9A4A") : Color3.FromHexString("#9CC4FF");
  light.range = S * 14;
  disposables.push(light);
  updates.push((t, p) => {
    light.intensity = p * (kind === "neutronStar" ? 1.1 + Math.pow(Math.max(0, Math.sin(t * 9)), 6) * 0.8 : 1.6);
  });

  if (kind === "neutronStar") {
    // Core: a blinding white point inside a blue corona and a lens flare.
    // Behind the fish (a billboard's +z points away from the camera), so the fish stays in view.
    const faceRoot = billboard("pulsarFace", root);
    const face = new TransformNode("pulsarBack", scene);
    face.parent = faceRoot;
    face.position.z = S * 0.7;
    const corona = sprite("corona", face, S * 1.8, mat(glowMat(scene, "coronaMat", "#2F5FD0", tx.soft)));
    corona.visibility = 0.6;
    const core = sprite("core", face, S * 0.55, mat(glowMat(scene, "coreMat", "#FFFFFF", tx.soft)));
    const flare = sprite("flare", face, S * 3.2, mat(glowMat(scene, "flareMat", "#A8C8FF", tx.flare)));
    flare.visibility = 0.7;
    updates.push((t, p) => {
      const beat = Math.pow(Math.max(0, Math.sin(t * 9)), 6); // a sharp pulse several times a second
      // Light grows with the power, so the close-up at the start shows the fish, not a white-out.
      const up = smoothstep(0.15, 0.85, p);
      core.visibility = up;
      corona.visibility = 0.6 * up;
      flare.visibility = 0.7 * up;
      core.scaling.setAll(1 + beat * 0.6);
      corona.scaling.setAll(1 + beat * 0.25);
      flare.scaling.setAll(0.8 + beat * 0.5);
      flare.rotation.z = t * 0.15;
    });

    // The spinning star: beams from both magnetic poles, tilted off the spin axis, sweeping round.
    const spin = new TransformNode("pulsarSpin", scene);
    spin.parent = root;
    const tilt = new TransformNode("pulsarTilt", scene);
    tilt.parent = spin;
    tilt.rotation.z = 0.55;
    const beamMat = mat(glowMat(scene, "beamMat", "#3F8BFF", tx.beam));
    const beamCoreMat = mat(glowMat(scene, "beamCoreMat", "#FFFFFF", tx.beam));
    for (const dir of [1, -1]) {
      for (const [w, m] of [[S * 0.55, beamMat], [S * 0.14, beamCoreMat]] as const) {
        const beam = CreateCylinder("pulsarBeam", { height: S * 9, diameterTop: w, diameterBottom: S * 0.08, tessellation: 16, cap: Mesh.NO_CAP }, scene);
        beam.parent = tilt;
        beam.material = m;
        beam.position.y = dir * S * 4.6;
        if (dir < 0) beam.rotation.z = Math.PI;
      }
    }
    // Magnetic field loops: dipole lines r = L·sin²θ around the magnetic axis.
    const fieldMat = mat(glowMat(scene, "fieldMat", "#3FA8E8"));
    for (const L of [S * 1.3, S * 2.1]) {
      for (let k = 0; k < 6; k++) {
        const phi = (k / 6) * Math.PI * 2 + (L > S * 2 ? 0.5 : 0);
        const path: Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const th = 0.25 + (i / 32) * (Math.PI - 0.5);
          const r = L * Math.sin(th) ** 2;
          path.push(new Vector3(r * Math.sin(th) * Math.cos(phi), r * Math.cos(th), r * Math.sin(th) * Math.sin(phi)));
        }
        const line = CreateTube("fieldLine", { path, radius: S * 0.008, tessellation: 5 }, scene);
        line.parent = tilt;
        line.material = fieldMat;
        glowMeshes.push(line);
      }
    }
    const beams = tilt.getChildMeshes(true).filter((m) => m.name === "pulsarBeam");
    updates.push((t, p) => {
      spin.rotation.y = t * 5.5; // lighthouse sweep
      for (const b of beams) b.visibility = smoothstep(0.35, 0.8, p);
    });

    // Shockwaves: rings bursting from the star, and rings racing out over the sea.
    const shockMat = mat(glowMat(scene, "shockMat", "#7FAEFF"));
    const shockFace = billboard("shockFace", root);
    const shocks = [0, 1, 2].map(() => {
      const r = CreateTorus("shock", { diameter: 1, thickness: 0.012, tessellation: 48 }, scene);
      r.parent = shockFace;
      r.rotation.x = Math.PI / 2;
      r.material = shockMat;
      return r;
    });
    const seaMat = mat(glowMat(scene, "seaShockMat", "#9CC8FF"));
    const seaRings = [0, 1, 2, 3].map(() => {
      const r = CreateTorus("seaShock", { diameter: 1, thickness: 0.012, tessellation: 64 }, scene);
      r.parent = ground;
      r.position.y = 0.06;
      r.material = seaMat;
      return r;
    });
    updates.push((t, p) => {
      shocks.forEach((r, i) => {
        const phase = (t * 0.9 + i / 3) % 1;
        r.scaling.setAll(S * (0.8 + phase * 4.5));
        r.visibility = (1 - phase) * 0.6;
      });
      seaRings.forEach((r, i) => {
        const phase = (t * 0.45 + i / 4) % 1;
        r.scaling.setAll(S * (1 + phase * 14) * Math.max(p, 0.001));
        r.visibility = (1 - phase) * p;
      });
    });

    const sparks = new ParticleSystem("pulsarSparks", 400, scene);
    sparks.particleTexture = tx.soft;
    sparks.emitter = root as unknown as AbstractMesh;
    sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    sparks.minEmitBox = new Vector3(-S * 0.1, -S * 0.1, -S * 0.1);
    sparks.maxEmitBox = new Vector3(S * 0.1, S * 0.1, S * 0.1);
    sparks.color1 = new Color4(0.45, 0.7, 1, 1);
    sparks.color2 = new Color4(0.85, 0.92, 1, 1);
    sparks.colorDead = new Color4(0.4, 0.6, 1, 0);
    sparks.minSize = S * 0.03;
    sparks.maxSize = S * 0.09;
    sparks.minLifeTime = 0.4;
    sparks.maxLifeTime = 1.1;
    sparks.direction1 = new Vector3(-1, -1, -1).scale(S * 2.5);
    sparks.direction2 = new Vector3(1, 1, 1).scale(S * 2.5);
    systems.push({ ps: sparks, rate: 160 });
  } else {
    // Black hole. The disk lies tilted towards the camera and spins.
    const tilt = new TransformNode("diskTilt", scene);
    tilt.parent = root;
    tilt.rotation.x = -0.32;
    tilt.rotation.z = 0.12;
    const diskSpin = new TransformNode("diskSpin", scene);
    diskSpin.parent = tilt;
    const diskMat = mat(texGlowMat(scene, "diskMat", tx.disk));
    const disk = CreateDisc("accretionDisk", { radius: S * 2.1, tessellation: 64 }, scene);
    disk.parent = diskSpin;
    disk.rotation.x = Math.PI / 2;
    disk.material = diskMat;

    // The event horizon: pure black, drawn as an opaque sphere so it hides the disk behind it.
    const horizonMat = mat(new StandardMaterial("horizonMat", scene));
    horizonMat.disableLighting = true;
    horizonMat.diffuseColor = Color3.Black();
    horizonMat.emissiveColor = Color3.Black();
    horizonMat.specularColor = Color3.Black();
    horizonMat.fogEnabled = false;
    // The hole sits just behind the fish (a billboard's +z points away from the camera): the fish
    // is silhouetted against it, ringed by light.
    const faceRoot = billboard("holeFace", root);
    const face = new TransformNode("holeBack", scene);
    face.parent = faceRoot;
    face.position.z = S * 0.9;
    const horizon = CreateSphere("eventHorizon", { diameter: S * 1.15, segments: 24 }, scene);
    horizon.parent = face;
    horizon.material = horizonMat;

    // Photon ring hugging the horizon, and the disk's far side lensed into a halo around it.
    const photon = CreateTorus("photonRing", { diameter: S * 1.24, thickness: S * 0.04, tessellation: 64 }, scene);
    photon.parent = face;
    photon.rotation.x = Math.PI / 2;
    photon.material = mat(glowMat(scene, "photonMat", "#FFE7C2"));
    glowMeshes.push(photon);
    const lensMat = mat(glowMat(scene, "lensMat", "#FF9C4A"));
    const lens = CreateTorus("lensHalo", { diameter: S * 1.44, thickness: S * 0.08, tessellation: 64 }, scene);
    lens.parent = face;
    lens.rotation.x = Math.PI / 2;
    lens.material = lensMat;
    lens.visibility = 0.45;
    const haze = sprite("holeHaze", face, S * 5, mat(glowMat(scene, "holeHazeMat", "#6A2A9A", tx.soft)));
    haze.position.z = S * 0.5; // behind the hole
    haze.visibility = 0.7;

    // Jets along the spin axis.
    const jetMat = mat(glowMat(scene, "jetMat", "#A98CFF", tx.beam));
    const jets: Mesh[] = [];
    for (const dir of [1, -1]) {
      const jet = CreateCylinder("jet", { height: S * 8, diameterTop: S * 0.6, diameterBottom: S * 0.05, tessellation: 16, cap: Mesh.NO_CAP }, scene);
      jet.parent = tilt;
      jet.material = jetMat;
      jet.position.y = dir * S * 4.3;
      if (dir < 0) jet.rotation.z = Math.PI;
      jets.push(jet);
    }

    // Debris torn apart as it falls in: stretched along its orbit, shrinking to nothing.
    const debrisMat = mat(new StandardMaterial("debrisMat", scene));
    debrisMat.diffuseColor = Color3.FromHexString("#8A6A4E");
    debrisMat.emissiveColor = Color3.FromHexString("#3A1E10");
    const debris = Array.from({ length: 22 }, (_, i) => {
      const b = CreateBox("debris", { size: S * (0.06 + hash01(i) * 0.08) }, scene);
      b.parent = tilt;
      b.material = debrisMat;
      return b;
    });

    updates.push((t, p) => {
      diskSpin.rotation.y = -t * 1.6;
      lensMat.emissiveColor.set(1, 0.55 + Math.sin(t * 3) * 0.05, 0.28);
      jets.forEach((j, i) => (j.visibility = (0.6 + Math.sin(t * 23 + i * 2) * 0.25) * smoothstep(0.35, 0.8, p)));
      debris.forEach((b, i) => {
        const phase = (t * (0.18 + hash01(i + 40) * 0.12) + hash01(i + 70)) % 1;
        const r = S * (4.2 * (1 - phase) + 0.58);
        const a = hash01(i + 90) * Math.PI * 2 + phase * (6 + 10 * phase);
        b.position.set(Math.cos(a) * r, Math.sin(phase * 9 + i) * S * 0.15 * (1 - phase), Math.sin(a) * r);
        b.rotation.y = -a;
        const stretch = 1 + phase * phase * 6; // spaghettification
        b.scaling.set(stretch, 1 / Math.sqrt(stretch), 1 / Math.sqrt(stretch));
        b.setEnabled(p > 0.35 && phase < 0.97);
      });
    });

    // Matter spiralling in, glowing hotter as it nears the horizon.
    const inspiral = new ParticleSystem("inspiral", 900, scene);
    inspiral.particleTexture = tx.soft;
    inspiral.emitter = root as unknown as AbstractMesh;
    inspiral.blendMode = ParticleSystem.BLENDMODE_ADD;
    inspiral.minSize = S * 0.05;
    inspiral.maxSize = S * 0.11;
    inspiral.minLifeTime = 2;
    inspiral.maxLifeTime = 3;
    const centre = new Vector3();
    inspiral.startPositionFunction = (_world, pos, particle) => {
      const a = (particle.id * 2.399) % (Math.PI * 2);
      const r = S * (2.6 + ((particle.id * 0.618) % 1) * 1.6);
      pos.set(Math.cos(a) * r, ((particle.id * 0.37) % 1 - 0.5) * S * 0.15, Math.sin(a) * r);
      Vector3.TransformCoordinatesToRef(pos, tilt.getWorldMatrix(), pos);
    };
    inspiral.updateFunction = (list) => {
      centre.copyFrom(root.getAbsolutePosition());
      const dt = scene.getEngine().getDeltaTime() / 1000;
      for (let i = list.length - 1; i >= 0; i--) {
        const q = list[i]!;
        q.age += dt;
        if (q.age >= q.lifeTime) {
          inspiral.recycleParticle(q);
          continue;
        }
        const d = q.position.subtract(centre);
        const r = d.length();
        if (r < S * 0.6) {
          inspiral.recycleParticle(q);
          continue;
        }
        // Swirl round the centre (faster further in) and fall inwards.
        const swirl = Math.min(0.25, (dt * 2.2 * S) / Math.max(r, 0.01));
        const axis = Vector3.TransformNormal(Vector3.Up(), tilt.getWorldMatrix()).normalize();
        const tangent = Vector3.Cross(axis, d).normalize();
        q.position.addInPlace(tangent.scale(r * swirl)).addInPlace(d.scale(-dt * 0.45));
        const heat = 1 - Math.min(1, r / (S * 3.5));
        q.color.set(1, 0.4 + heat * 0.55, 0.15 + heat * 0.75, Math.min(1, q.age * 2) * 0.9);
      }
    };
    systems.push({ ps: inspiral, rate: 320 });

    // A whirlpool opening in the sea under it.
    const whirlMat = mat(new StandardMaterial("whirlMat", scene));
    whirlMat.diffuseTexture = tx.whirl;
    whirlMat.useAlphaFromDiffuseTexture = true;
    whirlMat.disableLighting = true;
    whirlMat.fogEnabled = false;
    whirlMat.backFaceCulling = false;
    const whirl = CreateDisc("whirlpool", { radius: S * 4.5, tessellation: 64 }, scene);
    whirl.parent = ground;
    whirl.rotation.x = Math.PI / 2;
    whirl.position.y = 0.05;
    whirl.material = whirlMat;
    updates.push((t, p) => {
      whirl.rotation.y = t * 1.2;
      whirl.scaling.setAll(Math.max(0.001, p));
      whirl.visibility = p;
    });
  }

  for (const s of systems) s.ps.start();

  return {
    glowMeshes,
    update(t, power) {
      const p = Math.max(0, Math.min(1, power));
      const at = anchor.getAbsolutePosition();
      ground.position.set(at.x, 0, at.z);
      root.scaling.setAll(Math.max(0.0001, 0.08 + 0.92 * p));
      for (const s of systems) s.ps.emitRate = s.rate * p;
      for (const u of updates) u(t, p);
    },
    dispose() {
      for (const s of systems) s.ps.dispose(false);
      for (const d of disposables) d.dispose();
      root.dispose(false, true);
      ground.dispose(false, true);
    },
  };
}
