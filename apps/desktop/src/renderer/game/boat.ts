import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { ExtrudeShapeCustom } from "@babylonjs/core/Meshes/Builders/shapeBuilder";
import { lowPolyMat } from "./materials";
import { waveHeight } from "./seaside";

/** Something afloat with seats that move as it rocks: the podium yacht, the rafts. */
export interface Floater {
  root: TransformNode;
  /** Seat i in world space, following the hull as it rocks. */
  seat(i: number): { pos: Vector3; yaw: number };
  update(timeSec: number): void;
}

/** White motor yacht anchored off the dock: the podium for ranks 1–3 (seat i = rank i+1). */
export type Boat = Floater;

const HALF_LEN = 4.5;
const HALF_BEAM = 1.3;
const DECK = 0.9;

/** Half-width of the deck at z: pointed bow, square-ish stern. */
const beam = (z: number) => HALF_BEAM * (z > 0 ? 1 - 0.92 * (z / HALF_LEN) ** 2.2 : 1 - 0.12 * (-z / HALF_LEN) ** 2);
/** The deck sheers up a little towards the bow. */
const sheer = (z: number) => 0.25 * Math.max(0, z / HALF_LEN) ** 2;

/**
 * Seats, yacht-local, each 0.2 in from the edge so the sitting sprite's legs dangle over it.
 * #1 on the bow facing forward; #2 and #3 on the aft deck facing out to either side.
 */
const SEATS: { local: Vector3; yaw: number }[] = [
  { local: new Vector3(0, DECK + sheer(3.6), 3.6), yaw: 0 },
  { local: new Vector3(beam(-3.2) - 0.2, DECK, -3.2), yaw: Math.PI / 2 },
  { local: new Vector3(-(beam(-3.2) - 0.2), DECK, -3.2), yaw: -Math.PI / 2 },
];

