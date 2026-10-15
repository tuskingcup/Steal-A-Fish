import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { avatarFor, type MutationId } from "@saf/core";
import { createFishModel, isDense, type FishModel } from "./fishModels";
import { createFisherSprite, type FisherSprite } from "./fisherSprite";
import { flat, hash01, lowPolyMat } from "./materials";
import { beachHeight } from "./seaside";

/**
 * The round summary's fish tank: a big aquarium on the beach where the selected player's catches
 * swim as 3D models, sized by weight (cube root, relative to their biggest fish), with the player
 * standing beside it. Hidden outside the summary.
 */

export interface TankFish {
  speciesId: string;
  mutations: MutationId[];
  weightLog10: number;
}

export interface TankOwner {
  userId: string;
  fish: TankFish[];
}

export interface CameraPose {
  target: Vector3;
  alpha: number;
  beta: number;
  radius: number;
}

export interface Showcase {
  /** Fill the tank with someone's fish (most valuable first), or hide it. */
  show(owner: TankOwner | null): void;
  update(camera: Camera, timeSec: number): void;
  cameraPose(): CameraPose;
}

/** Most fish shown at once; the summary list still has every one. */
const MAX_FISH = 10;
const W = 2.3;
const H = 1.9;
const D = 1.6;
const CABINET = 0.7;
const BIGGEST = 0.9;
const SMALLEST = 0.26;
/** Neutron-star and black-hole fish: absurdly heavy, drawn tiny. */
const DENSE_SIZE = 0.3;

interface Swimmer {
  model: FishModel;
  length: number;
  center: Vector3;
  rx: number;
  rz: number;
  speed: number;
  phase: number;
  dir: number;
}

