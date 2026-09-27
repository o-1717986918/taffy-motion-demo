import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "../src/core/OneEuroFilter";

describe("OneEuroFilter", () => {
  it("is deterministic and smooths a step input", () => {
    const filterA = new OneEuroFilter(1, 0.08);
    const filterB = new OneEuroFilter(1, 0.08);
    const samples = [0, 0, 0, 1, 1, 1];
    const resultA = samples.map((value, index) => filterA.filter(value, index * 33));
    const resultB = samples.map((value, index) => filterB.filter(value, index * 33));
    expect(resultA).toEqual(resultB);
    expect(resultA[3]).toBeGreaterThan(0);
    expect(resultA[3]).toBeLessThan(1);
    expect(resultA[5]).toBeGreaterThan(resultA[3]);
  });
});
