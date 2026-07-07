/**
 * 成長・減衰のテスト（仕様 §4.7 / 数値定義書 §1）。
 * 特に「減衰regimeでは伸びしろ係数を1.0固定」という §1.7 の実装注記を検証する。
 */
import { describe, it, expect } from "vitest";
import { growthDelta, envFromMorale, applyGrowth } from "../src/core/growth";
import type { Person, Attributes } from "../src/core/model/types";

function makeAttrs(v: number): Attributes {
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
      integrity: 10, professionalism: 12, adaptability: 10, consistency: 10,
      loyalty: 10, temperament: 10, controversy: 5, durability: 10,
    },
  };
}

/** テスト用の人材を作る。attrAvg=可視能力値の一律値、CA/PAを明示。 */
function makePerson(age: number, attrAvg: number, CA: number, PA: number): Person {
  return {
    id: "t1", name: "Test Person", sex: "male", bloodlineId: null,
    age, retirementAge: 65, lifeExpectancy: 80, fertility: 0,
    nationality: "US", residence: "US", cluster: "NA",
    jobCategory: "engineer", assignedRole: null,
    CA, PA, attributes: makeAttrs(attrAvg),
    salaryDemand: 5000, morale: 60, reputation: 0, scoutLevel: 0,
    languages: ["US"], contract: null, traits: [],
    relationToPC: "none", isSuccessorCandidate: false,
  };
}

const env = envFromMorale(60);

describe("growthDelta（成長Δ）", () => {
  it("若手（25歳）で伸びしろが大きいとき、専門技能は正の成長", () => {
    const p = makePerson(25, 9, 90, 180); // CA90 << PA180 → headroom大
    const d = growthDelta(p, "occupational", env, 1.0);
    expect(d).toBeGreaterThan(0);
  });

  it("若手でもCAがPAに近いと成長はほぼ止まる（非減衰regimeは伸びしろ依存）", () => {
    const nearCap = makePerson(25, 18, 178, 180); // headroom≈0
    const roomy = makePerson(25, 9, 90, 180); // headroom大
    const dNear = growthDelta(nearCap, "occupational", env, 1.0);
    const dRoomy = growthDelta(roomy, "occupational", env, 1.0);
    expect(dNear).toBeLessThan(dRoomy);
    expect(dNear).toBeLessThan(0.02); // ほぼ頭打ち
  });

  it("★減衰regime：60歳の専門技能はCAがPAに近くても衰える（§1.7）", () => {
    // 年齢係数が負。伸びしろ係数を1.0固定しないと (PA-CA)/PA≒0 で衰えが消える。
    const veteran = makePerson(60, 18, 178, 180);
    const d = growthDelta(veteran, "occupational", env, 1.0);
    expect(d).toBeLessThan(0); // ちゃんと下降する
  });

  it("★減衰regime：コンディションは50歳で衰える", () => {
    const p = makePerson(50, 15, 150, 180);
    const d = growthDelta(p, "condition", env, 1.0);
    expect(d).toBeLessThan(0);
  });

  it("メンタルは終始プラス（減衰しない）", () => {
    const p = makePerson(55, 12, 120, 180);
    const d = growthDelta(p, "mental", env, 1.0);
    expect(d).toBeGreaterThan(0);
  });
});

describe("applyGrowth（1ターン適用）", () => {
  it("成長後もCA<=PAが保たれる", () => {
    const p = makePerson(30, 17, 170, 175);
    const next = applyGrowth(p, env);
    expect(next.CA).toBeLessThanOrEqual(next.PA);
  });

  it("ベテランは1ターンでCAが下降しうる（衰え）", () => {
    const veteran = makePerson(62, 18, 180, 180);
    const next = applyGrowth(veteran, env);
    expect(next.CA).toBeLessThanOrEqual(veteran.CA);
  });
});
