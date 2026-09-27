import { describe, expect, it } from "vitest";
import {
  invertQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  quaternionFromMatrix,
  quaternionToEuler
} from "../src/core/math";

describe("quaternion utilities", () => {
  it("converts an identity matrix to an identity quaternion", () => {
    const result = quaternionFromMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(0);
    expect(result[3]).toBeCloseTo(1);
  });

  it("removes the calibrated baseline rotation", () => {
    const pose = normalizeQuaternion([0.1, -0.2, 0.05, 0.96]);
    const relative = multiplyQuaternion(invertQuaternion(pose), pose);
    const euler = quaternionToEuler(relative);
    expect(euler.pitch).toBeCloseTo(0, 5);
    expect(euler.yaw).toBeCloseTo(0, 5);
    expect(euler.roll).toBeCloseTo(0, 5);
  });
});
