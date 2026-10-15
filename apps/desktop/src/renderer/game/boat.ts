import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { ExtrudeShapeCustom } from "@babylonjs/core/Meshes/Builders/shapeBuilder";
import { lowPolyMat } from "./materials";
import { waveHeight } from "./seaside";

/** Thai long-tail boat (เรือหางยาว) moored off the dock: the podium for ranks 1–3. */
export interface Boat {
  root: TransformNode;
  /** Seat i in world space (rank i+1), following the boat as it rocks. */
  seat(i: number): { pos: Vector3; yaw: number };
  update(timeSec: number): void;
}

const HALF_LEN = 3;

/** Thwart seats, boat-local. #1 at the bow facing forward; #2 and #3 face out to either side. */
const SEATS: { local: Vector3; yaw: number }[] = [
  { local: new Vector3(0, 0.2, 1.75), yaw: 0 },
  { local: new Vector3(-0.2, 0.2, 0.15), yaw: Math.PI / 2 },
  { local: new Vector3(0.2, 0.2, -1.45), yaw: -Math.PI / 2 },
];

const rise = (z: number) => 0.55 * Math.max(0, (z - 1.2) / (HALF_LEN - 1.2)) ** 2 + 0.2 * Math.max(0, (-z - 1.8) / (HALF_LEN - 1.8)) ** 2;
const taper = (z: number) => 1 - 0.82 * (Math.abs(z) / HALF_LEN) ** 2.6;

export function createBoat(scene: Scene, shadows: ShadowGenerator, base: Vector3, heading: number): Boat {
  const root = new TransformNode("boat", scene);
  root.position = base.clone();
  root.rotation.y = heading;

  // Hull: an open U section swept bow-to-stern, narrowing and sweeping up at the ends.
  const shape = [
    new Vector3(-0.72, 0.36, 0),
    new Vector3(-0.64, 0.02, 0),
    new Vector3(-0.42, -0.24, 0),
    new Vector3(0, -0.3, 0),
    new Vector3(0.42, -0.24, 0),
    new Vector3(0.64, 0.02, 0),
    new Vector3(0.72, 0.36, 0),
  ];
  const STEPS = 16;
  const path: Vector3[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const z = -HALF_LEN + (i / STEPS) * HALF_LEN * 2;
    path.push(new Vector3(0, rise(z), z));
  }
  const hull = ExtrudeShapeCustom(
    "hull",
    {
      shape,
      path,
      scaleFunction: (i: number) => taper(path[i]!.z),
      rotationFunction: () => 0,
      sideOrientation: Mesh.DOUBLESIDE,
    },
    scene,
  );
  hull.convertToFlatShadedMesh();
  hull.parent = root;
  hull.material = lowPolyMat(scene, "#7A4A2C");
  hull.receiveShadows = true;
  shadows.addShadowCaster(hull);

  // Painted gunwale stripes: blue rail, red band just below.
  for (const [side, dy, color, r] of [
    [-1, 0, "#2F6DB5", 0.045],
    [1, 0, "#2F6DB5", 0.045],
    [-1, -0.09, "#D2453B", 0.03],
    [1, -0.09, "#D2453B", 0.03],
  ] as const) {
    const rail = path.map((p) => new Vector3(side * 0.72 * taper(p.z) * (dy ? 0.97 : 1), p.y + 0.36 + dy, p.z));
    const tube = CreateTube(`rail${side}${dy}`, { path: rail, radius: r, tessellation: 5 }, scene);
    tube.parent = root;
    tube.material = lowPolyMat(scene, color);
  }

  // Floorboards and thwarts.
  const plank = lowPolyMat(scene, "#9A6A42");
  const floor = CreateBox("boatFloor", { width: 0.75, height: 0.04, depth: 4.2 }, scene);
  floor.parent = root;
  floor.position = new Vector3(0, -0.24, 0);
  floor.material = plank;
  for (const z of [1.75, 0.15, -1.45]) {
    const thwart = CreateBox(`thwart${z}`, { width: 1.32 * taper(z), height: 0.06, depth: 0.28 }, scene);
    thwart.parent = root;
    thwart.position = new Vector3(0, 0.17, z);
    thwart.material = plank;
    thwart.receiveShadows = true;
  }

  // Phuang malai garland on the raised bow.
  const bowTip = new Vector3(0, rise(HALF_LEN) + 0.36, HALF_LEN - 0.05);
  const garland = CreateTorus("garland", { diameter: 0.22, thickness: 0.06, tessellation: 10 }, scene);
  garland.parent = root;
  garland.position = bowTip.add(new Vector3(0, -0.12, -0.05));
  garland.rotation.x = Math.PI / 2.4;
  garland.material = lowPolyMat(scene, "#F2C94C", { emissive: 0.15 });
  ["#E07AA8", "#5AAE61", "#D2453B", "#F4F1E8"].forEach((c, i) => {
    const ribbon = CreateBox(`ribbon${i}`, { width: 0.05, height: 0.32, depth: 0.012 }, scene);
    ribbon.parent = root;
    ribbon.position = bowTip.add(new Vector3((i - 1.5) * 0.06, -0.32, -0.03));
    ribbon.rotation.z = (i - 1.5) * 0.12;
    ribbon.material = lowPolyMat(scene, c);
  });

  // Long-tail engine on the stern: motor block plus the long shaft dipping into the water.
  const motor = CreateBox("motor", { width: 0.34, height: 0.28, depth: 0.5 }, scene);
  motor.parent = root;
  motor.position = new Vector3(0, rise(-HALF_LEN) + 0.5, -HALF_LEN + 0.05);
  motor.material = lowPolyMat(scene, "#3F6E4A");
  shadows.addShadowCaster(motor);
  const shaftFrom = motor.position.add(new Vector3(0, -0.05, -0.2));
  const shaftTo = new Vector3(0, -0.15, -HALF_LEN - 2.3);
  const shaft = CreateTube("shaft", { path: [shaftFrom, shaftTo], radius: 0.035, tessellation: 6 }, scene);
  shaft.parent = root;
  shaft.material = lowPolyMat(scene, "#8C8F91", { specular: 0.5 });
  const handle = CreateCylinder("tiller", { height: 0.9, diameter: 0.04, tessellation: 5 }, scene);
  handle.parent = root;
  handle.position = motor.position.add(new Vector3(0, 0.05, 0.55));
  handle.rotation.x = Math.PI / 2.2;
  handle.material = lowPolyMat(scene, "#8C8F91");

  return {
    root,
    seat(i) {
      const s = SEATS[i]!;
      return { pos: Vector3.TransformCoordinates(s.local, root.getWorldMatrix()), yaw: heading + s.yaw };
    },
    update(t) {
      root.position.y = base.y + waveHeight(base.x, base.z, t) * 0.8 + 0.06;
      root.rotation.x = Math.sin(t * 1.1) * 0.025;
      root.rotation.z = Math.sin(t * 0.85 + 1) * 0.035;
      root.computeWorldMatrix(true);
    },
  };
}
