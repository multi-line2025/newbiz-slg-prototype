/**
 * 収支・ランウェイのテスト（市場成長モデル§2.1 / §6.3）。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { computeRevenue, computeMonthlyBurn, applyFinance, marketSizeFactor } from "../src/core/finance";
import { productRevenue } from "../src/core/market";

describe("finance", () => {
  it("売上 = 全製品の市場別売上を合算（多市場・§5-D）", () => {
    const s = initGame({ seed: 1, country: "US" });
    const expected = s.products.reduce((sum, p) => sum + productRevenue(p, s.markets[p.marketId], s.era), 0);
    expect(computeRevenue(s)).toBeCloseTo(expected);
    expect(computeRevenue(s)).toBeGreaterThan(0); // 創業製品の種火シェアで売上あり
  });

  it("市場規模係数は国で異なる（米国1.0 > 日本0.55 > 星国0.10）", () => {
    expect(marketSizeFactor("US")).toBe(1.0);
    expect(marketSizeFactor("JP")).toBe(0.55);
    expect(marketSizeFactor("SG")).toBe(0.1);
  });

  it("バーン = Σ給与 + 固定費 + マーケ/研究予算 で正の値", () => {
    const s = initGame({ seed: 1, country: "US", hireCount: 4 });
    expect(computeMonthlyBurn(s)).toBeGreaterThan(0);
  });

  it("applyFinance で CASH が 売上−支出 だけ変化し、ランウェイが再計算される", () => {
    const s = initGame({ seed: 1, country: "US" });
    const rev = computeRevenue(s);
    const burn = computeMonthlyBurn(s);
    const next = applyFinance(s);
    expect(next.company.CASH).toBeCloseTo(s.company.CASH + rev - burn);
    expect(next.company.runwayTurns).toBeCloseTo(next.company.CASH / next.company.monthlyBurn);
  });

  it("初期は赤字（売上 < バーン）なのでランウェイは有限", () => {
    const s = initGame({ seed: 1, country: "US" });
    const next = applyFinance(s);
    expect(next.company.runwayTurns).toBeLessThan(Infinity);
  });
});
