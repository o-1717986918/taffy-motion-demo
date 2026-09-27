import type {
  AvatarFrame,
  ExpressionPreset,
  FingerCurls,
  GestureActivation,
  HandGesture,
  HandPose,
  HandsPose,
  QuaternionTuple,
  TrackedHand,
  TrackingFrame,
  UpperBodyPose,
  Vector3Tuple
} from "./contracts";
import { OneEuroFilter } from "./OneEuroFilter";
import {
  clamp,
  invertQuaternion,
  median,
  multiplyQuaternion,
  normalizeQuaternion,
  quaternionToEuler,
  remap,
  smoothstep
} from "./math";

export type MotionSensitivity = "stable" | "balanced" | "responsive";

type Euler = { pitch: number; yaw: number; roll: number };
type CalibrationSample = { rotation: QuaternionTuple; blendshapes: Record<string, number>; torso?: Euler };
type RawArm = { confidence: number; lowerConfidence: number; upper: Vector3Tuple; lower: Vector3Tuple };
type RawUpperBody = { present: boolean; confidence: number; torsoEuler: Euler; leftArm: RawArm; rightArm: RawArm };
type WaveTracker = { lastX: number; direction: -1 | 0 | 1; reversals: number; windowStartMs: number; score: number };

const sensitivityProfiles: Record<MotionSensitivity, {
  headGain: number;
  expressionGain: number;
  gazeGain: number;
  deadzone: number;
}> = {
  stable: { headGain: 0.9, expressionGain: 0.95, gazeGain: 0.9, deadzone: 0.024 },
  balanced: { headGain: 1.12, expressionGain: 1.1, gazeGain: 1.05, deadzone: 0.012 },
  responsive: { headGain: 1.38, expressionGain: 1.26, gazeGain: 1.18, deadzone: 0.006 }
};

const restLeft: Vector3Tuple = [1, 0, 0];
const restRight: Vector3Tuple = [-1, 0, 0];
const zeroEuler = (): Euler => ({ pitch: 0, yaw: 0, roll: 0 });

const normalizeVector = (value: Vector3Tuple, fallback: Vector3Tuple): Vector3Tuple => {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 0.0001 ? [value[0] / length, value[1] / length, value[2] / length] : [...fallback];
};

