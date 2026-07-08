/**
 * buildPerson / 人材プール生成のテスト（仕様 §4.10.2 / §4.10）。
 * - CA <= PA が常に保たれる
 * - 生成時CAは若年ほど原石（CA/PA比が低い）
 * - PA希少性分布：一般帯が多数を占める
 * - 評判ゲート：無名企業には超一流(PA>130)がほぼ来ない
 */
import { describe, it, expect } from "vitest";
import { makePRNG } from "../src/core/prng";
import { buildPerson, maturity } from "../src/core/person";
import { generateTalentPool, reachablePaMax } from "../src/core/talentPool";

describe("buildPerson", () => {
  it("生成した人材は常に CA <= PA", () => {
    const rng = makePRNG(42);
    for (let i = 0; i < 200; i++) {
      const PA = rng.int(80, 200);
      const age = rng.int(20, 55);
      const p = buildPerson({ PA, age, nationality: "US", era: "internet" }, rng);
      expect(p.CA).toBeLessThanOrEqual(p.PA);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it("若年ほど CA/PA 比が低い（原石）", () => {
    // maturity カーブ自体が単調増加であることを確認
    expect(maturity(22)).toBeLessThan(maturity(40));
    expect(maturity(45)).toBeGreaterThanOrEqual(maturity(40));
  });

  it("同一seedなら同じ人材が再現される（決定論）", () => {
    const a = buildPerson({ PA: 150, age: 30, nationality: "JP", era: "ai" }, makePRNG(7));
    const b = buildPerson({ PA: 150, age: 30, nationality: "JP", era: "ai" }, makePRNG(7));
    expect(a.CA).toBe(b.CA);
    expect(a.name).toBe(b.name);
  });
});

describe("generateTalentPool", () => {
  it("PA希少性分布：未熟練〜優秀帯（PA<150）が大多数を占める（v0.10・単一DB）", () => {
    const rng = makePRNG(123);
    const pool = generateTalentPool({ poolSize: 2000, era: "internet" }, rng);
    const common = pool.filter((p) => p.PA < 150).length;
    expect(common / pool.length).toBeGreaterThan(0.85); // 未熟練+一般+優秀で9割超
  });

  it("単一ワールドDBは全ティアを含む（生成時は評判で除外しない・高PAも稀に存在）", () => {
    const rng = makePRNG(999);
    const pool = generateTalentPool({ poolSize: 1000, era: "internet" }, rng);
    // v0.10：評判ゲートは生成除外ではなく“採用可否”へ移行。DB自体には全ティアが居る。
    expect(pool.filter((p) => p.PA < 80).length).toBeGreaterThan(0);   // 未熟練が居る
    expect(pool.filter((p) => p.PA >= 150).length).toBeGreaterThan(0); // 一流以上も稀に居る
    expect(pool.length).toBe(1000); // 除外せず全員生成
  });

  it("reachablePaMax：評判が高いほど到達上限が上がる", () => {
    expect(reachablePaMax(10)).toBe(120); // 無名（v0.8ゲート改定）
    expect(reachablePaMax(35)).toBe(140); // 中堅
    expect(reachablePaMax(65)).toBe(165); // 有名
    expect(reachablePaMax(90)).toBe(200); // 伝説
  });
});
