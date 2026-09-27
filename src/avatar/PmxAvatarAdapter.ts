import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Scene } from "@babylonjs/core/scene";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene as BabylonScene } from "@babylonjs/core/scene";
import "babylon-mmd/esm/Loader/mmdModelLoader";
import "babylon-mmd/esm/Loader/mmdOutlineRenderer";
import "babylon-mmd/esm/Loader/pmxLoader";
import "babylon-mmd/esm/Runtime/mmdRuntimeShared";
import type { MmdMesh } from "babylon-mmd/esm/Runtime/mmdMesh";
import type { MmdModel } from "babylon-mmd/esm/Runtime/mmdModel";
import { MmdRuntime } from "babylon-mmd/esm/Runtime/mmdRuntime";
import type { ArmPose, AvatarAdapter, AvatarFrame, HandPose, ModelCapabilities, ModelSource } from "../core/contracts";
import { boneAliases, morphAliases, resolveAliases, taffyProfile } from "../profiles/taffy-1883";

export type StageBackground = "studio" | "transparent" | "green" | "midnight";
export type QualityPreset = "light" | "balanced" | "high";

interface LoadedModel {
  container: AssetContainer;
  model: MmdModel;
  capabilities: ModelCapabilities;
  boneIndex: Map<string, number>;
  morphIndex: Map<string, number>;
  armRest: {
    leftUpper: Vector3;
    leftLower: Vector3;
    rightUpper: Vector3;
    rightLower: Vector3;
  };
}

const textureExtensions = new Set(["png", "jpg", "jpeg", "bmp", "tga", "dds", "spa", "sph"]);
const fingerSemantics = (["thumb0", "thumb1", "thumb2", "index1", "index2", "index3", "middle1", "middle2", "middle3", "ring1", "ring2", "ring3", "pinky1", "pinky2", "pinky3"] as const)
  .flatMap((finger) => [`${finger}Left`, `${finger}Right`]);
const drivenBoneSemantics = [
  "upperBody", "upperBody2", "shoulderLeft", "shoulderRight", "armLeft", "armRight", "elbowLeft", "elbowRight", "wristLeft", "wristRight",
  "neck", "head", "eyeLeft", "eyeRight", ...fingerSemantics
] as const;

