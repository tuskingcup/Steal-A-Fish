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
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { avatarFor, hashString, type Avatar } from "@saf/core";
import { createFisherSprite, rotateY, STANCES, type FisherSprite, type Stance } from "./fisherSprite";
import { flat, hash01, lowPolyMat } from "./materials";
import type { Boat } from "./boat";
import { beachHeight, DOCK_END, DOCK_TOP, PALMS, ROCKS, shorelineZ, waveHeight } from "./seaside";

// ---------- Fishing spots ----------

type SpotKind = "boat" | "dock" | "beach";

interface SpotRef {
  kind: SpotKind;
  index: number;
}

interface Pose {
  pos: Vector3;
  yaw: number;
  stance: Stance;
  /** How far out the bobber lands. */
  reach: number;
}

/** Dock seats: two at the end facing the open sea, three down each side. Seat 0 is the host's. */
const DOCK: Pose[] = [
  { pos: new Vector3(-0.55, DOCK_TOP, DOCK_END - 0.2), yaw: 0, stance: "sit", reach: 4.6 },
  { pos: new Vector3(0.55, DOCK_TOP, DOCK_END - 0.2), yaw: 0, stance: "sit", reach: 4.6 },
  ...[2.55, -0.4, -4].flatMap((z) => [
    { pos: new Vector3(1.0, DOCK_TOP, z), yaw: Math.PI / 2, stance: "sit" as const, reach: 4.4 },
    { pos: new Vector3(-1.0, DOCK_TOP, z), yaw: -Math.PI / 2, stance: "sit" as const, reach: 4.4 },
  ]),
];

/** Standing spots along the waterline, nearest the dock first, clear of rocks and palms. */
const BEACH: Pose[] = (() => {
  const spots: Pose[] = [];
  for (let k = 0; k < 14; k++) {
    for (const side of [1, -1]) {
      const x = side * (3.4 + k * 2.1);
      const z = shorelineZ(x, 0.3);
      const clear =
        ROCKS.every(([rx, rz, s]) => Math.hypot(rx - x, rz - z) > s + 1) && PALMS.every(([px, pz]) => Math.hypot(px - x, pz - z) > 1.2);
      if (!clear) continue;
      // Face straight out to sea, perpendicular to the curve of the shore.
      const slope = shorelineZ(x + 0.5, 0.3) - shorelineZ(x - 0.5, 0.3);
      spots.push({ pos: new Vector3(x, beachHeight(x, z), z), yaw: Math.atan2(-slope, 1), stance: "stand", reach: 5.2 });
    }
  }
  return spots.slice(0, 20);
})();

/** Where people fish when they aren't on the podium: dock first (after the host's seat), then the beach. */
const REGULAR: SpotRef[] = [
  ...DOCK.slice(1).map((_, i) => ({ kind: "dock" as const, index: i + 1 })),
  ...BEACH.map((_, i) => ({ kind: "beach" as const, index: i })),
];

const BOAT_REACH = [3.6, 3, 3];
const sameSpot = (a: SpotRef, b: SpotRef) => a.kind === b.kind && a.index === b.index;

// ---------- Crew ----------

/** A viewer who hasn't done anything for this long gets up and leaves (not the host or the podium). */
const IDLE_LEAVE_SEC = 180;
const ROD_LEN = 2.7;
/** Short butt so it stays hidden behind the sprite when seen from behind. */
const ROD_BUTT = 0.06;
const LINE_POINTS = 14;
/** Name tags further than this from the camera are hidden to keep the overview readable. */
const TAG_MAX_DIST = 30;

/** Classic look for the streamer's own fisher, who keeps the first dock seat. */
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
  isChampion: boolean;
  isFocused: boolean;
  /** CSS pixels relative to the canvas. */
  x: number;
  y: number;
  visible: boolean;
}

/** Where the camera should look to show one fisher. */
export interface FocusTarget {
  userId: string;
  /** Chest height of the fisher. */
  point: Vector3;
  /** Which way they face (to frame them from the front). */
  yaw: number;
}

interface Fisher {
  member: CrewMember;
  isHost: boolean;
  spot: SpotRef;
  sprite: FisherSprite;
  root: TransformNode;
  rodRoot: TransformNode;
  rodRest: Quaternion;
  tip: TransformNode;
  bobber: Mesh;
  /** Sideways offset of the bobber, so neighbours' lines don't overlap. */
  bobberSide: number;
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
  /** Put the viewer somewhere to fish (or refresh them). Frees the longest-idle spot if everywhere is full. */
  join(member: CrewMember): void;
  /** Play a cast/strike on the viewer's fisher. */
  cast(userId: string): void;
  /** Ranks 1–3, best first: they fish from the boat; #1 wears the crown. */
  setPodium(userIds: string[]): void;
  update(camera: Camera, timeSec: number, dt: number): void;
  /** Everyone fishing, in tour order: boat (by rank), dock, then the beach from left to right. */
  tour(): FocusTarget[];
  nameTags(camera: Camera, focusedId: string | null): NameTag[];
}