export function createBoat(scene: Scene, shadows: ShadowGenerator, base: Vector3, heading: number): Boat {
  const root = new TransformNode("yacht", scene);
  root.position = base.clone();
  root.rotation.y = heading;
  const part = <T extends Mesh>(mesh: T, color: string, opts?: { specular?: number; emissive?: number }): T => {
    mesh.parent = root;
    mesh.material = lowPolyMat(scene, color, opts);
    return mesh;
  };

  // Hull: a deep V section swept stern-to-bow, pointed at the bow, glossy white.
  const shape = [
    new Vector3(-1, 1, 0),
    new Vector3(-0.97, 0.45, 0),
    new Vector3(-0.68, -0.15, 0),
    new Vector3(0, -0.45, 0),
    new Vector3(0.68, -0.15, 0),
    new Vector3(0.97, 0.45, 0),
    new Vector3(1, 1, 0),
  ].map((p) => new Vector3(p.x * HALF_BEAM, p.y * DECK, 0));
  const STEPS = 20;
  const path: Vector3[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const z = -HALF_LEN + (i / STEPS) * HALF_LEN * 2;
    path.push(new Vector3(0, sheer(z), z));
  }
  const hull = ExtrudeShapeCustom(
    "yachtHull",
    {
      shape,
      path,
      scaleFunction: (i: number) => Math.max(0.04, beam(path[i]!.z) / HALF_BEAM),
      rotationFunction: () => 0,
      sideOrientation: Mesh.DOUBLESIDE,
      cap: Mesh.CAP_START,
    },
    scene,
  );
  hull.convertToFlatShadedMesh();
  part(hull, "#F4F6F8", { specular: 0.6 });
  hull.receiveShadows = true;
  shadows.addShadowCaster(hull);

  // Teak deck: a ribbon between the port and starboard deck edges.
  const edge = (side: number, lift = 0) => path.map((p) => new Vector3(side * beam(p.z), DECK + p.y + lift, p.z));
  const deck = CreateRibbon("yachtDeck", { pathArray: [edge(-1, 0.005), edge(1, 0.005)], sideOrientation: Mesh.DOUBLESIDE }, scene);
  part(deck, "#B5814F");
  deck.receiveShadows = true;

  // Navy stripe along the hull and a gold rub rail at the deck edge.
  for (const side of [-1, 1]) {
    const stripe = path.map((p) => new Vector3(side * beam(p.z) * 0.985, DECK * 0.62 + p.y, p.z));
    part(CreateTube(`yachtStripe${side}`, { path: stripe, radius: 0.07, tessellation: 4 }, scene), "#1E3F7A");
    part(CreateTube(`yachtRail${side}`, { path: edge(side, 0.02), radius: 0.035, tessellation: 5 }, scene), "#E8B73C", { specular: 0.9, emissive: 0.25 });
  }

  // Cabin with a band of tinted windows, a hard top on posts, and a radar arch.
  const cabin = part(CreateBox("yachtCabin", { width: 1.9, height: 0.85, depth: 3.4 }, scene), "#FBFBFC", { specular: 0.5 });
  cabin.position = new Vector3(0, DECK + 0.43, -0.6);
  shadows.addShadowCaster(cabin);
  const glass = part(CreateBox("yachtGlass", { width: 1.93, height: 0.3, depth: 3.43 }, scene), "#1C3346", { specular: 1, emissive: 0.12 });
  glass.position = new Vector3(0, DECK + 0.6, -0.6);
  const windshield = part(CreateBox("yachtWindshield", { width: 1.8, height: 0.06, depth: 0.75 }, scene), "#1C3346", { specular: 1, emissive: 0.12 });
  windshield.position = new Vector3(0, DECK + 0.72, 1.35);
  windshield.rotation.x = -0.55;
  const roof = part(CreateBox("yachtHardTop", { width: 2.1, height: 0.08, depth: 3.2 }, scene), "#FBFBFC", { specular: 0.5 });
  roof.position = new Vector3(0, DECK + 1.55, -0.9);
  shadows.addShadowCaster(roof);
  for (const [x, z] of [[-0.95, -2.35], [0.95, -2.35], [-0.95, 0.55], [0.95, 0.55]] as const) {
    const post = part(CreateCylinder("yachtPost", { height: 0.7, diameter: 0.06, tessellation: 5 }, scene), "#D9DDE2", { specular: 0.7 });
    post.position = new Vector3(x, DECK + 1.18, z);
  }
  const arch = part(CreateBox("yachtArch", { width: 1.5, height: 0.5, depth: 0.12 }, scene), "#FBFBFC");
  arch.position = new Vector3(0, DECK + 1.84, -1.6);
  const radar = part(CreateCylinder("yachtRadar", { height: 0.08, diameter: 0.5, tessellation: 10 }, scene), "#D9DDE2");
  radar.position = new Vector3(0, DECK + 2.13, -1.6);

  // Swim platform at the stern, a flag on a staff.
  const platform = part(CreateBox("yachtPlatform", { width: HALF_BEAM * 1.7, height: 0.08, depth: 0.55 }, scene), "#B5814F");
  platform.position = new Vector3(0, 0.25, -HALF_LEN - 0.25);
  const staff = part(CreateCylinder("yachtStaff", { height: 1.1, diameter: 0.04, tessellation: 5 }, scene), "#D9DDE2");
  staff.position = new Vector3(0, DECK + 0.55, -HALF_LEN + 0.15);
  const flag = part(CreateBox("yachtFlag", { width: 0.02, height: 0.3, depth: 0.45 }, scene), "#E8B73C", { emissive: 0.2 });
  flag.position = new Vector3(0, DECK + 0.95, -HALF_LEN - 0.08);

  return {
    root,
    seat(i) {
      const s = SEATS[i]!;
      return { pos: Vector3.TransformCoordinates(s.local, root.getWorldMatrix()), yaw: heading + s.yaw };
    },
    update(t) {
      // A big hull: rises with the swell but barely rolls.
      root.position.y = base.y + waveHeight(base.x, base.z, t) * 0.5 + 0.05;
      root.rotation.x = Math.sin(t * 0.8) * 0.012;
      root.rotation.z = Math.sin(t * 0.65 + 1) * 0.018;
      root.computeWorldMatrix(true);
    },
  };
}
