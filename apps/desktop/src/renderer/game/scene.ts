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
import { createCrew, type Crew, type CrewMember } from "./crew";
import { createBeach, createDock, createSea, createSky, DOCK_END, DOCK_TOP, HORIZON } from "./seaside";

export interface PondScene {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  crew: Crew;
}

/**
 * HD-2D seaside: low-poly 3D world with pixel textures, a dock crew of pixel-art fishers
 * (one per active viewer, each baked from 16 directions), and a tilt-shift/bloom post stack.
 * Drag to orbit 360°, wheel to zoom.
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

  // Orbit camera around the end of the dock: full 360° turn, pitch clamped to stay above the water.
  const camera = new ArcRotateCamera("camera", -1.0, 1.36, 14, new Vector3(0, DOCK_TOP + 1.7, DOCK_END - 1.2), scene);
  camera.fov = 0.55;
  camera.lowerBetaLimit = 0.45;
  camera.upperBetaLimit = 1.45;
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 26;
  camera.panningSensibility = 0;
  camera.wheelDeltaPercentage = 0.01;
  camera.angularSensibilityX = 1400;
  camera.angularSensibilityY = 1800;
  camera.minZ = 0.3;
  camera.maxZ = 1000;
  camera.attachControl(true);

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

  const crew = createCrew(scene, engine, shadows, host);

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

  let time = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    time += dt;
    sea.update(time);
    crew.update(camera, time, dt);
    // Keep the tilt-shift focus on the dock as the camera zooms.
    pipeline.depthOfField.focusDistance = camera.radius * 1000;
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  return { engine, scene, camera, crew };
}
