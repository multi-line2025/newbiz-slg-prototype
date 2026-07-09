/**
 * 多市場・製品ベースのシェア争奪モデルのテスト（市場分析製品品質モデル v0.1）。
 */
import { describe, it, expect } from "vitest";
import {
  wordOfMouthTrac, qualCore, qualAdFit, productCompetitiveness,
  rivalCompetitiveness, marketRivalComp, earnedShareCap, reachShareCap,
  salesForce, marketerForce, stepProductMarket, productRevenue, salesShareFrac,
} from "../src/core/market";
import { generateMarkets, marketId } from "../src/core/markets";
import { buildPerson } from "../src/core/person";
import { makePRNG } from "../src/core/prng";
import type { Person } from "../src/core/model/types";
import type { ProtoCompany, Product, MarketState } from "../src/core/state";

function makeCompany(over: Partial<ProtoCompany> = {}): ProtoCompany {
  return {
    name: "T", foundedCountry: "US", CASH: 100000, reputation: 20,
    monthlyBurn: 0, runwayTurns: 0, RP_C: 0, researchBudget: 0,
    unlockedBlueprints: [], missionTags: [], THxP_customer: 0, capTable: { totalShares: 1000000, pcShares: 1000000, holders: [] }, ...over,
  };
}
function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: "p1", blueprintId: "BP-620", sector: "S5", country: "US", marketId: "S5:US",
    devTurns: 6, QUAL_p: 70, qualFloor: 0, sticky: 10, paid: 0, stickySales: 0,
    adBudget: 0, prBudget: 0, commBudget: 0, ...over,
  };
}
function emp(job: Person["jobCategory"], role: Person["assignedRole"], attr: Partial<Record<string, number>> = {}): Person {
  const p = buildPerson({ PA: 150, age: 30, nationality: "US", era: "internet", jobCategory: job }, makePRNG(3));
  const occ = { ...p.attributes.occupational, ...attr };
  return { ...p, assignedRole: role, attributes: { ...p.attributes, occupational: occ } };
}

describe("競争力と上限シェア（§3・§2.4）", () => {
  it("qualCore：QUAL0で0.4、QUAL100で1.0", () => {
    expect(qualCore(0)).toBeCloseTo(0.4);
    expect(qualCore(100)).toBeCloseTo(1.0);
  });
  it("productCompetitiveness はQUAL_p・セールス・THxPで上がる", () => {
    const base = productCompetitiveness(50, [], makeCompany());
    expect(productCompetitiveness(90, [], makeCompany())).toBeGreaterThan(base);
    expect(productCompetitiveness(50, [emp("sales", "sales", { sales: 18 })], makeCompany())).toBeGreaterThan(base);
    expect(productCompetitiveness(50, [], makeCompany({ THxP_customer: 300 }))).toBeGreaterThan(base);
  });
  it("s*_earned：ライバルが強いほど天井が縮む", () => {
    expect(earnedShareCap(1.0, 3.0)).toBeLessThan(earnedShareCap(1.0, 1.0));
  });
  it("s*_reach は QUAL/100 で頭打ち", () => {
    expect(reachShareCap(30, 0.9)).toBeLessThanOrEqual(0.3 + 1e-9);
  });
  it("shareフォーカスのライバルは競争力が高い", () => {
    const base = { id: "r", name: "R", sector: "same" as const, scaleTier: 2, reputationTier: 2, aggression: 0.5, share: 0, growthProgress: 0 };
    expect(rivalCompetitiveness({ ...base, ambitionFocus: "share" })).toBeGreaterThan(rivalCompetitiveness({ ...base, ambitionFocus: "expand" }));
  });
});

describe("品質-広告整合（§5）", () => {
  it("qualAdFit：QUAL_AD_BACKFIRE(28)未満は0、85で1.0、100で1.2（v0.7.2で崖を28へ緩和）", () => {
    expect(qualAdFit(20)).toBe(0);
    expect(qualAdFit(28)).toBe(0);
    expect(qualAdFit(85)).toBeCloseTo(1.0);
    expect(qualAdFit(100)).toBeCloseTo(1.2);
  });
});

