import { describe, expect, it } from "vitest";
import { MotionCore, recognizeUpperBodyGestures } from "../src/core/MotionCore";
import type { HandPose, HandsPose, TrackedHand, TrackingFrame, UpperBodyPose } from "../src/core/contracts";

const emptyHand = (): HandPose => ({
  present: false,
  confidence: 0,
  center: [0.5, 0.5, 0],
  wristEuler: { pitch: 0, yaw: 0, roll: 0 },
  fingerCurls: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  gesture: "neutral",
  gestureConfidence: 0
});
const emptyHands = (): HandsPose => ({ left: emptyHand(), right: emptyHand() });
const body = (pitch = 0, roll = 0): UpperBodyPose => ({
  present: true,
  confidence: 1,
  torsoEuler: { pitch, yaw: 0, roll },
  leftArm: { confidence: 1, lowerConfidence: 1, upper: [1, 0, 0], lower: [1, 0, 0] },
  rightArm: { confidence: 1, lowerConfidence: 1, upper: [-1, 0, 0], lower: [-1, 0, 0] }
});

const trackedFrame = (): TrackingFrame => {
  const pose = new Float32Array(33 * 4);
  const face = new Float32Array(478 * 3);
  const setPose = (index: number, x: number, y: number) => {
    pose[index * 4] = x;
    pose[index * 4 + 1] = y;
    pose[index * 4 + 3] = 1;
  };
  setPose(7, 0.4, 0.44); setPose(8, 0.6, 0.44);
  setPose(11, 0.4, 0.5); setPose(12, 0.6, 0.5);
  setPose(13, 0.28, 0.64); setPose(14, 0.72, 0.64);
  setPose(15, 0.25, 0.72); setPose(16, 0.75, 0.72);
  const setFace = (index: number, x: number, y: number) => {
    face[index * 3] = x;
    face[index * 3 + 1] = y;
  };
  setFace(10, 0.5, 0.3); setFace(13, 0.5, 0.46); setFace(234, 0.42, 0.43); setFace(454, 0.58, 0.43);
  return {
    schemaVersion: 1,
    source: "replay",
    captureTimeMs: 1000,
    producedTimeMs: 1010,
    inferenceTimeMs: 10,
    face: { present: true, confidence: 1, headRotation: [0, 0, 0, 1], gaze: { left: [0, 0], right: [0, 0] }, blendshapes: {}, landmarks: face },
    pose: { present: true, confidence: 1, landmarks: pose, worldLandmarks: pose.slice() }
  };
};

const names = (frame: TrackingFrame, upperBody = body(), hands = emptyHands()) =>
  recognizeUpperBodyGestures(frame, upperBody, hands).map((gesture) => gesture.name);

describe("upper-body gesture recognition", () => {
  it("recognizes hands raised and crossed arms", () => {
    const raised = trackedFrame();
    raised.pose!.landmarks![15 * 4 + 1] = 0.28;
    raised.pose!.landmarks![16 * 4 + 1] = 0.28;
    expect(names(raised)).toContain("handsUp");

    const crossed = trackedFrame();
    crossed.pose!.landmarks![13 * 4] = 0.45;
    crossed.pose!.landmarks![14 * 4] = 0.55;
    crossed.pose!.landmarks![15 * 4] = 0.55;
    crossed.pose!.landmarks![15 * 4 + 1] = 0.64;
    crossed.pose!.landmarks![16 * 4] = 0.45;
    crossed.pose!.landmarks![16 * 4 + 1] = 0.64;
    expect(names(crossed)).toContain("armsCrossed");
  });

  it("recognizes pointing, face-contact gestures and shrugging", () => {
    const frame = trackedFrame();
    const pointing = emptyHands();
    pointing.left = { ...emptyHand(), present: true, confidence: 1, center: [0.3, 0.4, 0], gesture: "pointing", gestureConfidence: 0.9 };
    expect(names(frame, body(), pointing)).toContain("pointLeft");

    const contact = emptyHands();
    contact.right = { ...emptyHand(), present: true, confidence: 1, center: [0.5, 0.46, 0] };
    expect(names(frame, body(), contact)).toContain("coverMouth");
    contact.right.center = [0.42, 0.43, 0];
    expect(names(frame, body(), contact)).toContain("handOnCheek");
    contact.right.center = [0.5, 0.3, 0];
    expect(names(frame, body(), contact)).toContain("touchHead");
    expect(names(frame)).toContain("shrug");
  });

  it("recognizes all four torso lean directions", () => {
    const frame = trackedFrame();
    expect(names(frame, body(-0.25, 0))).toContain("leanForward");
    expect(names(frame, body(0.25, 0))).toContain("leanBackward");
    expect(names(frame, body(0, -0.25))).toContain("leanLeft");
    expect(names(frame, body(0, 0.25))).toContain("leanRight");
  });

  it("recognizes a raised open hand changing horizontal direction as a wave", () => {
    const makeHand = (x: number): TrackedHand => {
      const points = new Float32Array(21 * 4);
      const set = (index: number, px: number, py: number) => {
        points[index * 4] = px + x;
        points[index * 4 + 1] = py - 0.42;
        points[index * 4 + 3] = 1;
      };
      set(0, 0, 0.82);
      set(1, -0.08, 0.72); set(2, -0.14, 0.64); set(3, -0.2, 0.56); set(4, -0.27, 0.48);
      for (const [start, offset] of [[5, -0.07], [9, 0], [13, 0.07], [17, 0.14]] as const) {
        set(start, offset, 0.67); set(start + 1, offset, 0.55); set(start + 2, offset, 0.43); set(start + 3, offset, 0.3);
      }
      return { handedness: "Left", confidence: 0.96, landmarks: points };
    };
    const core = new MotionCore();
    const positions = [0.42, 0.56, 0.4, 0.57];
    let output = core.process({ ...trackedFrame(), hands: [makeHand(positions[0])] }, 1000);
    for (let index = 1; index < positions.length; index += 1) {
      output = core.process({ ...trackedFrame(), hands: [makeHand(positions[index])] }, 1000 + index * 140);
    }
    expect(output.gestures.map((gesture) => gesture.name)).toContain("waveLeft");
  });
});
