import type { QuaternionTuple } from "./contracts";

export const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export const remap = (value: number, min: number, max: number): number =>
  clamp((value - min) / Math.max(0.0001, max - min));

export const smoothstep = (value: number): number => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const normalizeQuaternion = (q: QuaternionTuple): QuaternionTuple => {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
};

export const invertQuaternion = (q: QuaternionTuple): QuaternionTuple => {
  const normalized = normalizeQuaternion(q);
  return [-normalized[0], -normalized[1], -normalized[2], normalized[3]];
};

export const multiplyQuaternion = (a: QuaternionTuple, b: QuaternionTuple): QuaternionTuple =>
  normalizeQuaternion([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ]);

export const quaternionToEuler = (q: QuaternionTuple): { pitch: number; yaw: number; roll: number } => {
  const [x, y, z, w] = normalizeQuaternion(q);
  const pitch = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const yaw = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { pitch, yaw, roll };
};

export const quaternionFromMatrix = (matrix: ArrayLike<number>): QuaternionTuple => {
  if (matrix.length < 16) return [0, 0, 0, 1];
  const m00 = matrix[0];
  const m01 = matrix[4];
  const m02 = matrix[8];
  const m10 = matrix[1];
  const m11 = matrix[5];
  const m12 = matrix[9];
  const m20 = matrix[2];
  const m21 = matrix[6];
  const m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return normalizeQuaternion([x, y, z, w]);
};
