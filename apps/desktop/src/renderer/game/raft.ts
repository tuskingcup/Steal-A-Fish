import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import type { Floater } from "./boat";
import { hash01, lowPolyMat } from "./materials";
import { waveHeight } from "./seaside";

/** Half the side of the square deck. */
const HALF = 1.6;
const DECK_TOP = 0.22;
/** Seats per raft: two on each side, facing out. */
export const RAFT_SEATS = 8;

/** Seats, raft-local. A seat sits 0.2 in from the edge so the sitting sprite's legs dangle over it. */
const SEATS: { local: Vector3; yaw: number }[] = [0, Math.PI / 2, Math.PI, -Math.PI / 2].flatMap((yaw) =>
  [-0.7, 0.7].map((along) => {
    const out = HALF - 0.2;
    // Same convention as rotateY: local +z rotated by yaw.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return { local: new Vector3(along * c + out * s, DECK_TOP, -along * s + out * c), yaw };
  }),
);

/** Bamboo fishing raft (แพไม้ไผ่) floating off the beach. */
export function createRaft(scene: Scene, shadows: ShadowGenerator, base: Vector3, heading: number, seed: number): Floater {
  const root = new TransformNode(`raft${seed}`, scene);
  root.position = base.clone();
  root.rotation.y = heading;

  // Bamboo logs lashed side by side, two cross beams on top.
  const logs: Mesh[] = [];
  const LOGS = 10;
  for (let i = 0; i < LOGS; i++) {
    const log = CreateCylinder(`log${i}`, { height: HALF * 2 + 0.2 * hash01(seed * 31 + i), diameter: HALF * 2 / LOGS + 0.02, tessellation: 6 }, scene);
    log.rotation.x = Math.PI / 2;
    log.position = new Vector3(-HALF + (i + 0.5) * ((HALF * 2) / LOGS), DECK_TOP - 0.17, 0);
    log.material = lowPolyMat(scene, i % 3 === 0 ? "#B99A55" : "#CDB06A");
    logs.push(log);
  }
  for (const z of [-HALF + 0.35, HALF - 0.35]) {
    const beam = CreateBox(`beam${z}`, { width: HALF * 2 + 0.1, height: 0.08, depth: 0.14 }, scene);
    beam.position = new Vector3(0, DECK_TOP - 0.04, z);
    beam.material = lowPolyMat(scene, "#8A6A3A");
    logs.push(beam);
  }
  const deck = Mesh.MergeMeshes(logs, true, true, undefined, false, true)!;
  deck.name = `raftDeck${seed}`;
  deck.parent = root;
  deck.receiveShadows = true;
  shadows.addShadowCaster(deck);

  // A pole with a lantern in the middle, so rafts read from afar and glow in the bloom.
  const pole = CreateCylinder("raftPole", { height: 1.6, diameter: 0.07, tessellation: 5 }, scene);
  pole.parent = root;
  pole.position = new Vector3(0, DECK_TOP + 0.8, 0);
  pole.material = lowPolyMat(scene, "#6B4930");
  const lantern = CreateBox("raftLantern", { width: 0.16, height: 0.22, depth: 0.16 }, scene);
  lantern.parent = root;
  lantern.position = new Vector3(0, DECK_TOP + 1.5, 0);
  lantern.material = lowPolyMat(scene, "#FFC86B", { emissive: 1 });

  const phase = seed * 1.7;
  return {
    root,
    seat(i) {
      const s = SEATS[i]!;
      return { pos: Vector3.TransformCoordinates(s.local, root.getWorldMatrix()), yaw: heading + s.yaw };
    },
    update(t) {
      root.position.y = base.y + waveHeight(base.x, base.z, t) * 0.9 + 0.02;
      root.rotation.x = Math.sin(t * 0.9 + phase) * 0.02;
      root.rotation.z = Math.sin(t * 0.75 + phase + 1) * 0.025;
      root.computeWorldMatrix(true);
    },
  };
}