describe("stepProductMarket（§5-C）", () => {
  const markets = generateMarkets(999);
  const market = markets["S5:US"] as MarketState;

  it("広告：QUAL_p十分ならpaidが増える", () => {
    const p = makeProduct({ QUAL_p: 80, adBudget: 4000, sticky: 5, paid: 0 });
    const r = stepProductMarket(p, [], market, makeCompany(), "internet", 999);
    expect(r.product.paid).toBeGreaterThan(0);
  });
  it("★逆噴射：QUAL_p<40で広告は sticky/THxP 毀損＋警告", () => {
    const p = makeProduct({ QUAL_p: 20, adBudget: 4000, sticky: 30 });
    const r = stepProductMarket(p, [], market, makeCompany({ THxP_customer: 50 }), "internet", 999);
    expect(r.dTHxP).toBeLessThan(0);
    expect(r.events.join()).toContain("逆噴射");
  });
  it("セールス：人材配属でsticky_salesが増える（金だけでは0）", () => {
    // 余地を作る：高QUAL_p・強い会社（THxP/評判）で s*天井を上げ、現シェアは低く
    const strong = makeCompany({ THxP_customer: 300, reputation: 80 });
    const p = makeProduct({ QUAL_p: 90, sticky: 1, paid: 0, stickySales: 0 });
    const base = stepProductMarket(p, [], market, strong, "internet", 999);
    const withSales = stepProductMarket(p, [emp("sales", "sales", { sales: 18 })], market, strong, "internet", 999);
    expect(base.product.stickySales).toBe(0); // 人材ゼロならセールスチャネル0
    expect(withSales.product.stickySales).toBeGreaterThan(0);
  });
  it("paidはsticky より速く減衰する（§6.1）", () => {
    const p = makeProduct({ QUAL_p: 50, sticky: 20, paid: 20, adBudget: 0 });
    const r = stepProductMarket(p, [], market, makeCompany(), "internet", 999);
    expect(20 - r.product.paid).toBeGreaterThan(20 - r.product.sticky);
  });
});

describe("多市場売上（§2.1・§5-D）", () => {
  const markets = generateMarkets(999);
  const market = markets["S5:US"] as MarketState;
  it("製品売上 = s×M×ARPU×プレミアム。セールス由来で単価↑", () => {
    const no = productRevenue(makeProduct({ stickySales: 0 }), market, "internet");
    const yes = productRevenue(makeProduct({ stickySales: 10 }), market, "internet");
    expect(yes).toBeGreaterThan(no);
    expect(salesShareFrac(makeProduct({ sticky: 10, paid: 0, stickySales: 5 }))).toBeCloseTo(0.5);
  });
  it("シェア0なら売上0", () => {
    expect(productRevenue(makeProduct({ sticky: 0, paid: 0 }), market, "internet")).toBe(0);
  });
});

describe("force・口コミ形状", () => {
  it("salesForce/marketerForceは配属で計上（未配属は0）", () => {
    expect(salesForce([emp("sales", "sales", { sales: 20 })])).toBeGreaterThan(0);
    expect(salesForce([emp("sales", null, { sales: 20 })])).toBe(0);
    expect(marketerForce([emp("marketer", "marketer", { marketing: 20 })])).toBeGreaterThan(0);
  });
  it("wordOfMouth：QUAL40未満0・70超加速（v0.7.2で立ち上げを40へ）", () => {
    expect(wordOfMouthTrac(39)).toBe(0);
    expect(wordOfMouthTrac(50)).toBeGreaterThan(0); // 40〜70帯で立ち上がる
    const lo = wordOfMouthTrac(70) - wordOfMouthTrac(60);
    const hi = wordOfMouthTrac(100) - wordOfMouthTrac(90);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("ΣC_r は密度でスケール（§1.3）", () => {
  it("marketRivalComp は farPressure を含み正の値", () => {
    const markets = generateMarkets(7);
    const m = markets[marketId("S1", "US")];
    expect(marketRivalComp(m, "internet", 7)).toBeGreaterThan(0);
  });
});
