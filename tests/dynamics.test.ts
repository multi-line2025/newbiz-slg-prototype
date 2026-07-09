/**
 * 市場成熟・成長・参入ダイナミクスのテスト（§2〜§4）。
 */
import { describe, it, expect } from "vitest";
import { qualGate, totalHit, stepMaturity, stepDynamics, hotness, staleEff, attractivenessMult } from "../src/core/dynamics";
import { generateMarkets } from "../src/core/markets";
import { STALE_TURNS, STALE_MIN, QUAL_HIT_MIN } from "../src/core/model/constants";
import type { Product, MarketState, ProtoCompany } from "../src/core/state";

function makeCompany(over: Partial<ProtoCompany> = {}): ProtoCompany {
  return {
    name: "T", foundedCountry: "US", CASH: 100000, reputation: 50,
    monthlyBurn: 0, runwayTurns: 0, RP_C: 0, researchBudget: 0,
    unlockedBlueprints: [], missionTags: [], THxP_customer: 0, capTable: { totalShares: 1000000, pcShares: 1000000, holders: [] }, ...over,
  };
}
function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: "p1", blueprintId: "BP-620", sector: "S5", country: "US", marketId: "S5:US",
    devTurns: 6, QUAL_p: 80, qualFloor: 0, sticky: 45, paid: 0, stickySales: 0,
    adBudget: 0, prBudget: 0, commBudget: 0, ...over,
  };
}
function lowMaturityMarket(): MarketState {
  const m = generateMarkets(5)["S6:US"]; // 福祉＝低成熟
  return { ...m, maturity: 0.1, nearRivals: [] };
}

describe("qualGate（§3.1）", () => {
  it("QUAL_p<QUAL_HIT_MINは市場を育てない、85で満ヒット", () => {
    expect(qualGate(QUAL_HIT_MIN - 1)).toBe(0);
    expect(qualGate(85)).toBeCloseTo(1);
    expect(qualGate((QUAL_HIT_MIN + 85) / 2)).toBeCloseTo(0.5); // 中点で0.5
  });
});

describe("ヒット駆動の成長（§3）", () => {
  it("高シェア×高QUAL_pは未成熟市場を育てる（maturity↑）", () => {
    const m = lowMaturityMarket();
    const r = stepMaturity(m, makeProduct({ sticky: 45, QUAL_p: 80 }));
    expect(r.maturity).toBeGreaterThan(m.maturity);
    expect(r.delta).toBeGreaterThan(0);
  });
  it("低品質(QUAL_p<50)は育てない・放置は緩やか冷却", () => {
    const m = lowMaturityMarket();
    const lowQual = stepMaturity(m, makeProduct({ QUAL_p: 40 }));
    expect(lowQual.delta).toBeLessThanOrEqual(0); // qualGate0＝ヒットなし→regressで微減
    const empty = stepMaturity({ ...m, maturity: 0.5 }, null);
    expect(empty.delta).toBeLessThan(0); // 誰も育てない→冷める
  });
  it("未成熟ほど速く伸びる（headroom）", () => {
    const p = makeProduct({ sticky: 45, QUAL_p: 80 });
    const young = stepMaturity({ ...lowMaturityMarket(), maturity: 0.1 }, p);
    const old = stepMaturity({ ...lowMaturityMarket(), maturity: 0.9 }, p);
    expect(young.delta).toBeGreaterThan(old.delta);
  });
});

describe("参入ダイナミクス（§4）", () => {
  it("成長・実効パイ・自社成功で魅力度が上がる", () => {
    const base = attractivenessMult(0, 0, 0);
    expect(attractivenessMult(0.04, 0, 0)).toBeGreaterThan(base);
    expect(attractivenessMult(0, 200, 0)).toBeGreaterThan(base);
    expect(attractivenessMult(0, 0, 0.5)).toBeGreaterThan(base);
  });
  it("空き市場で成功すると近接ライバルが流入していく（先行者利益は一時的）", () => {
    let m: MarketState = { ...lowMaturityMarket(), nearRivals: [], maturity: 0.15, nearCountTarget: 12 };
    const p = makeProduct({ sticky: 45, QUAL_p: 82 });
    const company = makeCompany({ reputation: 80 });
    // 育てながら参入圧を蓄積
    let grew = false, entered = false;
    for (let i = 0; i < 30; i++) {
      const r = stepDynamics(m, p, company, "internet", 5);
      if (r.market.maturity > m.maturity) grew = true;
      if (r.market.nearRivals.length > m.nearRivals.length) entered = true;
      m = r.market;
    }
    expect(grew).toBe(true);
    expect(entered).toBe(true); // 成功が参入を呼んだ
  });
});

describe("分析陳腐化の短縮（§4.2）", () => {
  it("静かな市場はSTALE_TURNS、ホット市場は短縮（STALE_MIN以上）", () => {
    const calm = generateMarkets(5)["S6:US"];
    expect(staleEff({ ...calm, lastDeltaMaturity: 0, entryAccrual: 0 })).toBe(STALE_TURNS);
    const hot = { ...calm, lastDeltaMaturity: 0.05, entryAccrual: 1 };
    expect(hotness(hot)).toBeGreaterThan(0);
    expect(staleEff(hot)).toBeLessThan(STALE_TURNS);
    expect(staleEff(hot)).toBeGreaterThanOrEqual(STALE_MIN);
  });
});

describe("totalHit", () => {
  it("自社製品が無い市場のhit_selfは0（ライバルのみ）", () => {
    const m = { ...lowMaturityMarket(), nearRivals: [] };
    expect(totalHit(m, null)).toBe(0);
  });
});
