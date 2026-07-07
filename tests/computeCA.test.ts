/**
 * computeCA のテスト（仕様 §4.5）。
 * 可視能力値21項目の平均×10。人格はCAに計上しない。
 */
import { describe, it, expect } from "vitest";
import { computeCA } from "../src/core/person";
import type { Attributes } from "../src/core/model/types";

/** 全可視能力値を v、人格を h に揃えた Attributes を作る。 */
function makeAttrs(v: number, h: number): Attributes {
  return {
    occupational: {
      engineering: v, design: v, marketing: v, sales: v, finance: v, research: v, management: v,
    },
    mental: {
      composure: v, decisions: v, determination: v, concentration: v, anticipation: v,
      creativity: v, vision: v, leadership: v, teamwork: v, ambition: v, bravery: v,
    },
    condition: { stamina: v, stressResist: v, health: v },
    hidden: {
      integrity: h, professionalism: h, adaptability: h, consistency: h,
      loyalty: h, temperament: h, controversy: h, durability: h,
    },
  };
}

describe("computeCA", () => {
  it("全可視能力値10 → CA100", () => {
    expect(computeCA(makeAttrs(10, 1))).toBe(100);
  });

  it("全可視能力値20 → CA200（上限）", () => {
    expect(computeCA(makeAttrs(20, 20))).toBe(200);
  });

  it("人格（隠し）はCAに影響しない", () => {
    const low = computeCA(makeAttrs(12, 1));
    const high = computeCA(makeAttrs(12, 20));
    expect(low).toBe(high); // 隠し値が違ってもCAは同じ
    expect(low).toBe(120);
  });

  it("CAは0-200にクランプされる", () => {
    expect(computeCA(makeAttrs(1, 1))).toBe(10);
  });
});
