import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { avatarFor, hashString, type Avatar } from "@saf/core";
import { createFisherSprite, HAND_LOCAL, HEAD_TOP_LOCAL, rotateY, type FisherSprite } from "./fisherSprite";
import { hash01, lowPolyMat } from "./materials";
import { DOCK_END, DOCK_TOP, waveHeight } from "./seaside";

/** Seats on the dock edges: two at the end facing the open sea, three down each side. */
const SEATS: { pos: Vector3; yaw: number }[] = [
  { pos: new Vector3(-0.55, DOCK_TOP, DOCK_END - 0.2), yaw: 0 },
  { pos: new Vector3(0.55, DOCK_TOP, DOCK_END - 0.2), yaw: 0 },
  ...[2.55, -0.4, -4].flatMap((z) => [
    { pos: new Vector3(1.0, DOCK_TOP, z), yaw: Math.PI / 2 },
    { pos: new Vector3(-1.0, DOCK_TOP, z), yaw: -Math.PI / 2 },
  ]),
];

/** A viewer who hasn't done anything for this long gets up and leaves. */
const IDLE_LEAVE_SEC = 180;
const ROD_LEN = 2.7;
/** Short butt so it stays hidden behind the sprite when seen from behind. */
const ROD_BUTT = 0.06;
const LINE_POINTS = 14;

/** Classic look for the streamer's own fisher, who keeps the first seat. */
export const HOST_AVATAR: Avatar = {
  skin: "#F2C194",
  hairColor: "#2A1E18",
  hairStyle: "short",
  hat: "ngob",
  hatColor: "#D2453B",
  eyes: "dot",
  faceExtra: "none",
  top: "tee",
  topColor: "#EDE6D3",
  topAccent: "#3E7CB1",
  neck: "phaKhaoMa",
  neckColor: "#D2453B",
  bottom: "fishermanPants",
  bottomColor: "#34488A",
  shoes: "sandals",
  shoeColor: "#6B4226",
};

export interface CrewMember {
  userId: string;
  name: string;
}

export interface NameTag {
  userId: string;
  name: string;
  isHost: boolean;
  /** CSS pixels relative to the canvas. */
  x: number;
  y: number;
  visible: boolean;
}

interface Fisher {
  member: CrewMember;
  isHost: boolean;
  seat: number;
  sprite: FisherSprite;
  root: TransformNode;
  rodRoot: TransformNode;
  rodRest: Quaternion;
  tip: TransformNode;
  bobber: Mesh;
  bobberBase: Vector3;
  line: LinesMesh;
  linePoints: Vector3[];
  lastActive: number;
  appear: number;
  jerk: number;
  pop: number;
  phase: number;
  leaving: boolean;
}

export interface Crew {
  /** Seat the viewer (or refresh their seat). Frees the longest-idle seat if the dock is full. */
  join(member: CrewMember): void;
  /** Play a cast/strike on the viewer's fisher. */
  cast(userId: string): void;
  update(camera: Camera, timeSec: number, dt: number): void;
  nameTags(camera: Camera): NameTag[];
}