const subtract = (a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const midpoint = (a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

const emptyArm = (rest: Vector3Tuple): RawArm => ({ confidence: 0, lowerConfidence: 0, upper: [...rest], lower: [...rest] });
const emptyUpperBody = (): RawUpperBody => ({
  present: false,
  confidence: 0,
  torsoEuler: zeroEuler(),
  leftArm: emptyArm(restLeft),
  rightArm: emptyArm(restRight)
});

const mirrorVector = (value: Vector3Tuple): Vector3Tuple => [-value[0], value[1], value[2]];

const mirrorUpperBody = (value: RawUpperBody): RawUpperBody => ({
  present: value.present,
  confidence: value.confidence,
  torsoEuler: {
    pitch: value.torsoEuler.pitch,
    yaw: -value.torsoEuler.yaw,
    roll: -value.torsoEuler.roll
  },
  leftArm: {
    ...value.rightArm,
    upper: normalizeVector(mirrorVector(value.rightArm.upper), restLeft),
    lower: normalizeVector(mirrorVector(value.rightArm.lower), restLeft)
  },
  rightArm: {
    ...value.leftArm,
    upper: normalizeVector(mirrorVector(value.leftArm.upper), restRight),
    lower: normalizeVector(mirrorVector(value.leftArm.lower), restRight)
  }
});

const emptyFingerCurls = (): FingerCurls => ({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
const emptyHand = (): HandPose => ({
  present: false,
  confidence: 0,
  center: [0.5, 0.5, 0],
  wristEuler: zeroEuler(),
  fingerCurls: emptyFingerCurls(),
  gesture: "neutral",
  gestureConfidence: 0
});

const handPoint = (hand: TrackedHand, index: number): Vector3Tuple => [
  hand.landmarks[index * 4] ?? 0,
  hand.landmarks[index * 4 + 1] ?? 0,
  hand.landmarks[index * 4 + 2] ?? 0
];

const distance = (a: Vector3Tuple, b: Vector3Tuple): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const jointAngle = (a: Vector3Tuple, b: Vector3Tuple, c: Vector3Tuple): number => {
  const first = normalizeVector(subtract(a, b), [1, 0, 0]);
  const second = normalizeVector(subtract(c, b), [1, 0, 0]);
  return Math.acos(clamp(first[0] * second[0] + first[1] * second[1] + first[2] * second[2], -1, 1));
};

const fingerCurl = (hand: TrackedHand, chain: [number, number, number, number]): number => {
  const first = jointAngle(handPoint(hand, chain[0]), handPoint(hand, chain[1]), handPoint(hand, chain[2]));
  const second = jointAngle(handPoint(hand, chain[1]), handPoint(hand, chain[2]), handPoint(hand, chain[3]));
  return clamp((Math.PI - (first + second) / 2 - 0.12) / 1.35);
};

export const estimateFingerCurls = (hand: TrackedHand): FingerCurls => ({
  thumb: fingerCurl(hand, [1, 2, 3, 4]),
  index: fingerCurl(hand, [5, 6, 7, 8]),
  middle: fingerCurl(hand, [9, 10, 11, 12]),
  ring: fingerCurl(hand, [13, 14, 15, 16]),
  pinky: fingerCurl(hand, [17, 18, 19, 20])
});

export const classifyHandGesture = (hand: TrackedHand, curls = estimateFingerCurls(hand)): {
  gesture: HandGesture;
  confidence: number;
} => {
  const palmSize = Math.max(0.0001, distance(handPoint(hand, 5), handPoint(hand, 17)));
  const pinch = distance(handPoint(hand, 4), handPoint(hand, 8)) / palmSize;
  const extended = (name: keyof FingerCurls): number => 1 - curls[name];
  const bent = (name: keyof FingerCurls): number => curls[name];
  const candidates: Array<{ gesture: HandGesture; confidence: number }> = [
    {
      gesture: "fingerHeart",
      confidence: clamp((0.48 - pinch) / 0.3) * Math.min(bent("middle"), bent("ring"), bent("pinky"))
    },
    {
      gesture: "ok",
      confidence: clamp((0.45 - pinch) / 0.28) * Math.min(extended("middle"), extended("ring"), extended("pinky"))
    },
    {
      gesture: "peace",
      confidence: Math.min(extended("index"), extended("middle"), bent("ring"), bent("pinky"))
    },
    {
      gesture: "pointing",
      confidence: Math.min(extended("index"), bent("middle"), bent("ring"), bent("pinky"))
    },
    {
      gesture: "fist",
      confidence: Math.min(bent("index"), bent("middle"), bent("ring"), bent("pinky"))
    },
    {
      gesture: "open",
      confidence: Math.min(extended("index"), extended("middle"), extended("ring"), extended("pinky"))
    }
  ];
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  return best.confidence >= 0.46 ? best : { gesture: "neutral", confidence: clamp(best.confidence) };
};

export const estimateHandPose = (hand: TrackedHand): HandPose => {
  const wrist = handPoint(hand, 0);
  const indexMcp = handPoint(hand, 5);
  const middleMcp = handPoint(hand, 9);
  const pinkyMcp = handPoint(hand, 17);
  const along = normalizeVector([middleMcp[0] - wrist[0], wrist[1] - middleMcp[1], middleMcp[2] - wrist[2]], [0, 1, 0]);
  const across = normalizeVector([pinkyMcp[0] - indexMcp[0], indexMcp[1] - pinkyMcp[1], pinkyMcp[2] - indexMcp[2]], [1, 0, 0]);
  const curls = estimateFingerCurls(hand);
  const classified = classifyHandGesture(hand, curls);
  return {
    present: true,
    confidence: hand.confidence,
    center: midpoint(midpoint(wrist, middleMcp), midpoint(indexMcp, pinkyMcp)),
    wristEuler: {
      pitch: clamp(Math.atan2(along[2], Math.hypot(along[0], along[1])), -0.9, 0.9),
      yaw: clamp(Math.atan2(across[2], Math.max(0.001, Math.abs(across[0]))), -0.9, 0.9),
      roll: clamp(Math.atan2(across[1], Math.max(0.001, Math.abs(across[0]))), -1.1, 1.1)
    },
    fingerCurls: curls,
    gesture: classified.gesture,
    gestureConfidence: classified.confidence
  };
};

const mirrorHandPose = (hand: HandPose): HandPose => ({
  ...hand,
  wristEuler: { pitch: hand.wristEuler.pitch, yaw: -hand.wristEuler.yaw, roll: -hand.wristEuler.roll }
});

const normalizedPoint = (values: Float32Array | undefined, index: number): Vector3Tuple | null => {
  if (!values) return null;
  const stride = values.length > 1000 ? 3 : 4;
  if (values.length < (index + 1) * stride || (stride === 4 && (values[index * stride + 3] ?? 0) < 0.18)) return null;
  return [values[index * stride], values[index * stride + 1], values[index * stride + 2]];
};

const planarDistance = (a: Vector3Tuple, b: Vector3Tuple): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const recognizeUpperBodyGestures = (
  frame: TrackingFrame,
  upperBody: UpperBodyPose,
  hands: HandsPose
): GestureActivation[] => {
  const result: GestureActivation[] = [];
  const pose = frame.pose?.landmarks;
  const shoulderLeft = normalizedPoint(pose, 11);
  const shoulderRight = normalizedPoint(pose, 12);
  const elbowLeft = normalizedPoint(pose, 13);
  const elbowRight = normalizedPoint(pose, 14);
  const wristLeft = normalizedPoint(pose, 15);
  const wristRight = normalizedPoint(pose, 16);
  const scale = shoulderLeft && shoulderRight ? Math.max(0.08, planarDistance(shoulderLeft, shoulderRight)) : 0.22;
  const add = (name: GestureActivation["name"], confidence: number): void => {
    if (confidence >= 0.48) result.push({ name, confidence: clamp(confidence) });
  };

  if (shoulderLeft && shoulderRight && wristLeft && wristRight) {
    const leftUp = clamp((shoulderLeft[1] - wristLeft[1]) / (scale * 0.72));
    const rightUp = clamp((shoulderRight[1] - wristRight[1]) / (scale * 0.72));
    add("handsUp", Math.min(leftUp, rightUp));
    if (elbowLeft && elbowRight) {
      const crossed = Math.min(
        clamp(1 - planarDistance(wristLeft, elbowRight) / (scale * 0.72)),
        clamp(1 - planarDistance(wristRight, elbowLeft) / (scale * 0.72))
      );
      add("armsCrossed", crossed);
      const earLeft = normalizedPoint(pose, 7);
      const earRight = normalizedPoint(pose, 8);
      if (earLeft && earRight) {
        const liftLeft = clamp(1 - Math.abs(shoulderLeft[1] - earLeft[1]) / (scale * 0.72));
        const liftRight = clamp(1 - Math.abs(shoulderRight[1] - earRight[1]) / (scale * 0.72));
        const elbowsOut = clamp((Math.abs(elbowLeft[0] - shoulderLeft[0]) + Math.abs(elbowRight[0] - shoulderRight[0])) / (scale * 1.2));
        add("shrug", Math.min((liftLeft + liftRight) / 2, elbowsOut));
      }
    }
  }

  for (const [side, hand] of [["Left", hands.left], ["Right", hands.right]] as const) {
    if (!hand.present) continue;
    if (hand.gesture === "pointing") add(side === "Left" ? "pointLeft" : "pointRight", hand.gestureConfidence);
  }

  const centers = [hands.left, hands.right].filter((hand) => hand.present).map((hand) => hand.center);
  const faceValues = frame.face.landmarks;
  const mouth = normalizedPoint(faceValues, 13);
  const forehead = normalizedPoint(faceValues, 10);
  const cheeks = [normalizedPoint(faceValues, 234), normalizedPoint(faceValues, 454)].filter(Boolean) as Vector3Tuple[];
  if (mouth) add("coverMouth", Math.max(0, ...centers.map((center) => clamp(1 - planarDistance(center, mouth) / (scale * 0.58)))));
  if (forehead) add("touchHead", Math.max(0, ...centers.map((center) => clamp(1 - planarDistance(center, forehead) / (scale * 0.68)))));
  if (cheeks.length) {
    add("handOnCheek", Math.max(0, ...centers.flatMap((center) => cheeks.map((cheek) => clamp(1 - planarDistance(center, cheek) / (scale * 0.55))))));
  }

  add("leanForward", clamp((-upperBody.torsoEuler.pitch - 0.08) / 0.2));
  add("leanBackward", clamp((upperBody.torsoEuler.pitch - 0.08) / 0.2));
  add("leanLeft", clamp((-upperBody.torsoEuler.roll - 0.08) / 0.2));
  add("leanRight", clamp((upperBody.torsoEuler.roll - 0.08) / 0.2));
  return result.sort((a, b) => b.confidence - a.confidence);
};

export const estimateUpperBody = (pose: TrackingFrame["pose"]): RawUpperBody => {
  if (!pose?.present) return emptyUpperBody();
  const values = pose.worldLandmarks?.length ? pose.worldLandmarks : pose.landmarks;
  if (!values || values.length < 25 * 4) return emptyUpperBody();
  const point = (index: number): { value: Vector3Tuple; visibility: number } => ({
    value: [values[index * 4], -values[index * 4 + 1], values[index * 4 + 2]],
    visibility: clamp(values[index * 4 + 3] ?? 0)
  });
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftElbow = point(13);
  const rightElbow = point(14);
  const leftWrist = point(15);
  const rightWrist = point(16);
  const leftHip = point(23);
  const rightHip = point(24);
  const shoulderConfidence = Math.min(leftShoulder.visibility, rightShoulder.visibility);
  if (shoulderConfidence < 0.22) return emptyUpperBody();

  const shoulders = midpoint(leftShoulder.value, rightShoulder.value);
  const shoulderAxis = subtract(rightShoulder.value, leftShoulder.value);
  const hipConfidence = Math.min(leftHip.visibility, rightHip.visibility);
  const torsoAxis = hipConfidence >= 0.18
    ? subtract(shoulders, midpoint(leftHip.value, rightHip.value))
    : [0, 1, 0] as Vector3Tuple;
  const arm = (
    shoulder: typeof leftShoulder,
    elbow: typeof leftElbow,
    wrist: typeof leftWrist,
    rest: Vector3Tuple
  ): RawArm => {
    const confidence = Math.min(shoulder.visibility, elbow.visibility);
    if (confidence < 0.22) return emptyArm(rest);
    const lowerConfidence = Math.min(elbow.visibility, wrist.visibility);
    const upper = normalizeVector(subtract(elbow.value, shoulder.value), rest);
    return {
      confidence,
      lowerConfidence,
      upper,
      lower: lowerConfidence >= 0.22 ? normalizeVector(subtract(wrist.value, elbow.value), upper) : upper
    };
  };

  return {
    present: true,
    confidence: Math.min(pose.confidence, shoulderConfidence),
    torsoEuler: {
      pitch: Math.atan2(torsoAxis[2], Math.max(0.0001, torsoAxis[1])),
      yaw: Math.atan2(shoulderAxis[2], Math.max(0.0001, Math.abs(shoulderAxis[0]))),
      roll: Math.atan2(shoulderAxis[1], Math.max(0.0001, -shoulderAxis[0]))
    },
    leftArm: arm(leftShoulder, leftElbow, leftWrist, restLeft),
    rightArm: arm(rightShoulder, rightElbow, rightWrist, restRight)
  };
};

const shape = (values: Record<string, number>, name: string): number => values[name] ?? 0;
const pair = (values: Record<string, number>, left: string, right: string): number =>
  (shape(values, left) + shape(values, right)) / 2;

const normalizeGroup = (morphs: Record<string, number>, names: string[]): void => {
  const total = names.reduce((sum, name) => sum + (morphs[name] ?? 0), 0);
  if (total <= 1) return;
  for (const name of names) morphs[name] = (morphs[name] ?? 0) / total;
};

export const selectExpression = (
  morphs: Record<string, number>,
  signals: { smile: number; browDown: number; browInnerUp: number; frown: number; mouthPress: number; surprise: number; gazeAway: number },
  hands: HandsPose
): { name: ExpressionPreset; confidence: number } => {
  const heart = Math.max(
    hands.left.gesture === "fingerHeart" ? hands.left.gestureConfidence : 0,
    hands.right.gesture === "fingerHeart" ? hands.right.gestureConfidence : 0
  );
  const candidates: Array<{ name: ExpressionPreset; confidence: number }> = [
    { name: "heart", confidence: heart },
    { name: "shocked", confidence: signals.surprise },
    { name: "angry", confidence: signals.browDown * 0.72 + signals.mouthPress * 0.42 },
    { name: "wronged", confidence: signals.browInnerUp * 0.68 + signals.frown * 0.48 + signals.mouthPress * 0.18 },
    { name: "shy", confidence: signals.smile * 0.62 + signals.gazeAway * 0.56 },
    { name: "happy", confidence: signals.smile }
  ];
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  // Keep subtle webcam expressions usable. The continuous morph weight still
  // follows the measured confidence, so lowering this gate does not snap the
  // avatar to a full-strength preset.
  const expression = best.confidence >= 0.3 ? { ...best, confidence: clamp(best.confidence) } : { name: "neutral" as const, confidence: 0 };
  const strength = expression.confidence;
  switch (expression.name) {
    case "happy":
      morphs.smile = Math.max(morphs.smile ?? 0, strength * 0.84);
      morphs.happyEyes = strength * 0.72;
      morphs.browHappy = Math.max(morphs.browHappy ?? 0, strength * 0.48);
      break;
    case "shy":
      morphs["照れ"] = strength * 0.82;
      morphs.smile = Math.max(morphs.smile ?? 0, strength * 0.52);
      break;
    case "wronged":
      morphs.sad = Math.max(morphs.sad ?? 0, strength * 0.88);
      morphs.mouthClosed = strength * 0.76;
      morphs["涙"] = smoothstep(clamp((strength - 0.42) / 0.4)) * 0.78;
      break;
    case "angry":
      morphs.angry = Math.max(morphs.angry ?? 0, strength * 0.92);
      morphs.mouthClosed = strength * 0.82;
      break;
    case "shocked":
      morphs.surprised = Math.max(morphs.surprised ?? 0, strength);
      morphs.mouthA = Math.max(morphs.mouthA ?? 0, strength * 0.88);
      morphs["がーん"] = smoothstep(clamp((strength - 0.4) / 0.42)) * 0.9;
      break;
    case "heart":
      morphs.smile = Math.max(morphs.smile ?? 0, strength * 0.72);
      morphs.happyEyes = strength * 0.82;
      morphs["はぁと"] = strength;
      break;
  }
  return expression;
};

export class MotionCore {
  private baselineRotation: QuaternionTuple = [0, 0, 0, 1];
  private baselineShapes: Record<string, number> = {};
  private calibrationStartMs = 0;
  private calibrationSamples: CalibrationSample[] = [];
  private readonly calibrationDurationMs = 2000;
  private surprised = false;
  private manualMorphs: Record<string, number> = {};
  private swapEyes = false;
  private sensitivity: MotionSensitivity = "responsive";
  private upperBodyEnabled = true;
  private mirrorUpperBody = false;
  private lastFaceSeenMs = 0;
  private lastPoseSeenMs = 0;
  private waveTrackers: Record<"Left" | "Right", WaveTracker> = {
    Left: { lastX: 0.5, direction: 0, reversals: 0, windowStartMs: 0, score: 0 },
    Right: { lastX: 0.5, direction: 0, reversals: 0, windowStartMs: 0, score: 0 }
  };
  private readonly handFilters = new Map<string, OneEuroFilter>();
  private handGestureLatch: Record<"left" | "right", { gesture: HandGesture; confidence: number }> = {
    left: { gesture: "neutral", confidence: 0 },
    right: { gesture: "neutral", confidence: 0 }
  };
  private baselineTorso: Euler = zeroEuler();
  private readonly filters = {
    pitch: new OneEuroFilter(1.2, 0.08),
    yaw: new OneEuroFilter(1.2, 0.08),
    roll: new OneEuroFilter(1.2, 0.08),
    gazeLX: new OneEuroFilter(1.8, 0.12),
    gazeLY: new OneEuroFilter(1.8, 0.12),
    gazeRX: new OneEuroFilter(1.8, 0.12),
    gazeRY: new OneEuroFilter(1.8, 0.12),
    blinkLeft: new OneEuroFilter(3.5, 0.35),
    blinkRight: new OneEuroFilter(3.5, 0.35),
    mouth: new OneEuroFilter(2.4, 0.22),
    smile: new OneEuroFilter(2.15, 0.2),
    browDown: new OneEuroFilter(2.05, 0.18),
    browInnerUp: new OneEuroFilter(2.05, 0.18),
    frown: new OneEuroFilter(2.05, 0.18),
    mouthPress: new OneEuroFilter(2.05, 0.18),
    eyeWide: new OneEuroFilter(2.2, 0.2),
    torsoPitch: new OneEuroFilter(1.35, 0.12),
    torsoYaw: new OneEuroFilter(1.35, 0.12),
    torsoRoll: new OneEuroFilter(1.35, 0.12),
    leftUpperX: new OneEuroFilter(1.8, 0.24),
    leftUpperY: new OneEuroFilter(1.8, 0.24),
    leftUpperZ: new OneEuroFilter(1.8, 0.24),
    leftLowerX: new OneEuroFilter(1.8, 0.24),
    leftLowerY: new OneEuroFilter(1.8, 0.24),
    leftLowerZ: new OneEuroFilter(1.8, 0.24),
    rightUpperX: new OneEuroFilter(1.8, 0.24),
    rightUpperY: new OneEuroFilter(1.8, 0.24),
    rightUpperZ: new OneEuroFilter(1.8, 0.24),
    rightLowerX: new OneEuroFilter(1.8, 0.24),
    rightLowerY: new OneEuroFilter(1.8, 0.24),
    rightLowerZ: new OneEuroFilter(1.8, 0.24)
  };

  beginCalibration(nowMs = performance.now()): void {
    this.calibrationStartMs = nowMs;
    this.calibrationSamples = [];
  }

  get calibrationProgress(): number {
    if (!this.calibrationStartMs) return 0;
    return clamp((performance.now() - this.calibrationStartMs) / this.calibrationDurationMs);
  }

  get isCalibrating(): boolean {
    return this.calibrationStartMs > 0;
  }

  setSwapEyes(value: boolean): void {
    this.swapEyes = value;
  }

  setSensitivity(value: MotionSensitivity): void {
    this.sensitivity = value;
    this.reset();
  }

  setUpperBodyEnabled(value: boolean): void {
    this.upperBodyEnabled = value;
    this.reset();
  }

  setMirrorUpperBody(value: boolean): void {
    if (this.mirrorUpperBody === value) return;
    this.mirrorUpperBody = value;
    this.reset();
  }

  setManualMorph(name: string, weight: number): void {
    if (weight <= 0) delete this.manualMorphs[name];
    else this.manualMorphs[name] = clamp(weight);
  }

  clearManualMorphs(): void {
    this.manualMorphs = {};
  }

  reset(): void {
    for (const filter of Object.values(this.filters)) filter.reset();
    this.surprised = false;
    this.lastFaceSeenMs = 0;
    this.lastPoseSeenMs = 0;
    this.waveTrackers = {
      Left: { lastX: 0.5, direction: 0, reversals: 0, windowStartMs: 0, score: 0 },
      Right: { lastX: 0.5, direction: 0, reversals: 0, windowStartMs: 0, score: 0 }
    };
    for (const filter of this.handFilters.values()) filter.reset();
    this.handGestureLatch = {
      left: { gesture: "neutral", confidence: 0 },
      right: { gesture: "neutral", confidence: 0 }
    };
  }

  process(frame: TrackingFrame, nowMs = performance.now()): AvatarFrame {
    const sourceAgeMs = Math.max(0, nowMs - frame.captureTimeMs);
    const face = frame.face;
    const detectedUpperBody = estimateUpperBody(frame.pose);
    const rawUpperBody = this.mirrorUpperBody ? mirrorUpperBody(detectedUpperBody) : detectedUpperBody;
    if (face.present) this.lastFaceSeenMs = nowMs;
    if (rawUpperBody.present) this.lastPoseSeenMs = nowMs;

    if (this.isCalibrating && face.present) {
      this.calibrationSamples.push({
        rotation: face.headRotation,
        blendshapes: face.blendshapes,
        torso: rawUpperBody.present ? rawUpperBody.torsoEuler : undefined
      });
      if (nowMs - this.calibrationStartMs >= this.calibrationDurationMs) this.finishCalibration();
    }

    const tuning = sensitivityProfiles[this.sensitivity];
    const relativeRotation = multiplyQuaternion(invertQuaternion(this.baselineRotation), face.headRotation);
    const rawEuler = quaternionToEuler(relativeRotation);
    const lostForMs = face.present ? 0 : nowMs - this.lastFaceSeenMs;
    const fade = face.present ? 1 : clamp(1 - (lostForMs - 100) / 400);
    const deadzone = (value: number, amount: number): number => Math.abs(value) < amount ? 0 : value;
    const pitch = this.filters.pitch.filter(clamp(deadzone(-rawEuler.pitch, tuning.deadzone) * tuning.headGain, -0.68, 0.68) * fade, nowMs);
    const yaw = this.filters.yaw.filter(clamp(deadzone(rawEuler.yaw, tuning.deadzone) * tuning.headGain, -0.82, 0.82) * fade, nowMs);
    const roll = this.filters.roll.filter(clamp(deadzone(-rawEuler.roll, tuning.deadzone * 1.15) * tuning.headGain, -0.5, 0.5) * fade, nowMs);

    const adjusted = (name: string, floor = 0.04): number =>
      remap((shape(face.blendshapes, name) - (this.baselineShapes[name] ?? 0)) * tuning.expressionGain, floor, 0.82);
    const adjustedPair = (left: string, right: string, floor = 0.04): number =>
      remap(
        (pair(face.blendshapes, left, right) - pair(this.baselineShapes, left, right)) * tuning.expressionGain,
        floor,
        0.82
      );

    let blinkLeft = smoothstep(this.filters.blinkLeft.filter(adjusted("eyeBlinkLeft", 0.02), nowMs));
    let blinkRight = smoothstep(this.filters.blinkRight.filter(adjusted("eyeBlinkRight", 0.02), nowMs));
    if (this.swapEyes) [blinkLeft, blinkRight] = [blinkRight, blinkLeft];

    const jaw = smoothstep(this.filters.mouth.filter(adjusted("jawOpen", 0.035), nowMs));
    const pucker = smoothstep(adjusted("mouthPucker", 0.08));
    const funnel = smoothstep(adjusted("mouthFunnel", 0.06));
    const stretch = smoothstep(adjustedPair("mouthStretchLeft", "mouthStretchRight", 0.045));
    const cheekSquint = smoothstep(adjustedPair("cheekSquintLeft", "cheekSquintRight", 0.035));
    const mouthDimple = smoothstep(adjustedPair("mouthDimpleLeft", "mouthDimpleRight", 0.035));
    const smileBase = smoothstep(this.filters.smile.filter(adjustedPair("mouthSmileLeft", "mouthSmileRight", 0.035), nowMs));
    const smile = clamp(smileBase * 0.82 + cheekSquint * 0.3 + mouthDimple * 0.18);
    const noseSneer = smoothstep(adjustedPair("noseSneerLeft", "noseSneerRight", 0.045));
    const browDownBase = smoothstep(this.filters.browDown.filter(adjustedPair("browDownLeft", "browDownRight", 0.045), nowMs));
    const browDown = clamp(browDownBase * 0.86 + noseSneer * 0.24);
    const browInnerUp = smoothstep(this.filters.browInnerUp.filter(adjusted("browInnerUp", 0.045), nowMs));
    const frown = smoothstep(this.filters.frown.filter(adjustedPair("mouthFrownLeft", "mouthFrownRight", 0.045), nowMs));
    const mouthPress = smoothstep(this.filters.mouthPress.filter(adjustedPair("mouthPressLeft", "mouthPressRight", 0.045), nowMs));
    const eyeWide = smoothstep(this.filters.eyeWide.filter(adjustedPair("eyeWideLeft", "eyeWideRight", 0.035), nowMs));
    const browOuterUp = smoothstep(adjustedPair("browOuterUpLeft", "browOuterUpRight", 0.045));
    const surpriseSignal = clamp(eyeWide * 0.48 + jaw * 0.34 + browOuterUp * 0.28);
    if (!this.surprised && surpriseSignal > 0.46) this.surprised = true;
    if (this.surprised && surpriseSignal < 0.27) this.surprised = false;

    const bothBlink = Math.min(blinkLeft, blinkRight);
    const morphs: Record<string, number> = {
      blinkBoth: bothBlink > 0.42 ? (blinkLeft + blinkRight) / 2 : 0,
      blinkLeft: bothBlink > 0.42 ? 0 : blinkLeft,
      blinkRight: bothBlink > 0.42 ? 0 : blinkRight,
      mouthA: jaw * (1 - Math.max(pucker, funnel) * 0.72),
      mouthU: pucker * (1 - jaw * 0.32),
      mouthO: funnel * jaw,
      mouthI: stretch * (1 - jaw),
      mouthE: stretch * jaw * 0.72,
      smile: smile * 0.82,
      browHappy: smile * 0.3,
      angry: browDown * (1 - Number(this.surprised)),
      sad: browInnerUp * frown,
      surprised: this.surprised ? surpriseSignal : 0
    };

    const hands = this.processHands(frame.hands, nowMs);
    const gazeAway = clamp((Math.abs(face.gaze.left[0] + face.gaze.right[0]) / 2 - 0.08) / 0.55);
    const expression = selectExpression(morphs, {
      smile,
      browDown,
      browInnerUp,
      frown,
      mouthPress,
      surprise: this.surprised ? surpriseSignal : 0,
      gazeAway
    }, hands);

    normalizeGroup(morphs, ["blinkBoth", "blinkLeft", "blinkRight", "surprised"]);
    normalizeGroup(morphs, ["mouthA", "mouthU", "mouthO", "mouthI", "mouthE", "smile"]);
    for (const key of Object.keys(morphs)) morphs[key] = clamp(morphs[key] * fade);
    // Event effects remain available even when tracking is intentionally stopped.
    Object.assign(morphs, this.manualMorphs);

    const gazeLeft = this.filterGaze([face.gaze.left[0] * tuning.gazeGain, face.gaze.left[1] * tuning.gazeGain], nowMs, "left");
    const gazeRight = this.filterGaze([face.gaze.right[0] * tuning.gazeGain, face.gaze.right[1] * tuning.gazeGain], nowMs, "right");
    const upperBody = this.processUpperBody(rawUpperBody, nowMs, tuning.headGain);
    const gestures = recognizeUpperBodyGestures(frame, upperBody, hands);
    this.appendWaveGestures(gestures, hands, frame, nowMs);
    const activeMorphs = Object.entries(morphs)
      .filter(([, weight]) => weight > 0.025)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, weight]) => ({ name, weight }));

    return {
      timestampMs: frame.producedTimeMs,
      sourceAgeMs,
      facePresent: face.present,
      confidence: face.confidence,
      headEuler: { pitch, yaw, roll },
      gaze: { left: gazeLeft, right: gazeRight },
      upperBody,
      hands,
      gestures: gestures.sort((a, b) => b.confidence - a.confidence).slice(0, 6),
      expression,
      morphs,
      activeMorphs
    };
  }

  private processHands(source: TrackingFrame["hands"], nowMs: number): HandsPose {
    const detected: HandsPose = { left: emptyHand(), right: emptyHand() };
    for (const tracked of source ?? []) {
      const pose = estimateHandPose(tracked);
      // The worker has already normalized MediaPipe's selfie-oriented label to
      // the person's anatomical hand. Mirroring the preview must only mirror
      // wrist orientation, not send the hand to the opposite PMX bone chain.
      const semanticSide = tracked.handedness;
      const finalPose = this.mirrorUpperBody ? mirrorHandPose(pose) : pose;
      const key = semanticSide === "Left" ? "left" : "right";
      if (!detected[key].present || finalPose.confidence > detected[key].confidence) detected[key] = this.filterHandPose(key, finalPose, nowMs);
    }
    return detected;
  }

  private filterHandPose(side: "left" | "right", hand: HandPose, nowMs: number): HandPose {
    const filter = (name: string, value: number): number => {
      const key = `${side}.${name}`;
      let instance = this.handFilters.get(key);
      if (!instance) {
        instance = new OneEuroFilter(2.15, 0.28);
        this.handFilters.set(key, instance);
      }
      return instance.filter(value, nowMs);
    };
    const fingerCurls = Object.fromEntries(
      (Object.entries(hand.fingerCurls) as Array<[keyof FingerCurls, number]>).map(([name, value]) => [name, clamp(filter(`curl.${name}`, value))])
    ) as FingerCurls;
    const current = this.handGestureLatch[side];
    if (hand.gesture === current.gesture) {
      current.confidence = current.confidence * 0.42 + hand.gestureConfidence * 0.58;
    } else if (hand.gesture !== "neutral" && (current.gesture === "neutral" || hand.gestureConfidence >= 0.58)) {
      current.gesture = hand.gesture;
      current.confidence = hand.gestureConfidence;
    } else {
      current.confidence *= 0.7;
      if (current.confidence < 0.36) current.gesture = "neutral";
    }
    return {
      ...hand,
      center: [filter("center.x", hand.center[0]), filter("center.y", hand.center[1]), filter("center.z", hand.center[2])],
      wristEuler: {
        pitch: filter("wrist.pitch", hand.wristEuler.pitch),
        yaw: filter("wrist.yaw", hand.wristEuler.yaw),
        roll: filter("wrist.roll", hand.wristEuler.roll)
      },
      fingerCurls,
      gesture: current.gesture,
      gestureConfidence: clamp(current.confidence)
    };
  }

  private appendWaveGestures(
    gestures: GestureActivation[],
    hands: HandsPose,
    frame: TrackingFrame,
    nowMs: number
  ): void {
    const pose = frame.pose?.landmarks;
    const shoulders = [normalizedPoint(pose, 11), normalizedPoint(pose, 12)].filter(Boolean) as Vector3Tuple[];
    const shoulderY = shoulders.length ? shoulders.reduce((sum, point) => sum + point[1], 0) / shoulders.length : 0.52;
    for (const [side, hand] of [["Left", hands.left], ["Right", hands.right]] as const) {
      const tracker = this.waveTrackers[side];
      const eligible = hand.present && hand.gesture === "open" && hand.center[1] < shoulderY + 0.04;
      if (!eligible) {
        tracker.score *= 0.72;
        tracker.direction = 0;
        tracker.reversals = 0;
        tracker.windowStartMs = nowMs;
        continue;
      }
      if (!tracker.windowStartMs || nowMs - tracker.windowStartMs > 1100) {
        tracker.windowStartMs = nowMs;
        tracker.reversals = 0;
      }
      const delta = hand.center[0] - tracker.lastX;
      const direction: -1 | 0 | 1 = Math.abs(delta) < 0.018 ? 0 : delta > 0 ? 1 : -1;
      if (direction && tracker.direction && direction !== tracker.direction) tracker.reversals += 1;
      if (direction) tracker.direction = direction;
      tracker.lastX = hand.center[0];
      tracker.score = Math.max(tracker.score * 0.86, clamp(tracker.reversals / 2));
      if (tracker.score >= 0.5) gestures.push({ name: side === "Left" ? "waveLeft" : "waveRight", confidence: tracker.score });
    }
  }

  private processUpperBody(raw: RawUpperBody, nowMs: number, gain: number): UpperBodyPose {
    const lostForMs = raw.present ? 0 : this.lastPoseSeenMs ? nowMs - this.lastPoseSeenMs : Number.POSITIVE_INFINITY;
    const fade = this.upperBodyEnabled ? (raw.present ? 1 : clamp(1 - (lostForMs - 120) / 520)) : 0;
    const torso = raw.torsoEuler;
    const torsoEuler = {
      pitch: this.filters.torsoPitch.filter(clamp((torso.pitch - this.baselineTorso.pitch) * gain, -0.35, 0.35) * fade, nowMs),
      yaw: this.filters.torsoYaw.filter(clamp((torso.yaw - this.baselineTorso.yaw) * gain, -0.52, 0.52) * fade, nowMs),
      roll: this.filters.torsoRoll.filter(clamp((torso.roll - this.baselineTorso.roll) * gain, -0.38, 0.38) * fade, nowMs)
    };
    const arm = (side: "left" | "right", value: RawArm, rest: Vector3Tuple) => {
      const upper = this.filterArmVector(side, "Upper", value.confidence >= 0.22 ? value.upper : rest, rest, fade, nowMs);
      const lower = this.filterArmVector(side, "Lower", value.lowerConfidence >= 0.22 ? value.lower : upper, rest, fade, nowMs);
      return {
        confidence: value.confidence * fade,
        lowerConfidence: value.lowerConfidence * fade,
        upper,
        lower
      };
    };
    return {
      present: this.upperBodyEnabled && (raw.present || fade > 0),
      confidence: raw.confidence * fade,
      torsoEuler,
      leftArm: arm("left", raw.leftArm, restLeft),
      rightArm: arm("right", raw.rightArm, restRight)
    };
  }

  private filterArmVector(
    side: "left" | "right",
    segment: "Upper" | "Lower",
    value: Vector3Tuple,
    rest: Vector3Tuple,
    fade: number,
    nowMs: number
  ): Vector3Tuple {
    const key = `${side}${segment}` as "leftUpper" | "leftLower" | "rightUpper" | "rightLower";
    const filtered: Vector3Tuple = [
      this.filters[`${key}X`].filter(value[0], nowMs),
      this.filters[`${key}Y`].filter(value[1], nowMs),
      this.filters[`${key}Z`].filter(value[2], nowMs)
    ];
    return normalizeVector([
      rest[0] + (filtered[0] - rest[0]) * fade,
      rest[1] + (filtered[1] - rest[1]) * fade,
      rest[2] + (filtered[2] - rest[2]) * fade
    ], rest);
  }

  private filterGaze(value: [number, number], timeMs: number, side: "left" | "right"): [number, number] {
    const xFilter = side === "left" ? this.filters.gazeLX : this.filters.gazeRX;
    const yFilter = side === "left" ? this.filters.gazeLY : this.filters.gazeRY;
    return [xFilter.filter(clamp(value[0], -1, 1), timeMs), yFilter.filter(clamp(value[1], -1, 1), timeMs)];
  }

  private finishCalibration(): void {
    if (this.calibrationSamples.length >= 3) {
      const components = [0, 1, 2, 3].map((index) =>
        median(this.calibrationSamples.map((sample) => sample.rotation[index]))
      ) as QuaternionTuple;
      this.baselineRotation = normalizeQuaternion(components);
      const keys = new Set(this.calibrationSamples.flatMap((sample) => Object.keys(sample.blendshapes)));
      this.baselineShapes = Object.fromEntries(
        [...keys].map((key) => [key, median(this.calibrationSamples.map((sample) => sample.blendshapes[key] ?? 0))])
      );
      const torsoSamples = this.calibrationSamples.map((sample) => sample.torso).filter(Boolean) as Euler[];
      if (torsoSamples.length >= 3) {
        this.baselineTorso = {
          pitch: median(torsoSamples.map((sample) => sample.pitch)),
          yaw: median(torsoSamples.map((sample) => sample.yaw)),
          roll: median(torsoSamples.map((sample) => sample.roll))
        };
      }
    }
    this.calibrationStartMs = 0;
    this.calibrationSamples = [];
    this.reset();
  }
}
