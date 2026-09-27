import { describe, expect, it } from "vitest";
import { classifyHandGesture, estimateFingerCurls, estimateHandPose, selectExpression } from "../src/core/MotionCore";
import type { FingerCurls, HandsPose, TrackedHand } from "../src/core/contracts";

const hand = (pinched = false): TrackedHand => {
  const landmarks = new Float32Array(21 * 4);
  const set = (index: number, x: number, y: number, z = 0) => {
    landmarks[index * 4] = x;
    landmarks[index * 4 + 1] = y;
    landmarks[index * 4 + 2] = z;
    landmarks[index * 4 + 3] = 1;
  };
  set(0, 0.5, 0.82);
  set(1, 0.42, 0.72); set(2, 0.36, 0.64); set(3, 0.3, 0.56); set(4, pinched ? 0.43 : 0.23, pinched ? 0.34 : 0.48);
  for (const [start, x] of [[5, 0.43], [9, 0.5], [13, 0.57], [17, 0.64]] as const) {
    set(start, x, 0.67);
    set(start + 1, x, 0.55);
    set(start + 2, x, 0.43);
    set(start + 3, x, start === 5 && pinched ? 0.34 : 0.3);
  }
  if (pinched) set(8, 0.43, 0.34);
  return { handedness: "Left", confidence: 0.96, landmarks };
};

const curls = (values: Partial<FingerCurls>): FingerCurls => ({
  thumb: 0,
  index: 0,
  middle: 0,
  ring: 0,
  pinky: 0,
  ...values
});

describe("MediaPipe Hand Landmarker geometry", () => {
  it("keeps all five fingers extended for a straight open hand", () => {
    const result = estimateFingerCurls(hand());
    expect(Math.max(...Object.values(result))).toBeLessThan(0.12);
    expect(estimateHandPose(hand()).present).toBe(true);
  });

  it.each([
    ["open", false, curls({})],
    ["fist", false, curls({ thumb: 0.7, index: 1, middle: 1, ring: 1, pinky: 1 })],
    ["peace", false, curls({ thumb: 0.5, ring: 1, pinky: 1 })],
    ["pointing", false, curls({ middle: 1, ring: 1, pinky: 1 })],
    ["ok", true, curls({ thumb: 0.5, index: 0.5 })],
    ["fingerHeart", true, curls({ thumb: 0.5, index: 0.5, middle: 1, ring: 1, pinky: 1 })]
  ] as const)("recognizes %s", (expected, pinched, fingerCurls) => {
    expect(classifyHandGesture(hand(pinched), fingerCurls).gesture).toBe(expected);
  });
});

describe("automatic expression combinations", () => {
  const empty = estimateHandPose({ ...hand(), confidence: 0 });
  empty.present = false;
  const hands: HandsPose = { left: empty, right: { ...empty, fingerCurls: { ...empty.fingerCurls } } };
  const signals = { smile: 0, browDown: 0, browInnerUp: 0, frown: 0, mouthPress: 0, surprise: 0, gazeAway: 0 };

  it("accepts a subtle smile without promoting neutral noise", () => {
    const subtle: Record<string, number> = {};
    expect(selectExpression(subtle, { ...signals, smile: 0.34 }, hands).name).toBe("happy");
    expect(subtle.smile).toBeGreaterThan(0.25);

    const neutral: Record<string, number> = {};
    expect(selectExpression(neutral, { ...signals, smile: 0.24 }, hands).name).toBe("neutral");
  });

  it("combines smile, happy eyes and brows for happy", () => {
    const morphs: Record<string, number> = {};
    const result = selectExpression(morphs, { ...signals, smile: 0.9 }, hands);
    expect(result.name).toBe("happy");
    expect(morphs.smile).toBeGreaterThan(0.7);
    expect(morphs.happyEyes).toBeGreaterThan(0.6);
    expect(morphs.browHappy).toBeGreaterThan(0.4);
  });

  it("combines sad brow, closed mouth and tears for wronged", () => {
    const morphs: Record<string, number> = {};
    const result = selectExpression(morphs, { ...signals, browInnerUp: 0.95, frown: 0.9 }, hands);
    expect(result.name).toBe("wronged");
    expect(morphs.sad).toBeGreaterThan(0.7);
    expect(morphs.mouthClosed).toBeGreaterThan(0.6);
    expect(morphs["涙"]).toBeGreaterThan(0.4);
  });

  it("maps a finger heart to smile, happy eyes and heart effect", () => {
    const morphs: Record<string, number> = {};
    const heartHands: HandsPose = {
      ...hands,
      left: { ...hands.left, present: true, gesture: "fingerHeart", gestureConfidence: 0.94 }
    };
    const result = selectExpression(morphs, signals, heartHands);
    expect(result.name).toBe("heart");
    expect(morphs["はぁと"]).toBeCloseTo(0.94);
    expect(morphs.happyEyes).toBeGreaterThan(0.7);
  });

  it("maps shy, angry and shocked signals to their authored combinations", () => {
    const shyMorphs: Record<string, number> = {};
    expect(selectExpression(shyMorphs, { ...signals, smile: 0.55, gazeAway: 0.95 }, hands).name).toBe("shy");
    expect(shyMorphs["照れ"]).toBeGreaterThan(0.6);

    const angryMorphs: Record<string, number> = {};
    expect(selectExpression(angryMorphs, { ...signals, browDown: 0.95, mouthPress: 0.8 }, hands).name).toBe("angry");
    expect(angryMorphs.mouthClosed).toBeGreaterThan(0.6);

    const shockedMorphs: Record<string, number> = {};
    expect(selectExpression(shockedMorphs, { ...signals, surprise: 0.92 }, hands).name).toBe("shocked");
    expect(shockedMorphs["がーん"]).toBeGreaterThan(0.6);
  });
});