export function createCrew(scene: Scene, engine: Engine, shadows: ShadowGenerator, boat: Boat, host: CrewMember): Crew {
  const fishers = new Map<string, Fisher>();
  let podium: string[] = [];
  let now = 0;

  const blobMat = new StandardMaterial("blobMat", scene);
  blobMat.diffuseColor = Color3.Black();
  blobMat.specularColor = Color3.Black();
  blobMat.alpha = 0.32;

  const poseOf = (ref: SpotRef): Pose => {
    if (ref.kind === "boat") {
      const seat = boat.seat(ref.index);
      return { pos: seat.pos, yaw: seat.yaw, stance: "sit", reach: BOAT_REACH[ref.index]! };
    }
    return (ref.kind === "dock" ? DOCK : BEACH)[ref.index]!;
  };

  const occupied = (ref: SpotRef) => [...fishers.values()].some((f) => sameSpot(f.spot, ref));
  const freeRegular = () => REGULAR.find((ref) => !occupied(ref));

  const spawn = (member: CrewMember, spot: SpotRef, isHost: boolean, lastActive = now): Fisher => {
    const pose = poseOf(spot);
    const geo = STANCES[pose.stance];
    const avatar = isHost ? HOST_AVATAR : avatarFor(member.userId);
    const h = hashString(member.userId);
    const phase = (h % 1000) / 1000;
    const sprite = createFisherSprite(scene, avatar, pose.stance, pose.pos, pose.yaw, phase * 2);

    const root = new TransformNode(`fisher_${member.userId}`, scene);
    root.position = pose.pos.clone();
    root.rotation.y = pose.yaw;

    // Soft blob shadow under the sprite (a billboard's own shadow would swing with the camera).
    if (spot.kind !== "boat") {
      const blob = CreateDisc("fisherShadow", { radius: 0.36, tessellation: 16 }, scene);
      blob.parent = root;
      blob.rotation.x = Math.PI / 2;
      blob.position = new Vector3(0, 0.02, pose.stance === "sit" ? -0.08 : 0);
      blob.scaling.y = 0.75;
      blob.material = blobMat;
    }

    // 3D bamboo rod from the sprite's hands, so it reads correctly from every side.
    const rodRoot = new TransformNode("rodRoot", scene);
    rodRoot.parent = root;
    rodRoot.position = new Vector3(...geo.hand);
    const aim = new Vector3(0.18 + (hash01(h) - 0.5) * 0.3, pose.stance === "stand" ? 0.8 : 0.95, 1).normalize();
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

    // A bucket beside them (no room for one on the boat).
    if (spot.kind !== "boat") {
      const local = new Vector3(0.52, 0.16, -0.5);
      if (spot.kind === "beach") {
        const w = pose.pos.add(rotateY([local.x, 0, local.z], pose.yaw));
        local.y = beachHeight(w.x, w.z) - pose.pos.y + 0.14; // sit on the sloping sand
      }
      const bucket = CreateCylinder("bucket", { diameterTop: 0.34, diameterBottom: 0.26, height: 0.32, tessellation: 10 }, scene);
      bucket.parent = root;
      bucket.position = local;
      bucket.material = lowPolyMat(scene, ["#3E7CB1", "#D2453B", "#5AAE61", "#F2C94C"][h % 4]!);
      shadows.addShadowCaster(bucket);
      const water = CreateCylinder("bucketWater", { diameter: 0.3, height: 0.02, tessellation: 10 }, scene);
      water.parent = root;
      water.position = local.add(new Vector3(0, 0.14, 0));
      water.material = lowPolyMat(scene, "#2C6E8F");
    }

    const bobber = CreateSphere("bobber", { diameter: 0.2, segments: 6 }, scene);
    bobber.material = lowPolyMat(scene, "#FF4A3A", { emissive: 0.35 });
    const cap = CreateSphere("bobberCap", { diameter: 0.14, segments: 6 }, scene);
    cap.parent = bobber;
    cap.position.y = -0.06;
    cap.material = lowPolyMat(scene, "#FFFFFF");

    const linePoints = Array.from({ length: LINE_POINTS }, () => Vector3.Zero());
    const line = CreateLines("line", { points: linePoints, updatable: true }, scene);
    line.color = new Color3(0.95, 0.95, 0.9);
    line.alpha = 0.85;

    const fisher: Fisher = {
      member,
      isHost,
      spot,
      sprite,
      root,
      rodRoot,
      rodRest,
      tip,
      bobber,
      bobberSide: (hash01(h + 1) - 0.5) * 1.4,
      line,
      linePoints,
      lastActive,
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

  /** Free a regular spot by sending the longest-idle regular viewer home. */
  const evictIdlest = (): SpotRef | undefined => {
    const idlest = [...fishers.values()]
      .filter((f) => !f.isHost && f.spot.kind !== "boat")
      .sort((a, b) => a.lastActive - b.lastActive)[0];
    if (!idlest) return undefined;
    const spot = idlest.spot;
    remove(idlest);
    return spot;
  };

  const spotFor = (userId: string): SpotRef | undefined => {
    const rank = podium.indexOf(userId);
    if (rank >= 0) return { kind: "boat", index: rank };
    return freeRegular() ?? evictIdlest();
  };

  spawn(host, { kind: "dock", index: 0 }, true);

  const crown = createCrown(scene, shadows);
  let crownPop = 0;

  function updateCrown(timeSec: number, dt: number): void {
    const f = podium[0] === undefined ? undefined : fishers.get(podium[0]);
    if (!f || f.leaving || f.appear < 0.5) {
      crown.setEnabled(false);
      return;
    }
    crown.setEnabled(true);
    crownPop = Math.min(1, crownPop + dt * 1.8);
    const pose = poseOf(f.spot);
    const base = pose.pos.add(rotateY(STANCES[pose.stance].crown, pose.yaw));
    // Drops in from above with a bounce, then bobs and slowly turns.
    const drop = (1 - easeOutBack(crownPop)) * 1.2;
    crown.position.set(base.x, base.y + drop + Math.sin(timeSec * 2.2) * 0.04, base.z);
    crown.rotation.y = timeSec * 0.9;
    crown.scaling.setAll(1.25 * (0.4 + 0.6 * Math.min(1, crownPop * 1.5)));
  }

  return {
    join(member) {
      const existing = fishers.get(member.userId);
      if (existing) {
        existing.member = member; // display names change; keep the latest
        existing.lastActive = now;
        existing.leaving = false; // came back while walking off
        return;
      }
      const spot = spotFor(member.userId);
      if (spot) spawn(member, spot, false);
    },

    cast(userId) {
      const f = fishers.get(userId);
      if (!f) return;
      f.jerk = 1;
      f.pop = 1;
      f.lastActive = now;
    },

    setPodium(userIds) {
      if (userIds[0] !== podium[0]) crownPop = 0;
      podium = userIds.slice(0, 3);
      // Move anyone whose spot no longer matches their rank: onto the boat, off it, or to another seat.
      const moving: Fisher[] = [];
      for (const f of fishers.values()) {
        if (f.isHost) continue;
        const rank = podium.indexOf(f.member.userId);
        const wrong = rank >= 0 ? !sameSpot(f.spot, { kind: "boat", index: rank }) : f.spot.kind === "boat";
        if (wrong) moving.push(f);
      }
      for (const f of moving) remove(f);
      // Podium first, so their old regular spots are free for whoever drops off the boat.
      moving.sort((a, b) => Number(podium.includes(b.member.userId)) - Number(podium.includes(a.member.userId)));
      for (const f of moving) {
        const spot = spotFor(f.member.userId);
        if (spot) spawn(f.member, spot, false, f.lastActive);
      }
    },

    update(camera, timeSec, dt) {
      now = timeSec;
      boat.update(timeSec);
      for (const f of [...fishers.values()]) {
        const onPodium = podium.includes(f.member.userId);
        if (!f.isHost && !onPodium && !f.leaving && now - f.lastActive > IDLE_LEAVE_SEC) f.leaving = true;
        f.appear = f.leaving ? f.appear - dt * 3 : Math.min(1, f.appear + dt * 3);
        if (f.leaving && f.appear <= 0) {
          remove(f);
          continue;
        }
        f.jerk = Math.max(0, f.jerk - dt * 2.5);
        f.pop = Math.max(0, f.pop - dt * 3);

        // Boat seats move with the waves.
        const pose = poseOf(f.spot);
        f.root.position.copyFrom(pose.pos);
        f.root.rotation.y = pose.yaw;
        f.sprite.setBase(pose.pos);

        // Pop in/out with a little overshoot.
        const s = f.appear >= 1 ? 1 : easeOutBack(Math.max(0, f.appear));
        f.sprite.plane.scaling.setAll(s);
        f.root.scaling.setAll(Math.max(s, 0.001));
        f.bobber.setEnabled(f.appear > 0.5);
        f.line.setEnabled(f.appear > 0.5);
        f.sprite.update(camera, timeSec);

        const sway = Math.sin(timeSec * 1.3 + f.phase * 6) * 0.025 + Math.sin(f.jerk * Math.PI) * 0.35;
        f.rodRoot.rotationQuaternion = f.rodRest.multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), -sway));

        const out = pose.pos.add(rotateY([f.bobberSide, 0, pose.reach - f.jerk * 0.6], pose.yaw));
        f.bobber.position.set(out.x, waveHeight(out.x, out.z, timeSec) + 0.06 + Math.sin(f.pop * Math.PI) * 0.35, out.z);
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
      updateCrown(timeSec, dt);
    },

    tour() {
      const order = (f: Fisher) =>
        f.spot.kind === "boat" ? f.spot.index : f.spot.kind === "dock" ? 10 + f.spot.index : 100 + BEACH[f.spot.index]!.pos.x;
      return [...fishers.values()]
        .filter((f) => !f.leaving)
        .sort((a, b) => order(a) - order(b))
        .map((f) => {
          const pose = poseOf(f.spot);
          const chest = STANCES[pose.stance].hand[1] + 0.15;
          return { userId: f.member.userId, point: pose.pos.add(new Vector3(0, chest, 0)), yaw: pose.yaw };
        });
    },

    nameTags(camera, focusedId) {
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const canvas = engine.getRenderingCanvas();
      const cssScale = canvas ? canvas.clientWidth / w : 1;
      const viewport = camera.viewport.toGlobal(w, h);
      const transform = scene.getTransformMatrix();
      const camForward = camera.getDirection(new Vector3(0, 0, 1));
      return [...fishers.values()].map((f) => {
        const pose = poseOf(f.spot);
        const geo = STANCES[pose.stance];
        const isChampion = f.member.userId === podium[0];
        const top = isChampion ? geo.crown[1] + 0.3 : geo.headTop[1];
        const world = pose.pos.add(rotateY([geo.headTop[0], top, geo.headTop[2]], pose.yaw));
        const p = Vector3.Project(world, Matrix.IdentityReadOnly, transform, viewport);
        const toTag = world.subtract(camera.globalPosition);
        const isFocused = f.member.userId === focusedId;
        const near = isFocused || isChampion || toTag.length() < TAG_MAX_DIST;
        return {
          userId: f.member.userId,
          name: f.member.name,
          isHost: f.isHost,
          isChampion,
          isFocused,
          x: p.x * cssScale,
          y: p.y * cssScale,
          visible: near && Vector3.Dot(toTag, camForward) > 0 && f.appear > 0.6 && p.z > 0 && p.z < 1,
        };
      });
    },
  };
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Low-poly gold crown: band, five points with ball tips, a ruby in front. Emissive so it blooms. */
function createCrown(scene: Scene, shadows: ShadowGenerator): TransformNode {
  const crown = new TransformNode("crown", scene);
  const gold = lowPolyMat(scene, "#FFC93C", { specular: 0.9, emissive: 0.45 });
  const ruby = lowPolyMat(scene, "#E0283C", { specular: 0.9, emissive: 0.5 });
  const band = CreateCylinder("crownBand", { height: 0.1, diameterTop: 0.34, diameterBottom: 0.3, tessellation: 10 }, scene);
  band.parent = crown;
  band.material = gold;
  shadows.addShadowCaster(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = CreateCylinder(`crownSpike${i}`, { height: 0.16, diameterTop: 0, diameterBottom: 0.1, tessellation: 4 }, scene);
    spike.parent = crown;
    spike.position = new Vector3(Math.sin(a) * 0.145, 0.12, Math.cos(a) * 0.145);
    spike.rotation = new Vector3(Math.cos(a) * 0.18, 0, -Math.sin(a) * 0.18);
    spike.material = gold;
    const ball = flat(CreateIcoSphere(`crownBall${i}`, { radius: 0.028, subdivisions: 1 }, scene));
    ball.parent = crown;
    ball.position = new Vector3(Math.sin(a) * 0.16, 0.205, Math.cos(a) * 0.16);
    ball.material = gold;
  }
  const gem = flat(CreateIcoSphere("crownGem", { radius: 0.04, subdivisions: 1 }, scene));
  gem.parent = crown;
  gem.position = new Vector3(0, 0, 0.165);
  gem.material = ruby;
  crown.setEnabled(false);
  return crown;
}