export function createShowcase(scene: Scene, shadows: ShadowGenerator, x: number, z: number): Showcase {
  const ground = beachHeight(x, z);
  const root = new TransformNode("fishTank", scene);
  root.position = new Vector3(x, ground, z);
  const bottom = CABINET; // tank floor, tank-local
  const part = (mesh: Mesh, color: string, opts?: { specular?: number; emissive?: number }) => {
    mesh.parent = root;
    mesh.material = lowPolyMat(scene, color, opts);
    return mesh;
  };

  // Wooden cabinet, glass box with a dark frame, and a lit lid.
  const cabinet = part(CreateBox("tankCabinet", { width: W + 0.2, height: CABINET, depth: D + 0.2 }, scene), "#6B4A32");
  cabinet.position.y = CABINET / 2;
  cabinet.receiveShadows = true;
  shadows.addShadowCaster(cabinet);

  const glass = CreateBox("tankGlass", { width: W, height: H, depth: D }, scene);
  glass.parent = root;
  glass.position.y = bottom + H / 2;
  const glassMat = new StandardMaterial("tankGlassMat", scene);
  glassMat.diffuseColor = Color3.FromHexString("#7FD3E6");
  glassMat.emissiveColor = Color3.FromHexString("#0E3A4A");
  glassMat.specularColor = new Color3(0.9, 0.9, 0.9);
  glassMat.specularPower = 64;
  glassMat.alpha = 0.16;
  glassMat.backFaceCulling = false;
  glass.material = glassMat;

  const frame = "#2B2B33";
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const post = part(CreateBox("tankPost", { width: 0.06, height: H, depth: 0.06 }, scene), frame);
    post.position = new Vector3((sx * W) / 2, bottom + H / 2, (sz * D) / 2);
  }
  for (const y of [bottom, bottom + H]) {
    for (const sz of [-1, 1]) {
      const rail = part(CreateBox("tankRail", { width: W + 0.06, height: 0.06, depth: 0.06 }, scene), frame);
      rail.position = new Vector3(0, y, (sz * D) / 2);
    }
    for (const sx of [-1, 1]) {
      const rail = part(CreateBox("tankRail", { width: 0.06, height: 0.06, depth: D + 0.06 }, scene), frame);
      rail.position = new Vector3((sx * W) / 2, y, 0);
    }
  }
  const lid = part(CreateBox("tankLid", { width: W + 0.1, height: 0.1, depth: D + 0.1 }, scene), frame);
  lid.position.y = bottom + H + 0.08;
  const lamp = part(CreateBox("tankLamp", { width: W * 0.8, height: 0.03, depth: 0.12 }, scene), "#E8FBFF", { emissive: 1 });
  lamp.position.y = bottom + H + 0.02;

  // Sand, pebbles, seaweed and a rock inside.
  const sand = part(CreateBox("tankSand", { width: W - 0.04, height: 0.12, depth: D - 0.04 }, scene), "#E6CE96");
  sand.position.y = bottom + 0.06;
  for (let i = 0; i < 14; i++) {
    const pebble = flat(CreateIcoSphere("pebble", { radius: 0.04 + hash01(i) * 0.05, subdivisions: 1 }, scene));
    part(pebble, ["#8C8F91", "#B0A48A", "#6F7A80", "#C9B48C"][i % 4]!);
    pebble.position = new Vector3((hash01(i + 3) - 0.5) * (W - 0.2), bottom + 0.12, (hash01(i + 7) - 0.5) * (D - 0.2));
  }
  const rock = flat(CreateIcoSphere("tankRock", { radius: 0.22, subdivisions: 1 }, scene));
  part(rock, "#7C8186");
  rock.position = new Vector3(W * 0.28, bottom + 0.2, -D * 0.25);
  rock.scaling = new Vector3(1.4, 0.9, 1);
  const weeds: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const weed = part(CreateBox("seaweed", { width: 0.05, height: 0.4 + hash01(i + 20) * 0.6, depth: 0.02 }, scene), i % 2 ? "#3E9A48" : "#2F7E3C");
    weed.setPivotPoint(new Vector3(0, -weed.getBoundingInfo().boundingBox.extendSize.y, 0));
    weed.position = new Vector3((hash01(i + 30) - 0.5) * (W - 0.3), bottom + 0.12 + weed.getBoundingInfo().boundingBox.extendSize.y, -D / 2 + 0.15 + hash01(i + 40) * 0.35);
    weeds.push(weed);
  }

  root.setEnabled(false);

  let swimmers: Swimmer[] = [];
  let owner: FisherSprite | null = null;

  const clear = (): void => {
    for (const s of swimmers) s.model.dispose();
    swimmers = [];
    owner?.dispose();
    owner = null;
  };

  return {
    show(next) {
      clear();
      if (!next) {
        root.setEnabled(false);
        return;
      }
      root.setEnabled(true);
      root.computeWorldMatrix(true);

      // The owner stands to the right of the tank, facing the camera.
      owner = createFisherSprite(scene, avatarFor(next.userId), "stand", root.position.add(new Vector3(W / 2 + 0.55, 0, 0.55)), 0);

      const fish = next.fish.slice(0, MAX_FISH);
      const sized = fish.filter((f) => !isDense(f.mutations));
      const heaviest = sized.length ? Math.max(...sized.map((f) => f.weightLog10)) : 0;
      swimmers = fish.map((f, i) => {
        // Length follows the cube root of weight, relative to the heaviest fish here.
        const length = isDense(f.mutations) ? DENSE_SIZE : Math.max(SMALLEST, BIGGEST * 10 ** ((f.weightLog10 - heaviest) / 3));
        const model = createFishModel(scene, f.speciesId, f.mutations);
        model.root.parent = root;
        model.root.scaling.setAll(length);
        const rows = Math.min(fish.length, 5);
        return {
          model,
          length,
          center: new Vector3((hash01(i * 3) - 0.5) * 0.3, bottom + 0.45 + ((i % rows) / Math.max(1, rows - 1)) * (H - 0.9), 0),
          rx: Math.max(0.15, W / 2 - length / 2 - 0.08),
          rz: Math.max(0.08, D / 2 - length / 2 - 0.06),
          speed: 0.25 + hash01(i * 5 + 1) * 0.2,
          phase: hash01(i * 7 + 2) * Math.PI * 2,
          dir: i % 2 ? 1 : -1,
        };
      });
    },

    update(camera, t) {
      if (!root.isEnabled()) return;
      owner?.update(camera, t);
      weeds.forEach((w, i) => (w.rotation.z = Math.sin(t * 1.2 + i) * 0.18));
      for (const s of swimmers) {
        const theta = s.phase + (s.dir * t * s.speed) / ((s.rx + s.rz) / 2);
        const px = s.center.x + s.rx * Math.cos(theta);
        const pz = s.center.z + s.rz * Math.sin(theta);
        s.model.root.position.set(px, s.center.y + Math.sin(t * 0.9 + s.phase) * 0.06, pz);
        // Face along the path (models face +x; Babylon's yaw turns +x towards -z).
        const dx = -s.rx * Math.sin(theta) * s.dir;
        const dz = s.rz * Math.cos(theta) * s.dir;
        s.model.root.rotation.y = Math.atan2(-dz, dx);
        s.model.update(t, t * 4 * (1 + s.speed) + s.phase);
      }
    },

    cameraPose() {
      // Straight on from the sea side, framing the tank and its owner.
      return {
        target: root.position.add(new Vector3(0.6, bottom + H / 2 - 0.05, 0)),
        alpha: Math.PI / 2,
        beta: 1.42,
        radius: 12,
      };
    },
  };
}
