// Deep imports keep the bundle tree-shaken; the "@babylonjs/core" barrel pulls in everything.
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { createFisherSprite, HAND_LOCAL } from "./fisherSprite";
import { lowPolyMat } from "./materials";
import { createBeach, createDock, createSea, createSky, DOCK_END, DOCK_TOP, HORIZON, waveHeight } from "./seaside";

/**
 * HD-2D seaside: low-poly 3D world with pixel textures, a pixel-art fisher billboard baked
 * from 16 directions, and a tilt-shift/bloom post stack. Drag to orbit 360°, wheel to zoom.
 */
export function createPondScene(canvas: HTMLCanvasElement): { engine: Engine; scene: Scene; splash: () => void } {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  const horizon = Color3.FromHexString(HORIZON);
  scene.clearColor = Color4.FromColor3(horizon);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 45;
  scene.fogEnd = 170;
  scene.fogColor = horizon;
  scene.ambientColor = new Color3(0.25, 0.25, 0.3);

  // The fisher sits on the end of the dock, facing the open sea (+z).
  const seat = new Vector3(0, DOCK_TOP, DOCK_END - 0.2);

  // Orbit camera around the fisher: full 360° turn, pitch clamped to stay above the water.
  const camera = new ArcRotateCamera("camera", -1.0, 1.36, 13, seat.add(new Vector3(0, 1.7, 0.4)), scene);
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

  const fisher = createFisherSprite(scene, seat);

  // Soft blob shadow under the sprite (a billboard's own shadow would swing with the camera).
  const blob = CreateDisc("fisherShadow", { radius: 0.36, tessellation: 16 }, scene);
  blob.rotation.x = Math.PI / 2;
  blob.position = seat.add(new Vector3(0, 0.006, -0.08));
  blob.scaling.y = 0.75;
  const blobMat = new StandardMaterial("blobMat", scene);
  blobMat.diffuseColor = Color3.Black();
  blobMat.specularColor = Color3.Black();
  blobMat.alpha = 0.32;
  blob.material = blobMat;

  // 3D bamboo rod from the sprite's hands, so it reads correctly from every side.
  const rodRoot = new TransformNode("rodRoot", scene);
  rodRoot.position = seat.add(new Vector3(...HAND_LOCAL));
  const rodRest = Quaternion.FromUnitVectorsToRef(Vector3.Up(), new Vector3(0.18, 0.95, 1).normalize(), new Quaternion());
  rodRoot.rotationQuaternion = rodRest.clone();
  const ROD_LEN = 2.7;
  const BUTT = 0.06; // short butt so it stays hidden behind the sprite when seen from behind
  const rod = CreateCylinder("rod", { height: ROD_LEN, diameterTop: 0.022, diameterBottom: 0.05, tessellation: 6 }, scene);
  rod.parent = rodRoot;
  rod.position.y = ROD_LEN / 2 - BUTT;
  rod.material = lowPolyMat(scene, "#D8B866");
  const grip = CreateCylinder("rodGrip", { height: 0.26, diameter: 0.065, tessellation: 6 }, scene);
  grip.parent = rodRoot;
  grip.position.y = 0.08;
  grip.material = lowPolyMat(scene, "#5A3B24");
  for (let i = 1; i <= 4; i++) {
    const node = CreateCylinder(`rodNode${i}`, { height: 0.035, diameter: 0.06 - i * 0.007, tessellation: 6 }, scene);
    node.parent = rodRoot;
    node.position.y = (ROD_LEN - BUTT) * (i / 5);
    node.material = lowPolyMat(scene, "#A88A44");
  }
  shadows.addShadowCaster(rod);
  const tip = new TransformNode("rodTip", scene);
  tip.parent = rodRoot;
  tip.position.y = ROD_LEN - BUTT;

  // Bobber out in the sea.
  const bobberBase = new Vector3(0.9, 0, DOCK_END + 4.6);
  const bobber = CreateSphere("bobber", { diameter: 0.2, segments: 6 }, scene);
  bobber.material = lowPolyMat(scene, "#FF4A3A", { emissive: 0.35 });
  const bobberCap = CreateSphere("bobberCap", { diameter: 0.14, segments: 6 }, scene);
  bobberCap.parent = bobber;
  bobberCap.position.y = -0.06;
  bobberCap.material = lowPolyMat(scene, "#FFFFFF");

  const LINE_POINTS = 14;
  const linePoints = Array.from({ length: LINE_POINTS }, () => Vector3.Zero());
  const line = CreateLines("line", { points: linePoints, updatable: true }, scene);
  line.color = new Color3(0.95, 0.95, 0.9);
  line.alpha = 0.85;

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
  let jerk = 0;
  let pop = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    time += dt;
    jerk = Math.max(0, jerk - dt * 2.5);
    pop = Math.max(0, pop - dt * 3);

    sea.update(time);
    fisher.update(camera, time);

    // Rod: gentle sway, plus a strike when something happens.
    const sway = Math.sin(time * 1.3) * 0.025 + Math.sin(jerk * Math.PI) * 0.35;
    rodRoot.rotationQuaternion = rodRest.multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), -sway));

    const bx = bobberBase.x;
    const bz = bobberBase.z - jerk * 0.6;
    bobber.position.set(bx, waveHeight(bx, bz, time) + 0.06 + Math.sin(pop * Math.PI) * 0.35, bz);
    bobber.scaling.setAll(1 + Math.sin(pop * Math.PI) * 0.6);

    // Fishing line with a little sag.
    rodRoot.computeWorldMatrix(true);
    const from = tip.computeWorldMatrix(true).getTranslation();
    const to = bobber.position;
    for (let i = 0; i < LINE_POINTS; i++) {
      const s = i / (LINE_POINTS - 1);
      Vector3.LerpToRef(from, to, s, linePoints[i]!);
      linePoints[i]!.y -= Math.sin(s * Math.PI) * (0.45 - jerk * 0.35);
    }
    CreateLines("line", { points: linePoints, instance: line });

    // Keep the tilt-shift focus on the fisher as the camera zooms.
    pipeline.depthOfField.focusDistance = camera.radius * 1000;
  });

  const splash = (): void => {
    jerk = 1;
    pop = 1;
  };

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  return { engine, scene, splash };
}
