/**
 * 実効要求給与のテスト（仕様 §4.3 / §12.2 / 数値定義書 §2.1）。
 * 実効要求給与 = 基準給与 ×(1 − 忠誠オフセット)× 国別最低賃金係数
 */
import { describe, it, expect } from "vitest";
import { baseSalary, loyaltyOffset, effectiveSalary } from "../src/core/salary";

describe("baseSalary（§12.2 CA帯別）", () => {
  it("エンジニア：CA帯で駆け出し/中堅/エース", () => {
    expect(baseSalary("engineer", 80)).toBe(3000); // 駆け出し
    expect(baseSalary("engineer", 130)).toBe(6000); // 中堅
    expect(baseSalary("engineer", 170)).toBe(12000); // エース
  });
  it("境界：CA100は駆け出し、CA150は中堅", () => {
    expect(baseSalary("engineer", 100)).toBe(3000);
    expect(baseSalary("engineer", 150)).toBe(6000);
    expect(baseSalary("engineer", 151)).toBe(12000);
  });
});

describe("loyaltyOffset（§4.3）", () => {
  it("忠誠10で0（中立）、20で+0.15、1で負", () => {
    expect(loyaltyOffset(10)).toBeCloseTo(0);
    expect(loyaltyOffset(20)).toBeCloseTo(0.15);
    expect(loyaltyOffset(1)).toBeCloseTo(-0.135);
  });
});

describe("effectiveSalary（本式）", () => {
  it("US(1.0)・忠誠10・中堅エンジニア = 基準6000そのまま", () => {
    expect(effectiveSalary("engineer", 130, 10, "US")).toBe(6000);
  });
  it("忠誠が高いほど安く働く", () => {
    const loyal = effectiveSalary("engineer", 130, 20, "US"); // ×0.85
    const disloyal = effectiveSalary("engineer", 130, 1, "US"); // ×1.135
    expect(loyal).toBeLessThan(6000);
    expect(disloyal).toBeGreaterThan(6000);
    expect(loyal).toBe(Math.round(6000 * 0.85));
  });
  it("国別最低賃金係数が乗る（日本0.70 < 米国1.0）", () => {
    const us = effectiveSalary("engineer", 130, 10, "US");
    const jp = effectiveSalary("engineer", 130, 10, "JP");
    expect(jp).toBe(Math.round(us * 0.7));
  });
});