async function sha256(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const rootUrlFor = (file: File): string => {
  const relative = file.webkitRelativePath || file.name;
  const slash = relative.lastIndexOf("/");
  return slash >= 0 ? relative.slice(0, slash + 1) : "";
};

export class PmxAvatarAdapter implements AvatarAdapter {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly runtime: MmdRuntime;
  private loaded: LoadedModel | null = null;
  private latestFrame: AvatarFrame | null = null;
  private background: StageBackground = "studio";
  private renderObserver: Observer<BabylonScene> | null = null;
  private readonly frameTimes: number[] = [];
  private onRenderStats: ((fps: number) => void) | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
      stencil: true,
      powerPreference: "high-performance"
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.925, 0.914, 0.965, 1);
    this.scene.ambientColor = new Color3(0.48, 0.46, 0.54);
    this.camera = new ArcRotateCamera("portrait-camera", -Math.PI / 2, Math.PI / 2, 28, new Vector3(0, 11.5, 0), this.scene);
    this.camera.lowerRadiusLimit = 3;
    this.camera.upperRadiusLimit = 80;
    this.camera.wheelPrecision = 36;
    this.camera.panningSensibility = 0;
    this.camera.attachControl(canvas, true);

    const key = new DirectionalLight("key-light", new Vector3(-0.38, -0.72, 0.58), this.scene);
    key.intensity = 1.35;
    const fill = new HemisphericLight("fill-light", new Vector3(0, 1, 0), this.scene);
    fill.intensity = 0.78;
    fill.diffuse = new Color3(0.9, 0.87, 0.98);
    fill.groundColor = new Color3(0.42, 0.36, 0.5);

    this.runtime = new MmdRuntime(this.scene, null);
    this.runtime.register(this.scene);
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.applyLatestFrame());
    this.engine.runRenderLoop(() => {
      this.scene.render();
      const now = performance.now();
      this.frameTimes.push(now);
      while (this.frameTimes.length > 1 && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
      this.onRenderStats?.(this.frameTimes.length);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
  }

  setStatsListener(listener: (fps: number) => void): void {
    this.onRenderStats = listener;
  }

  async load(source: ModelSource): Promise<ModelCapabilities> {
    const digest = await sha256(source.modelFile);
    let container: AssetContainer | null = null;
    try {
      container = await LoadAssetContainerAsync(source.modelFile, this.scene, {
        rootUrl: rootUrlFor(source.modelFile),
        pluginOptions: {
          mmdmodel: {
            referenceFiles: source.referenceFiles,
            loggingEnabled: true,
            optimizeSubmeshes: true,
            useSdef: false
          }
        }
      });
      const rootMesh = container.meshes[0] as MmdMesh | undefined;
      if (!rootMesh?.metadata?.isMmdModel || container.meshes.length < 2) {
        throw new Error("PMX 中没有可渲染网格。");
      }

      const metadata = rootMesh.metadata;
      const boneNames = metadata.bones.map((bone) => bone.name);
      const morphNames = metadata.morphs.map((morph) => morph.name);
      const resolvedBones: Record<string, string | null> = digest === taffyProfile.pmxSha256
        ? Object.fromEntries(Object.entries(taffyProfile.bones).map(([key, value]) => [key, boneNames.includes(value) ? value : null]))
        : resolveAliases(boneNames, boneAliases);
      const resolvedMorphs: Record<string, string | null> = digest === taffyProfile.pmxSha256
        ? Object.fromEntries(Object.entries(taffyProfile.morphs).map(([key, value]) => [key, morphNames.includes(value) ? value : null]))
        : resolveAliases(morphNames, morphAliases);
      const warnings: string[] = [];
      if (!resolvedBones.head) warnings.push("缺少头部骨骼：头部姿态不可用。");
      if (!resolvedBones.eyeLeft || !resolvedBones.eyeRight) warnings.push("缺少单眼骨骼：视线跟随已降级。");
      if (!resolvedBones.upperBody) warnings.push("缺少上半身骨骼：躯干跟随已降级。");
      if (!resolvedBones.armLeft || !resolvedBones.armRight) warnings.push("缺少左右上臂骨骼：手臂跟随已降级。");
      if (!resolvedBones.elbowLeft || !resolvedBones.elbowRight) warnings.push("缺少左右肘骨骼：小臂跟随已降级。");
      if (!resolvedMorphs.blinkBoth) warnings.push("缺少双眼眨眼形态键。");
      if (!resolvedMorphs.blinkLeft || !resolvedMorphs.blinkRight) warnings.push("缺少单眼形态键：单眼眨眼将使用双眼降级。");
      if (!resolvedMorphs.mouthA) warnings.push("缺少基础张嘴形态键：口型不可用。");
      const vowelKeys = ["mouthA", "mouthI", "mouthU", "mouthE", "mouthO"];
      if (vowelKeys.filter((key) => resolvedMorphs[key]).length < 5) warnings.push("五元音不完整：使用已有口型近似。");
      const drivenBones = [...new Set(drivenBoneSemantics.map((key) => resolvedBones[key]).filter((name): name is string => Boolean(name)))];
      const automaticMorphs = [...new Set(Object.values(resolvedMorphs).filter((name): name is string => Boolean(name)))];
      const manualMorphs = taffyProfile.manualExpressions.filter((name) => morphNames.includes(name));
      const usedMorphs = new Set([...automaticMorphs, ...manualMorphs]);

      const capabilities: ModelCapabilities = {
        level: !resolvedBones.head && !resolvedMorphs.mouthA ? "degraded" : warnings.length ? "degraded" : "ready",
        fileName: source.modelFile.name,
        displayName: metadata.header.modelName || source.modelFile.name.replace(/\.pmx$/i, ""),
        sha256: digest,
        sizeBytes: source.modelFile.size,
        totalFolderBytes: source.referenceFiles.reduce((sum, file) => sum + file.size, 0),
        boneCount: metadata.bones.length,
        morphCount: metadata.morphs.length,
        materialCount: metadata.materials.length,
        textureCount: source.referenceFiles.filter((file) => textureExtensions.has(file.name.split(".").pop()?.toLowerCase() ?? "")).length,
        resolvedBones,
        resolvedMorphs,
        drivenBones,
        unmappedBones: [...new Set(boneNames.filter((name) => !drivenBones.includes(name)))],
        automaticMorphs,
        manualMorphs,
        unmappedMorphs: [...new Set(morphNames.filter((name) => !usedMorphs.has(name)))],
        warnings,
        readyFeatures: [
          resolvedBones.head && "头部姿态",
          resolvedBones.upperBody && "上半身姿态",
          resolvedBones.armLeft && resolvedBones.armRight && "双臂跟随",
          resolvedBones.wristLeft && resolvedBones.wristRight && "手腕方向",
          fingerSemantics.filter((key) => resolvedBones[key]).length >= 20 && "独立手指弯曲",
          resolvedBones.eyeLeft && resolvedBones.eyeRight && "视线跟随",
          resolvedMorphs.blinkBoth && "眨眼",
          resolvedMorphs.mouthA && "口型",
          resolvedMorphs.smile && "连续表情"
        ].filter(Boolean) as string[]
      };

      container.addAllToScene();
      const runtimeModel = this.runtime.createMmdModel(rootMesh, {
        buildPhysics: false,
        trimMetadata: false
      });
      const boneIndex = new Map(runtimeModel.runtimeBones.map((bone, index) => [bone.name, index]));
      const restPositions = new Map<string, Vector3>();
      const readRestPosition = (bone: MmdModel["runtimeBones"][number]): Vector3 => {
        const cached = restPositions.get(bone.name);
        if (cached) return cached;
        const matrix = bone.linkedBone.getRestMatrix();
        const local = new Vector3(matrix.m[12], matrix.m[13], matrix.m[14]);
        const absolute = bone.parentBone ? readRestPosition(bone.parentBone).add(local) : local;
        restPositions.set(bone.name, absolute);
        return absolute;
      };
      for (const bone of runtimeModel.runtimeBones) readRestPosition(bone);
      const restDirection = (fromSemantic: string, toSemantic: string, fallback: Vector3): Vector3 => {
        const fromName = capabilities.resolvedBones[fromSemantic];
        const toName = capabilities.resolvedBones[toSemantic];
        const from = fromName ? restPositions.get(fromName) : undefined;
        const to = toName ? restPositions.get(toName) : undefined;
        if (!from || !to || Vector3.DistanceSquared(from, to) < 0.000001) return fallback.clone();
        return to.subtract(from).normalize();
      };
      const next: LoadedModel = {
        container,
        model: runtimeModel,
        capabilities,
        boneIndex,
        morphIndex: new Map(metadata.morphs.map((morph, index) => [morph.name, index])),
        armRest: {
          leftUpper: restDirection("armLeft", "elbowLeft", new Vector3(1, 0, 0)),
          leftLower: restDirection("elbowLeft", "wristLeft", new Vector3(1, 0, 0)),
          rightUpper: restDirection("armRight", "elbowRight", new Vector3(-1, 0, 0)),
          rightLower: restDirection("elbowRight", "wristRight", new Vector3(-1, 0, 0))
        }
      };

      const previous = this.loaded;
      this.loaded = next;
      this.frameModel(rootMesh);
      if (previous) this.releaseModel(previous);
      return capabilities;
    } catch (error) {
      container?.dispose();
      throw error;
    }
  }

  setLatestFrame(frame: AvatarFrame): void {
    this.latestFrame = frame;
  }

  setBackground(background: StageBackground): void {
    this.background = background;
    const colors: Record<Exclude<StageBackground, "transparent">, Color4> = {
      studio: new Color4(0.925, 0.914, 0.965, 1),
      green: new Color4(0, 0.69, 0.19, 1),
      midnight: new Color4(0.012, 0.018, 0.034, 1)
    };
    this.scene.clearColor = background === "transparent" ? new Color4(0, 0, 0, 0) : colors[background];
  }

  setQuality(preset: QualityPreset): void {
    const scale = preset === "light" ? 1.5 : preset === "high" ? 0.85 : 1;
    this.engine.setHardwareScalingLevel(scale);
    this.resize();
  }

  getBackground(): StageBackground {
    return this.background;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  resetCamera(): void {
    if (!this.loaded) {
      this.camera.setTarget(new Vector3(0, 11.5, 0));
      this.camera.radius = 28;
      this.camera.alpha = -Math.PI / 2;
      this.camera.beta = Math.PI / 2;
      return;
    }
    this.frameModel(this.loaded.model.mesh as unknown as MmdMesh);
  }

  resetToNeutral(): void {
    this.latestFrame = null;
    if (!this.loaded) return;
    this.loaded.model.morph.resetMorphWeights();
    for (const semantic of [
      "upperBody", "upperBody2", "shoulderLeft", "shoulderRight", "armLeft", "armRight",
      "elbowLeft", "elbowRight", "wristLeft", "wristRight", "neck", "head", "eyeLeft", "eyeRight",
      ...fingerSemantics
    ]) {
      const name = this.loaded.capabilities.resolvedBones[semantic];
      const index = name ? this.loaded.boneIndex.get(name) : undefined;
      if (index !== undefined) this.loaded.model.runtimeBones[index].linkedBone.rotationQuaternion = Quaternion.Identity();
    }
  }

  resize(): void {
    this.engine.resize();
  }

  async dispose(): Promise<void> {
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
    if (this.renderObserver) this.scene.onBeforeRenderObservable.remove(this.renderObserver);
    if (this.loaded) this.releaseModel(this.loaded);
    this.runtime.dispose(this.scene);
    this.scene.dispose();
    this.engine.dispose();
  }

  private releaseModel(loaded: LoadedModel): void {
    try {
      this.runtime.destroyMmdModel(loaded.model);
    } catch {
      // Scene disposal may have already detached the runtime model.
    }
    loaded.container.removeAllFromScene();
    loaded.container.dispose();
  }

  private frameModel(rootMesh: MmdMesh): void {
    rootMesh.computeWorldMatrix(true);
    const bounds = rootMesh.getHierarchyBoundingVectors(true);
    const height = Math.max(1, bounds.max.y - bounds.min.y);
    const targetY = bounds.min.y + height * 0.72;
    this.camera.setTarget(new Vector3((bounds.min.x + bounds.max.x) / 2, targetY, (bounds.min.z + bounds.max.z) / 2));
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = Math.PI / 2;
    this.camera.radius = Math.max(7, height * 0.73);
  }

  private applyLatestFrame(): void {
    const loaded = this.loaded;
    if (!loaded) return;
    const frame = this.latestFrame;
    const t = performance.now() / 1000;
    const { model, capabilities } = loaded;

    const setBone = (semantic: string, rotation: Quaternion): void => {
      const name = capabilities.resolvedBones[semantic];
      const index = name ? loaded.boneIndex.get(name) : undefined;
      if (index !== undefined) model.runtimeBones[index].linkedBone.rotationQuaternion = rotation;
    };

    if (frame) {
      const body = frame.upperBody;
      const torso = body.torsoEuler;
      const torsoGlobal = Quaternion.RotationYawPitchRoll(torso.yaw, torso.pitch, torso.roll);
      if (capabilities.resolvedBones.upperBody && capabilities.resolvedBones.upperBody2) {
        const torsoRoot = Quaternion.Slerp(Quaternion.Identity(), torsoGlobal, 0.56);
        const torsoChest = Quaternion.Inverse(torsoRoot).multiply(torsoGlobal).normalize();
        setBone("upperBody", torsoRoot);
        setBone("upperBody2", torsoChest);
      } else {
        setBone("upperBody", torsoGlobal);
        setBone("upperBody2", torsoGlobal);
      }

      const applyArm = (
        side: "Left" | "Right",
        pose: ArmPose,
        upperRest: Vector3,
        lowerRest: Vector3
      ): void => {
        const upperGlobalDirection = new Vector3(...pose.upper).normalize();
        const lowerGlobalDirection = new Vector3(...pose.lower).normalize();
        const inverseTorso = Quaternion.Inverse(torsoGlobal);
        const upperLocalDirection = upperGlobalDirection.rotateByQuaternionToRef(inverseTorso, new Vector3()).normalize();
        const fullArmRotation = new Quaternion();
        Quaternion.FromUnitVectorsToRef(upperRest, upperLocalDirection, fullArmRotation);
        const armWeight = Math.min(1, Math.max(0, (pose.confidence - 0.18) / 0.42));
        const armRotation = Quaternion.Slerp(Quaternion.Identity(), fullArmRotation, armWeight).normalize();

        // Convert the forearm target into the elbow's parent space. Applying a
        // world-space quaternion directly to this local bone was the main cause
        // of inaccurate, compounded arm motion in the previous implementation.
        const upperWorldRotation = torsoGlobal.multiply(armRotation).normalize();
        const inverseUpperWorld = Quaternion.Inverse(upperWorldRotation);
        const lowerLocalDirection = lowerGlobalDirection.rotateByQuaternionToRef(inverseUpperWorld, new Vector3()).normalize();
        const fullElbowRotation = new Quaternion();
        Quaternion.FromUnitVectorsToRef(lowerRest, lowerLocalDirection, fullElbowRotation);
        const elbowWeight = Math.min(1, Math.max(0, (pose.lowerConfidence - 0.18) / 0.42));
        const elbowRotation = Quaternion.Slerp(Quaternion.Identity(), fullElbowRotation, elbowWeight).normalize();

        setBone(`shoulder${side}`, Quaternion.Identity());
        setBone(`arm${side}`, armRotation);
        setBone(`elbow${side}`, elbowRotation);
      };
      applyArm("Left", body.leftArm, loaded.armRest.leftUpper, loaded.armRest.leftLower);
      applyArm("Right", body.rightArm, loaded.armRest.rightUpper, loaded.armRest.rightLower);
      const shrug = frame.gestures.find((gesture) => gesture.name === "shrug")?.confidence ?? 0;
      setBone("shoulderLeft", Quaternion.RotationYawPitchRoll(0, 0, -shrug * 0.13));
      setBone("shoulderRight", Quaternion.RotationYawPitchRoll(0, 0, shrug * 0.13));

      const applyHand = (side: "Left" | "Right", hand: HandPose): void => {
        const weight = hand.present ? Math.min(1, Math.max(0, (hand.confidence - 0.25) / 0.5)) : 0;
        const wrist = Quaternion.Slerp(
          Quaternion.Identity(),
          Quaternion.RotationYawPitchRoll(hand.wristEuler.yaw * 0.62, hand.wristEuler.pitch * 0.5, hand.wristEuler.roll * 0.72),
          weight
        );
        setBone(`wrist${side}`, wrist);
        // The Taffy PMX finger chains use the opposite local Z bend direction
        // from the screen-space hand basis. Keep the detected anatomical side,
        // but invert the joint rotation so a real curl closes the model hand.
        const sign = side === "Left" ? 1 : -1;
        const applyFinger = (name: "index" | "middle" | "ring" | "pinky", curl: number): void => {
          const angles = [0.62, 0.92, 0.72];
          angles.forEach((angle, index) => setBone(
            `${name}${index + 1}${side}`,
            Quaternion.RotationYawPitchRoll(0, 0, sign * curl * angle * weight)
          ));
        };
        applyFinger("index", hand.fingerCurls.index);
        applyFinger("middle", hand.fingerCurls.middle);
        applyFinger("ring", hand.fingerCurls.ring);
        applyFinger("pinky", hand.fingerCurls.pinky);
        const thumb = hand.fingerCurls.thumb * weight;
        setBone(`thumb0${side}`, Quaternion.RotationYawPitchRoll(sign * thumb * 0.38, thumb * 0.18, sign * thumb * 0.24));
        setBone(`thumb1${side}`, Quaternion.RotationYawPitchRoll(0, 0, sign * thumb * 0.58));
        setBone(`thumb2${side}`, Quaternion.RotationYawPitchRoll(0, 0, sign * thumb * 0.66));
      };
      applyHand("Left", frame.hands.left);
      applyHand("Right", frame.hands.right);

      const pitch = frame.headEuler.pitch - torso.pitch;
      const yaw = frame.headEuler.yaw - torso.yaw;
      const roll = frame.headEuler.roll - torso.roll;
      setBone("neck", Quaternion.RotationYawPitchRoll(yaw * 0.25, pitch * 0.25, roll * 0.25));
      setBone("head", Quaternion.RotationYawPitchRoll(yaw * 0.75, pitch * 0.75, roll * 0.75));
      setBone("eyeLeft", Quaternion.RotationYawPitchRoll(frame.gaze.left[0] * 0.34, frame.gaze.left[1] * 0.2, 0));
      setBone("eyeRight", Quaternion.RotationYawPitchRoll(frame.gaze.right[0] * 0.34, frame.gaze.right[1] * 0.2, 0));

      model.morph.resetMorphWeights();
      for (const [semantic, weight] of Object.entries(frame.morphs)) {
        const actualName = capabilities.resolvedMorphs[semantic] ?? (loaded.morphIndex.has(semantic) ? semantic : null);
        const index = actualName ? loaded.morphIndex.get(actualName) : undefined;
        if (index !== undefined) model.morph.setMorphWeightFromIndex(index, weight);
      }
    }

    const upperBodyName = capabilities.resolvedBones.upperBody;
    const upperBodyIndex = upperBodyName ? loaded.boneIndex.get(upperBodyName) : undefined;
    if (upperBodyIndex !== undefined && !frame?.upperBody.present) {
      const breath = Math.sin(t * 1.25) * 0.012;
      loaded.model.runtimeBones[upperBodyIndex].linkedBone.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.sin(t * 0.42) * 0.009, breath, 0);
    }
  }
}
