// Deep imports keep the bundle tree-shaken; the "@babylonjs/core" barrel pulls in everything.
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Animation } from "@babylonjs/core/Animations/animation";
import "@babylonjs/core/Animations/animatable";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";

/**
 * Placeholder HD-2D pond: low-poly 3D set, a 2D billboard fisher that casts a shadow,
 * and the tilt-shift/bloom post stack. Real art replaces these meshes later.
 */
export function createPondScene(canvas: HTMLCanvasElement): { engine: Engine; scene: Scene; splash: () => void } {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.17, 0.25, 1);

  // Narrow-FOV camera looking down ~30°, like a diorama.
  const camera = new FreeCamera("camera", new Vector3(0, 7, -13), scene);
  camera.fov = 0.55;
  camera.setTarget(new Vector3(0, 0.5, 1.5));

  const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  sky.intensity = 0.45;
  sky.groundColor = new Color3(0.1, 0.2, 0.3);

  const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.5), scene);
  sun.position = new Vector3(10, 20, -10);
  sun.intensity = 1.1;
  sun.diffuse = new Color3(1, 0.88, 0.7); // warm evening light

  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;

  // Water
  const water = CreateGround("water", { width: 40, height: 40 }, scene);
  const waterMat = new StandardMaterial("waterMat", scene);
  waterMat.diffuseColor = new Color3(0.07, 0.31, 0.42);
  waterMat.specularColor = new Color3(0.6, 0.7, 0.7);
  waterMat.specularPower = 64;
  water.material = waterMat;
  water.receiveShadows = true;

  // Dock
  const wood = new StandardMaterial("wood", scene);
  wood.diffuseColor = new Color3(0.48, 0.32, 0.2);
  const dock = CreateBox("dock", { width: 9, height: 0.4, depth: 2.4 }, scene);
  dock.position = new Vector3(0, 0.4, -3);
  dock.material = wood;
  dock.receiveShadows = true;
  shadows.addShadowCaster(dock);
  for (const x of [-4, 0, 4]) {
    const post = CreateBox(`post${x}`, { width: 0.3, height: 1.4, depth: 0.3 }, scene);
    post.position = new Vector3(x, -0.2, -1.9);
    post.material = wood;
    shadows.addShadowCaster(post);
  }

  // 2D billboard fisher (placeholder pixel art drawn at runtime)
  const fisher = CreatePlane("fisher", { width: 1, height: 2 }, scene);
  fisher.position = new Vector3(0, 1.6, -3);
  fisher.billboardMode = Mesh.BILLBOARDMODE_Y;
  fisher.material = pixelSpriteMaterial(scene);
  shadows.addShadowCaster(fisher);

  // Bobber
  const bobber = CreateSphere("bobber", { diameter: 0.25, segments: 8 }, scene);
  bobber.position = new Vector3(0.6, 0.12, 2);
  const bobberMat = new StandardMaterial("bobberMat", scene);
  bobberMat.diffuseColor = new Color3(1, 0.42, 0.17);
  bobberMat.emissiveColor = new Color3(0.3, 0.1, 0);
  bobber.material = bobberMat;
  const bob = new Animation("bob", "position.y", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  bob.setKeys([
    { frame: 0, value: 0.12 },
    { frame: 30, value: 0.2 },
    { frame: 60, value: 0.12 },
  ]);
  bobber.animations.push(bob);
  scene.beginAnimation(bobber, 0, 60, true);

  // HD-2D post stack: tilt-shift DOF, bloom, vignette, grain.
  const pipeline = new DefaultRenderingPipeline("hd2d", true, scene, [camera]);
  pipeline.depthOfFieldEnabled = true;
  pipeline.depthOfField.focusDistance = 13000; // mm, on the dock
  pipeline.depthOfField.fStop = 1.4;
  pipeline.depthOfField.focalLength = 120;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.75;
  pipeline.bloomWeight = 0.35;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 2.2;
  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 6;

  const splash = (): void => {
    const pop = new Animation("pop", "scaling", 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    pop.setKeys([
      { frame: 0, value: new Vector3(1, 1, 1) },
      { frame: 8, value: new Vector3(2.2, 2.2, 2.2) },
      { frame: 24, value: new Vector3(1, 1, 1) },
    ]);
    scene.beginDirectAnimation(bobber, [pop], 0, 24, false);
  };

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  return { engine, scene, splash };
}

/** 16×32 placeholder sprite, nearest-filtered, alpha-tested so it casts a crisp shadow. */
function pixelSpriteMaterial(scene: Scene): StandardMaterial {
  const tex = new DynamicTexture("fisherTex", { width: 16, height: 32 }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 16, 32);
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  px(4, 2, 8, 3, "#7a3b1d"); // hat
  px(5, 5, 6, 5, "#f2c79b"); // face
  px(4, 10, 8, 10, "#2f6fae"); // shirt
  px(2, 11, 2, 7, "#f2c79b"); // arm
  px(12, 11, 2, 7, "#f2c79b");
  px(5, 20, 3, 10, "#3b3b4f"); // legs
  px(8, 20, 3, 10, "#3b3b4f");
  px(4, 30, 4, 2, "#222");
  px(8, 30, 4, 2, "#222");
  tex.hasAlpha = true;
  tex.update();

  const mat = new StandardMaterial("fisherMat", scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.backFaceCulling = false;
  mat.specularColor = Color3.Black();
  return mat;
}
