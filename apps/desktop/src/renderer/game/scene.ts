// Deep imports keep the bundle tree-shaken; the "@babylonjs/core" barrel pulls in everything.
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { createBoat } from "./boat";
import { createCrew, type Crew, type CrewMember } from "./crew";
import { createBeach, createDock, createSea, createSky, DOCK_END, DOCK_TOP, HORIZON } from "./seaside";

export interface PondScene {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  crew: Crew;
  /** Fly the camera to the next (+1) or previous (-1) fisher; past either end returns to the overview. */
  focusStep(step: 1 | -1): void;
  focusOverview(): void;
  /** Who the camera is following, or null for the overview. */
  focusedId(): string | null;
}

interface CameraPose {
  target: Vector3;
  alpha: number;
  beta: number;
  radius: number;
}

/** Wide shot over the dock, the boat and the beach. */
const OVERVIEW: CameraPose = { target: new Vector3(5.5, 1, DOCK_END + 1.5), alpha: 1.2, beta: 1.2, radius: 25 };
/** Close-up framing: three-quarter front view at chest height. */
const CLOSE_RADIUS = 5.5;
const CLOSE_BETA = 1.28;
const CLOSE_SIDE = 0.6;
const FLY_SEC = 0.9;

/**
 * HD-2D seaside: low-poly 3D world with pixel textures, pixel-art fishers (one per active viewer,
 * each baked from 16 directions) on the dock, the beach and the podium boat, and a
 * tilt-shift/bloom post stack. Drag to orbit 360°, wheel to zoom, ←/→ to visit each fisher.
 */
export function createPondScene(canvas: HTMLCanvasElement, host: CrewMember): PondScene {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  const horizon = Color3.FromHexString(HORIZON);
  scene.clearColor = Color4.FromColor3(horizon);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 45;
  scene.fogEnd = 170;
  scene.fogColor = horizon;
  scene.ambientColor = new Color3(0.25, 0.25, 0.3);

  // Orbit camera: full 360° turn, pitch clamped to stay above the water.
  const camera = new ArcRotateCamera("camera", OVERVIEW.alpha, OVERVIEW.beta, OVERVIEW.radius, OVERVIEW.target.clone(), scene);
  camera.fov = 0.55;
  camera.lowerBetaLimit = 0.45;
  camera.upperBetaLimit = 1.45;
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 30;
  camera.panningSensibility = 0;
  camera.wheelDeltaPercentage = 0.01;
  camera.angularSensibilityX = 1400;
  camera.angularSensibilityY = 1800;
  camera.minZ = 0.3;
  camera.maxZ = 1000;
  camera.attachControl(true);
  // Arrow keys switch between fishers instead of nudging the orbit.
  camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

  const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  sky.intensity = 0.55;
  sky.diffuse = new Color3(0.85, 0.9, 1);
  sky.groundColor = new Color3(0.35, 0.4, 0.45);

  // Late-afternoon sun from over the sea, matching the light baked into the sprite.
  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.55), scene);
  sun.position = new Vector3(18, 30, 25);
  sun.intensity = 1.05;
  sun.diffuse = new Color3(1, 0.9, 0.74);
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 80;

  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.002;
  shadows.darkness = 0.35;

  createSky(scene);
  const sea = createSea(scene);
  createBeach(scene, shadows);
  createDock(scene, shadows);

  // Long-tail boat off the dock's right side: the podium for ranks 1–3.
  const boat = createBoat(scene, shadows, new Vector3(7.5, 0, DOCK_END + 4), 0);
  const crew = createCrew(scene, engine, shadows, boat, host);

  // HD-2D post stack: tilt-shift DOF, bloom, vignette, grain.
  const pipeline = new DefaultRenderingPipeline("hd2d", true, scene, [camera]);
  pipeline.samples = 4;
  pipeline.depthOfFieldEnabled = true;
  pipeline.depthOfField.fStop = 2.2;
  pipeline.depthOfField.focalLength = 90;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomWeight = 0.4;
  pipeline.bloomKernel = 48;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.contrast = 1.12;
  pipeline.imageProcessing.exposure = 1.05;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 2;
  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 5;

  // Camera director: glide between the overview and close-ups of individual fishers.
  let focused: string | null = null;
  let fly = 1;
  let flyFrom: CameraPose = OVERVIEW;
  const startFly = (): void => {
    flyFrom = { target: camera.target.clone(), alpha: camera.alpha, beta: camera.beta, radius: camera.radius };
    fly = 0;
  };
  const desiredPose = (): CameraPose | null => {
    if (focused === null) return OVERVIEW;
    const who = crew.tour().find((t) => t.userId === focused);
    if (!who) return null;
    // ArcRotate puts the camera at (cos α, sin α) around the target; face the fisher from the front, a bit to the side.
    const front = Math.atan2(Math.cos(who.yaw), Math.sin(who.yaw));
    return { target: who.point, alpha: front + CLOSE_SIDE, beta: CLOSE_BETA, radius: CLOSE_RADIUS };
  };
  const focusStep = (step: 1 | -1): void => {
    const ids = crew.tour().map((t) => t.userId);
    if (ids.length === 0) return;
    const i = focused === null ? (step === 1 ? -1 : ids.length) : ids.indexOf(focused);
    const next = i + step;
    focused = next < 0 || next >= ids.length ? null : ids[next]!;
    startFly();
  };
  const focusOverview = (): void => {
    if (focused === null) return;
    focused = null;
    startFly();
  };

  let time = 0;
  let frame = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    time += dt;
    // Waves at half rate: the CPU-side facet update is the scene's biggest per-frame cost.
    if (frame++ % 2 === 0) sea.update(time);
    crew.update(camera, time, dt);

    let want = desiredPose();
    if (!want) {
      // The fisher we were following left: back to the overview.
      focused = null;
      startFly();
      want = OVERVIEW;
    }
    if (fly < 1) {
      fly = Math.min(1, fly + dt / FLY_SEC);
      const t = fly * fly * (3 - 2 * fly);
      Vector3.LerpToRef(flyFrom.target, want.target, t, camera.target);
      camera.alpha = flyFrom.alpha + shortestAngle(flyFrom.alpha, want.alpha) * t;
      camera.beta = flyFrom.beta + (want.beta - flyFrom.beta) * t;
      camera.radius = flyFrom.radius + (want.radius - flyFrom.radius) * t;
    } else if (focused !== null) {
      // Keep following (boats rock) but leave the orbit to the mouse.
      camera.target.copyFrom(want.target);
    }
    // Keep the tilt-shift focus on the dock as the camera zooms.
    pipeline.depthOfField.focusDistance = camera.radius * 1000;
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  return { engine, scene, camera, crew, focusStep, focusOverview, focusedId: () => focused };
}

function shortestAngle(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}
