/**
 * 多市場グリッド生成・成熟度アンカー密度・実効パイのテスト（§1＋動的§2）。
 */
import { describe, it, expect } from "vitest";
import {
  generateMarkets, densityOf, marketSizeOf, marketEff, realize, maturityInit,
  activeSectors, marketId, nearCountOf,
} from "../src/core/markets";
import { DENS_MIN, DENS_MAX, REV_FLOOR, MATURITY_INIT_OVERRIDE } from "../src/core/model/constants";

describe("市場グリッド生成", () => {
  it("6セクター×5国＝30マスを生成し、同一seedで再現する", () => {
    const a = generateMarkets(42);
    const b = generateMarkets(42);
    expect(Object.keys(a).length).toBe(30);
    expect(a["S1:US"].biasFactor).toBe(b["S1:US"].biasFactor);
    expect(a["S1:US"].maturity).toBe(b["S1:US"].maturity);
    expect(a["S1:US"].nearRivals.length).toBe(b["S1:US"].nearRivals.length);
  });
  it("MarketStateに動的フィールド（maturity/entryAccrual/nearCountTarget）を持つ", () => {
    const m = generateMarkets(1)["S1:US"];
    expect(m.maturity).toBeGreaterThanOrEqual(0);
    expect(m.maturity).toBeLessThanOrEqual(1);
    expect(m.entryAccrual).toBe(0);
    expect(m.nearCountTarget).toBeGreaterThan(0);
  });
});

describe("初期成熟度（§2.3・§8）", () => {
  it("S1 Webは高成熟(≈0.6)・S6 福祉は低成熟(≈0.15)", () => {
    const m = generateMarkets(999);
    expect(m["S1:US"].maturity).toBeGreaterThan(m["S6:US"].maturity);
    // override中心の近傍（±15%ジッタ）に収まる
    expect(Math.abs(m["S1:US"].maturity - MATURITY_INIT_OVERRIDE.S1!)).toBeLessThan(0.15);
    expect(Math.abs(m["S6:US"].maturity - MATURITY_INIT_OVERRIDE.S6!)).toBeLessThan(0.1);
  });
  it("maturityInitは国×seedでばらつく", () => {
    const a = maturityInit(1, "S5", "US");
    const b = maturityInit(1, "S5", "JP");
    expect(a).not.toBe(b);
  });
});

describe("実効パイ M_eff（§2.1）", () => {
  it("realize：未成熟はREV_FLOOR、成熟で1.0", () => {
    expect(realize(0)).toBeCloseTo(REV_FLOOR);
    expect(realize(1)).toBeCloseTo(1.0);
    expect(realize(0.5)).toBeGreaterThan(REV_FLOOR);
  });
  it("M_eff = M_pot × realize。成熟が進むほど実効パイが増える", () => {
    const m = generateMarkets(1)["S1:US"];
    const base = { sector: m.sector, country: m.country, biasFactor: m.biasFactor };
    const mPot = marketSizeOf(base, "internet");
    const low = marketEff({ ...base, maturity: 0.1 }, "internet");
    const high = marketEff({ ...base, maturity: 0.8 }, "internet");
    expect(low).toBeCloseTo(mPot * realize(0.1));
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(mPot); // 満成熟でも潜在パイが上限
  });
  it("未解禁セクターは M_pot=0（S4はネット期不在）", () => {
    const m = generateMarkets(1)["S4:US"];
    expect(marketSizeOf({ sector: m.sector, country: m.country, biasFactor: m.biasFactor }, "internet")).toBe(0);
    expect(marketSizeOf({ sector: m.sector, country: m.country, biasFactor: m.biasFactor }, "ai")).toBeGreaterThan(0);
  });
});

describe("成熟度アンカー密度（§2.2）", () => {
  it("densityは[DENS_MIN,DENS_MAX]に収まる", () => {
    for (const mat of [0, 0.5, 1]) {
      for (const sec of ["S1", "S5", "S6"] as const) {
        const d = densityOf(mat, 123, sec, "US");
        expect(d).toBeGreaterThanOrEqual(DENS_MIN);
        expect(d).toBeLessThanOrEqual(DENS_MAX);
      }
    }
  });
  it("成熟が進むほど密度が上がる（混む方向）", () => {
    expect(densityOf(0.8, 77, "S1", "US")).toBeGreaterThan(densityOf(0.1, 77, "S1", "US"));
  });
  it("nearCount は密度でスケール（下限3・上限40）", () => {
    expect(nearCountOf(DENS_MIN)).toBeGreaterThanOrEqual(3);
    expect(nearCountOf(DENS_MAX)).toBeLessThanOrEqual(40);
    expect(nearCountOf(2.0)).toBeGreaterThan(nearCountOf(0.5));
  });
});

describe("活性セクター（§7.1解禁）", () => {
  it("黎明期はS5/S6のみ、AI期はS4を含む", () => {
    expect(activeSectors("dawn").sort()).toEqual(["S5", "S6"]);
    expect(activeSectors("ai")).toContain("S4");
    expect(activeSectors("internet")).not.toContain("S4");
    expect(marketId("S1", "US")).toBe("S1:US");
  });
});