export function createCrew(scene: Scene, engine: Engine, shadows: ShadowGenerator, host: CrewMember): Crew {
  const fishers = new Map<string, Fisher>();
  let now = 0;

  const blobMat = new StandardMaterial("blobMat", scene);
  blobMat.diffuseColor = Color3.Black();
  blobMat.specularColor = Color3.Black();
  blobMat.alpha = 0.32;

  const seatTaken = (i: number) => [...fishers.values()].some((f) => f.seat === i && !f.leaving);

  const spawn = (member: CrewMember, seatIndex: number, isHost: boolean): Fisher => {
    const seat = SEATS[seatIndex]!;
    const avatar = isHost ? HOST_AVATAR : avatarFor(member.userId);
    const h = hashString(member.userId);
    const phase = (h % 1000) / 1000;
    const sprite = createFisherSprite(scene, avatar, seat.pos, seat.yaw, phase * 2);

    const root = new TransformNode(`fisher_${member.userId}`, scene);
    root.position = seat.pos.clone();
    root.rotation.y = seat.yaw;

    // Soft blob shadow under the sprite (a billboard's own shadow would swing with the camera).
    const blob = CreateDisc("fisherShadow", { radius: 0.36, tessellation: 16 }, scene);
    blob.parent = root;
    blob.rotation.x = Math.PI / 2;
    blob.position = new Vector3(0, 0.006, -0.08);
    blob.scaling.y = 0.75;
    blob.material = blobMat;

    // 3D bamboo rod from the sprite's hands, so it reads correctly from every side.
    const rodRoot = new TransformNode("rodRoot", scene);
    rodRoot.parent = root;
    rodRoot.position = new Vector3(...HAND_LOCAL);
    const aim = new Vector3(0.18 + (hash01(h) - 0.5) * 0.3, 0.95, 1).normalize();
    const rodRest = Quaternion.FromUnitVectorsToRef(Vector3.Up(), aim, new Quaternion());
    rodRoot.rotationQuaternion = rodRest.clone();
    const rod = CreateCylinder("rod", { height: ROD_LEN, diameterTop: 0.022, diameterBottom: 0.05, tessellation: 6 }, scene);
    rod.parent = rodRoot;
    rod.position.y = ROD_LEN / 2 - ROD_BUTT;
    rod.material = lowPolyMat(scene, "#D8B866");
    shadows.addShadowCaster(rod);
    const grip = CreateCylinder("rodGrip", { height: 0.26, diameter: 0.065, tessellation: 6 }, scene);
    grip.parent = rodRoot;
    grip.position.y = 0.08;
    grip.material = lowPolyMat(scene, "#5A3B24");
    for (let i = 1; i <= 4; i++) {
      const knot = CreateCylinder(`rodNode${i}`, { height: 0.035, diameter: 0.06 - i * 0.007, tessellation: 6 }, scene);
      knot.parent = rodRoot;
      knot.position.y = (ROD_LEN - ROD_BUTT) * (i / 5);
      knot.material = lowPolyMat(scene, "#A88A44");
    }
    const tip = new TransformNode("rodTip", scene);
    tip.parent = rodRoot;
    tip.position.y = ROD_LEN - ROD_BUTT;

    // Each fisher keeps a bucket beside them.
    const bucket = CreateCylinder("bucket", { diameterTop: 0.34, diameterBottom: 0.26, height: 0.32, tessellation: 10 }, scene);
    bucket.parent = root;
    bucket.position = new Vector3(0.52, 0.16, -0.5);
    bucket.material = lowPolyMat(scene, ["#3E7CB1", "#D2453B", "#5AAE61", "#F2C94C"][h % 4]!);
    shadows.addShadowCaster(bucket);
    const water = CreateCylinder("bucketWater", { diameter: 0.3, height: 0.02, tessellation: 10 }, scene);
    water.parent = root;
    water.position = new Vector3(0.52, 0.3, -0.5);
    water.material = lowPolyMat(scene, "#2C6E8F");

    const bobber = CreateSphere("bobber", { diameter: 0.2, segments: 6 }, scene);
    bobber.material = lowPolyMat(scene, "#FF4A3A", { emissive: 0.35 });
    const cap = CreateSphere("bobberCap", { diameter: 0.14, segments: 6 }, scene);
    cap.parent = bobber;
    cap.position.y = -0.06;
    cap.material = lowPolyMat(scene, "#FFFFFF");
    const bobberBase = seat.pos.add(rotateY([(hash01(h + 1) - 0.5) * 1.6, 0, 4.2 + hash01(h + 2) * 1.2], seat.yaw));

    const linePoints = Array.from({ length: LINE_POINTS }, () => Vector3.Zero());
    const line = CreateLines("line", { points: linePoints, updatable: true }, scene);
    line.color = new Color3(0.95, 0.95, 0.9);
    line.alpha = 0.85;

    const fisher: Fisher = {
      member,
      isHost,
      seat: seatIndex,
      sprite,
      root,
      rodRoot,
      rodRest,
      tip,
      bobber,
      bobberBase,
      line,
      linePoints,
      lastActive: now,
      appear: 0,
      jerk: 0,
      pop: 0,
      phase,
      leaving: false,
    };
    fishers.set(member.userId, fisher);
    return fisher;
  };

  const remove = (f: Fisher): void => {
    f.sprite.dispose();
    f.root.dispose(); // materials are shared between fishers; keep them
    f.bobber.dispose();
    f.line.dispose();
    fishers.delete(f.member.userId);
  };

  spawn(host, 0, true);

  const crew: Crew = {
    join(member) {
      const existing = fishers.get(member.userId);
      if (existing) {
        existing.member = member; // display names change; keep the latest
        existing.lastActive = now;
        existing.leaving = false; // came back while walking off
        return;
      }
      let seat = SEATS.findIndex((_, i) => !seatTaken(i));
      if (seat < 0) {
        const idlest = [...fishers.values()]
          .filter((f) => !f.isHost && !f.leaving)
          .sort((a, b) => a.lastActive - b.lastActive)[0];
        if (!idlest) return;
        seat = idlest.seat;
        remove(idlest);
      }
      spawn(member, seat, false);
    },

    cast(userId) {
      const f = fishers.get(userId);
      if (!f) return;
      f.jerk = 1;
      f.pop = 1;
      f.lastActive = now;
    },

    update(camera, timeSec, dt) {
      now = timeSec;
      for (const f of [...fishers.values()]) {
        if (!f.isHost && !f.leaving && now - f.lastActive > IDLE_LEAVE_SEC) f.leaving = true;
        f.appear = f.leaving ? f.appear - dt * 3 : Math.min(1, f.appear + dt * 3);
        if (f.leaving && f.appear <= 0) {
          remove(f);
          continue;
        }
        f.jerk = Math.max(0, f.jerk - dt * 2.5);
        f.pop = Math.max(0, f.pop - dt * 3);

        // Pop in/out with a little overshoot.
        const s = f.appear >= 1 ? 1 : easeOutBack(Math.max(0, f.appear));
        f.sprite.plane.scaling.setAll(s);
        f.root.scaling.setAll(Math.max(s, 0.001));
        f.bobber.setEnabled(f.appear > 0.5);
        f.line.setEnabled(f.appear > 0.5);
        f.sprite.update(camera, timeSec);

        const sway = Math.sin(timeSec * 1.3 + f.phase * 6) * 0.025 + Math.sin(f.jerk * Math.PI) * 0.35;
        f.rodRoot.rotationQuaternion = f.rodRest.multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), -sway));

        const b = f.bobberBase;
        const pull = rotateY([0, 0, -f.jerk * 0.6], f.root.rotation.y);
        const bx = b.x + pull.x;
        const bz = b.z + pull.z;
        f.bobber.position.set(bx, waveHeight(bx, bz, timeSec) + 0.06 + Math.sin(f.pop * Math.PI) * 0.35, bz);
        f.bobber.scaling.setAll(1 + Math.sin(f.pop * Math.PI) * 0.6);

        // Fishing line with a little sag.
        f.root.computeWorldMatrix(true);
        f.rodRoot.computeWorldMatrix(true);
        const from = f.tip.computeWorldMatrix(true).getTranslation();
        for (let i = 0; i < LINE_POINTS; i++) {
          const t = i / (LINE_POINTS - 1);
          Vector3.LerpToRef(from, f.bobber.position, t, f.linePoints[i]!);
          f.linePoints[i]!.y -= Math.sin(t * Math.PI) * (0.45 - f.jerk * 0.35);
        }
        CreateLines("line", { points: f.linePoints, instance: f.line });
      }
    },

    nameTags(camera) {
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const canvas = engine.getRenderingCanvas();
      const cssScale = canvas ? canvas.clientWidth / w : 1;
      const viewport = camera.viewport.toGlobal(w, h);
      const transform = scene.getTransformMatrix();
      const camForward = camera.getDirection(new Vector3(0, 0, 1));
      return [...fishers.values()].map((f) => {
        const seat = SEATS[f.seat]!;
        const world = seat.pos.add(rotateY(HEAD_TOP_LOCAL, seat.yaw));
        const p = Vector3.Project(world, Matrix.IdentityReadOnly, transform, viewport);
        const inFront = Vector3.Dot(world.subtract(camera.globalPosition), camForward) > 0;
        return {
          userId: f.member.userId,
          name: f.member.name,
          isHost: f.isHost,
          x: p.x * cssScale,
          y: p.y * cssScale,
          visible: inFront && f.appear > 0.6 && p.z > 0 && p.z < 1,
        };
      });
    },
  };
  return crew;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
