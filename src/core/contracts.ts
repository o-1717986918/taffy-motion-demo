export type QuaternionTuple = [number, number, number, number];
export type Vector2Tuple = [number, number];
export type Vector3Tuple = [number, number, number];

export interface ArmPose {
  confidence: number;
  lowerConfidence: number;
  upper: Vector3Tuple;
  lower: Vector3Tuple;
}

export interface UpperBodyPose {
  present: boolean;
  confidence: number;
  torsoEuler: { pitch: number; yaw: number; roll: number };
  leftArm: ArmPose;
  rightArm: ArmPose;
}

export type Handedness = "Left" | "Right";
export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";
export type FingerCurls = Record<FingerName, number>;
export type HandGesture = "neutral" | "open" | "fist" | "peace" | "ok" | "fingerHeart" | "pointing";

export interface TrackedHand {
  handedness: Handedness;
  confidence: number;
  /** x, y, z, confidence for each of MediaPipe Hands' 21 landmarks. */
  landmarks: Float32Array;
  /** Metric world coordinates using the same four-value stride. */
  worldLandmarks?: Float32Array;
}

export interface HandPose {
  present: boolean;
  confidence: number;
  center: Vector3Tuple;
  wristEuler: { pitch: number; yaw: number; roll: number };
  fingerCurls: FingerCurls;
  gesture: HandGesture;
  gestureConfidence: number;
}

export interface HandsPose {
  left: HandPose;
  right: HandPose;
}

export type UpperBodyGesture =
  | "waveLeft"
  | "waveRight"
  | "handsUp"
  | "pointLeft"
  | "pointRight"
  | "armsCrossed"
  | "handOnCheek"
  | "coverMouth"
  | "touchHead"
  | "shrug"
  | "leanForward"
  | "leanBackward"
  | "leanLeft"
  | "leanRight";

export interface GestureActivation {
  name: UpperBodyGesture;
  confidence: number;
}

export type ExpressionPreset = "neutral" | "happy" | "shy" | "wronged" | "angry" | "shocked" | "heart";

export interface TrackingFrame {
  schemaVersion: 1;
  source: "mediapipe-face" | "openseeface" | "arkit" | "replay";
  captureTimeMs: number;
  producedTimeMs: number;
  inferenceTimeMs: number;
  face: {
    present: boolean;
    confidence: number;
    headRotation: QuaternionTuple;
    headPosition?: [number, number, number];
    gaze: { left: Vector2Tuple; right: Vector2Tuple };
    blendshapes: Record<string, number>;
    landmarks?: Float32Array;
  };
  pose?: {
    present: boolean;
    confidence: number;
    /** x, y, z, visibility for each of MediaPipe Pose's 33 landmarks. */
    landmarks?: Float32Array;
    /** Metric world coordinates using the same four-value stride. */
    worldLandmarks?: Float32Array;
  };
  hands?: TrackedHand[];
}

export interface AvatarFrame {
  timestampMs: number;
  sourceAgeMs: number;
  facePresent: boolean;
  confidence: number;
  headEuler: { pitch: number; yaw: number; roll: number };
  gaze: { left: Vector2Tuple; right: Vector2Tuple };
  upperBody: UpperBodyPose;
  hands: HandsPose;
  gestures: GestureActivation[];
  expression: { name: ExpressionPreset; confidence: number };
  morphs: Record<string, number>;
  activeMorphs: Array<{ name: string; weight: number }>;
}

export interface ModelSource {
  modelFile: File;
  referenceFiles: File[];
}

export type CapabilityLevel = "ready" | "degraded" | "blocked";

export interface ModelCapabilities {
  level: CapabilityLevel;
  fileName: string;
  displayName: string;
  sha256: string;
  sizeBytes: number;
  totalFolderBytes: number;
  boneCount: number;
  morphCount: number;
  materialCount: number;
  textureCount: number;
  resolvedBones: Record<string, string | null>;
  resolvedMorphs: Record<string, string | null>;
  drivenBones: string[];
  unmappedBones: string[];
  automaticMorphs: string[];
  manualMorphs: string[];
  unmappedMorphs: string[];
  warnings: string[];
  readyFeatures: string[];
}

export interface PerformanceSnapshot {
  captureFps: number;
  inferenceFps: number;
  renderFps: number;
  inferenceMs: number;
  latencyMs: number;
  droppedFrames: number;
  facePresent: boolean;
  posePresent: boolean;
  handsPresent: boolean;
  backend: string;
}

export interface TrackingProvider {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  submit(image: ImageBitmap, captureTimeMs: number): boolean;
  onFrame(callback: (frame: TrackingFrame) => void): () => void;
}

export interface AvatarAdapter {
  load(source: ModelSource): Promise<ModelCapabilities>;
  setLatestFrame(frame: AvatarFrame): void;
  resetToNeutral(durationMs?: number): void;
  resize(): void;
  dispose(): Promise<void>;
}

export type DrawerView = "model" | "expressions" | "voice" | "performance" | "output" | "diagnostics" | "about";
