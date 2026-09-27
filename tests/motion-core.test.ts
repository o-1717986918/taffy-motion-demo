import { describe, expect, it } from "vitest";
import { MotionCore } from "../src/core/MotionCore";
import type { TrackingFrame } from "../src/core/contracts";

const frame = (blendshapes: Record<string, number>): TrackingFrame => ({
  schemaVersion: 1,
  source: "replay",
  captureTimeMs: 1000,
  producedTimeMs: 1010,
  inferenceTimeMs: 10,
  face: {
    present: true,
    confidence: 1,
    headRotation: [0, 0, 0, 1],
    gaze: { left: [0, 0], right: [0, 0] },
    blendshapes
  }
});

const poseFrame = (): TrackingFrame => {
  const world = new Float32Array(33 * 4);
  const normalized = new Float32Array(33 * 4);
  const set = (index: number, x: number, y: number, z = 0) => {
    for (const values of [world, normalized]) {
      values[index * 4] = x;
      values[index * 4 + 1] = y;
      values[index * 4 + 2] = z;
      values[index * 4 + 3] = 1;
    }
  };
  set(11, 0.3, -0.5);
  set(12, -0.3, -0.5);
  set(13, 0.3, -0.9);
  set(14, -0.7, -0.5);
  set(15, 0.3, -1.25);
  set(16, -1, -0.5);
  set(23, 0.2, 0);
  set(24, -0.2, 0);
  return {
    ...frame({}),
    pose: { present: true, confidence: 1, landmarks: normalized, worldLandmarks: world }
  };
};

const chestUpPoseFrame = (): TrackingFrame => {
  const result = poseFrame();
  for (const values of [result.pose!.landmarks!, result.pose!.worldLandmarks!]) {
    values[23 * 4 + 3] = 0;
    values[24 * 4 + 3] = 0;
  }
  return result;
};

describe("MotionCore expression arbitration", () => {
  it("uses the shared blink morph when both eyes close", () => {
    const core = new MotionCore();
    const result = core.process(frame({ eyeBlinkLeft: 0.95, eyeBlinkRight: 0.9 }), 1015);
    expect(result.morphs.blinkBoth).toBeGreaterThan(0.7);
    expect(result.morphs.blinkLeft).toBe(0);
    expect(result.morphs.blinkRight).toBe(0);
  });

  it("keeps mutually exclusive mouth weights normalized", () => {
    const core = new MotionCore();
    const result = core.process(frame({
      jawOpen: 0.95,
      mouthPucker: 0.9,
      mouthFunnel: 0.9,
      mouthStretchLeft: 0.8,
      mouthStretchRight: 0.8,
      mouthSmileLeft: 0.8,
      mouthSmileRight: 0.8
    }), 1015);
    const sum = ["mouthA", "mouthU", "mouthO", "mouthI", "mouthE", "smile"]
      .reduce((total, name) => total + result.morphs[name], 0);
    expect(sum).toBeLessThanOrEqual(1.000001);
  });

  it("allows a manual anime effect to override continuous signals", () => {
    const core = new MotionCore();
    core.setManualMorph("星目", 1);
    const result = core.process(frame({}), 1015);
    expect(result.morphs["星目"]).toBe(1);
  });

  it("maps visible shoulder, elbow and wrist points to stable upper-body directions", () => {
    const core = new MotionCore();
    const result = core.process(poseFrame(), 1015);
    expect(result.upperBody.present).toBe(true);
    expect(result.upperBody.confidence).toBe(1);
    expect(result.upperBody.leftArm.upper[1]).toBeGreaterThan(0.95);
    expect(result.upperBody.rightArm.upper[0]).toBeLessThan(-0.95);
    expect(Math.abs(result.upperBody.torsoEuler.roll)).toBeLessThan(0.001);
  });

  it("returns the arms to the neutral pose when upper-body tracking is disabled", () => {
    const core = new MotionCore();
    core.setUpperBodyEnabled(false);
    const result = core.process(poseFrame(), 1015);
    expect(result.upperBody.present).toBe(false);
    expect(result.upperBody.leftArm.upper).toEqual([1, 0, 0]);
    expect(result.upperBody.rightArm.upper).toEqual([-1, 0, 0]);
  });

  it("keeps shoulder and arm tracking active when a chest-up shot crops both hips", () => {
    const core = new MotionCore();
    const result = core.process(chestUpPoseFrame(), 1015);
    expect(result.upperBody.present).toBe(true);
    expect(result.upperBody.leftArm.upper[1]).toBeGreaterThan(0.95);
    expect(result.upperBody.torsoEuler.pitch).toBe(0);
  });

  it("mirrors upper-body sides to match the mirrored camera preview", () => {
    const core = new MotionCore();
    core.setMirrorUpperBody(true);
    const result = core.process(poseFrame(), 1015);
    expect(result.upperBody.leftArm.upper[0]).toBeGreaterThan(0.95);
    expect(result.upperBody.rightArm.upper[1]).toBeGreaterThan(0.95);
  });

  it("keeps normalized hand handedness when the camera preview is mirrored", () => {
    const core = new MotionCore();
    core.setMirrorUpperBody(true);
    const landmarks = new Float32Array(21 * 4);
    for (let index = 0; index < 21; index += 1) landmarks[index * 4 + 3] = 1;
    const result = core.process({
      ...frame({}),
      hands: [{ handedness: "Right", confidence: 0.95, landmarks }]
    }, 1015);
    expect(result.hands.right.present).toBe(true);
    expect(result.hands.left.present).toBe(false);
  });

  it("recognizes both hands raised from upper-body landmarks", () => {
    const core = new MotionCore();
    const raised = poseFrame();
    raised.pose!.landmarks![16 * 4 + 1] = -1.25;
    raised.pose!.worldLandmarks![16 * 4 + 1] = -1.25;
    const result = core.process(raised, 1015);
    expect(result.gestures.some((gesture) => gesture.name === "handsUp")).toBe(true);
  });
});
