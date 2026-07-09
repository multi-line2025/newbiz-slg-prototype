/**
 * v0.19 回帰テスト：株式（自社キャップテーブル・増資／他社株の売買・連動・譲渡益課税・非回帰）。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { raiseCapital, buyRivalShares, sellRivalShares } from "../src/core/actions";
import {
  companyValuation, pcShareRatio, founderEquityValue, rivalValuation, rivalSharePrice,
  isRivalTradeable, holdingMarketValue, holdingUnrealized, capitalGainsRate,
} from "../src/core/stock";
import { CAPITAL_GAINS_BY_COUNTRY } from "../src/core/model/constants";
import type { ProtoGameState } from "../src/core/state";
import type { NearRival } from "../src/core/state";

const advanceN = (s: ProtoGameState, n: number) => { for (let i = 0; i < n; i++) s = advanceTurn(s).next; return s; };
/** 自社製品のある市場(S5:US)のライバルidを返す（売買可能）。 */
const tradeableRivalId = (s: ProtoGameState) => s.markets["S5:US"].nearRivals[0].id;

describe("v0.19：自社キャップテーブル・評価額・増資", () => {
  it("創業時PC100%・評価額>0・創業者持分価値=比率×評価額", () => {
    const s = initGame({ seed: 42 });
    expect(pcShareRatio(s.company)).toBe(1);
    expect(companyValuation(s)).toBeGreaterThan(0);
    expect(founderEquityValue(s)).toBe(Math.round(pcShareRatio(s.company) * companyValuation(s)));
  });

  it("評価額は財務指標で動的（売上/CASH成長で上がる）", () => {
    const s0 = initGame({ seed: 42, archetype: "labor" });
    const s1 = advanceN(s0, 10); // 売上・CASH成長
    expect(companyValuation(s1)).toBeGreaterThan(companyValuation(s0));
  });

  it("増資でCASHが増え、PC持株比率が希薄化する（総株数増）", () => {
    let s = advanceN(initGame({ seed: 42, archetype: "labor" }), 5);
    const cash0 = s.company.CASH, ratio0 = pcShareRatio(s.company), shares0 = s.company.capTable.totalShares;
    const r = raiseCapital(s, 200000);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.company.CASH).toBeCloseTo(cash0 + 200000, 0);       // CASH調達
    expect(s.company.capTable.totalShares).toBeGreaterThan(shares0); // 新株発行
    expect(pcShareRatio(s.company)).toBeLessThan(ratio0);        // 希薄化
    expect(s.company.capTable.pcShares).toBe(1_000_000);         // PC保有株は不変
  });
});

describe("v0.19：他社株の売買・連動・課税・フォグ", () => {
  it("株価はライバルの規模/評判/シェアで決まり、成長で上がる", () => {
    const r0: NearRival = { id: "x", name: "X", sector: "same", scaleTier: 1, reputationTier: 1, aggression: 0.5, ambitionFocus: "share", share: 0.1, growthProgress: 0 };
    const r1: NearRival = { ...r0, scaleTier: 3, reputationTier: 3, share: 0.3 };
    expect(rivalValuation(r1)).toBeGreaterThan(rivalValuation(r0));
    expect(rivalSharePrice(r1)).toBeGreaterThan(rivalSharePrice(r0));
  });

  it("個人資産で買える・会社CASHは不変（会社economy非干渉）", () => {
    const s = initGame({ seed: 42, archetype: "labor" });
    const id = tradeableRivalId(s);
    expect(isRivalTradeable(s, id)).toBe(true); // S5:US=自社製品あり→売買可
    const w0 = s.pc.wealth, cash0 = s.company.CASH;
    const r = buyRivalShares(s, id, 100);
    expect(r.ok).toBe(true);
    expect(r.state.pc.wealth).toBeLessThan(w0);      // 個人資産から支払い
    expect(r.state.company.CASH).toBe(cash0);        // 会社CASHは不変
    expect(r.state.stockHoldings[id].shares).toBe(100);
  });

  it("未分析市場のライバルは売買不可（フォグ）→分析で開示", () => {
    let s = initGame({ seed: 42 });
    // 自社製品のない市場のライバルを探す
    const selfIds = new Set(s.products.map((p) => p.marketId));
    const mid = Object.keys(s.markets).find((id) => !selfIds.has(id) && s.markets[id].nearRivals.length > 0)!;
    const rid = s.markets[mid].nearRivals[0].id;
    expect(isRivalTradeable(s, rid)).toBe(false);
    expect(buyRivalShares(s, rid, 100).ok).toBe(false);
    // 分析済みにする → 売買可
    s = { ...s, markets: { ...s.markets, [mid]: { ...s.markets[mid], analysisLevel: 1 as const } } };
    expect(isRivalTradeable(s, rid)).toBe(true);
  });

  it("保有価値がライバル業績に連動して変動する", () => {
    let s = initGame({ seed: 42, archetype: "labor" });
    const id = tradeableRivalId(s);
    s = buyRivalShares(s, id, 500).state;
    const v0 = holdingMarketValue(s, id);
    // ライバルの規模を強制的に上げる → 時価上昇
    const mk = { ...s.markets["S5:US"] };
    mk.nearRivals = mk.nearRivals.map((r) => (r.id === id ? { ...r, scaleTier: r.scaleTier + 2, share: r.share + 0.2 } : r));
    s = { ...s, markets: { ...s.markets, "S5:US": mk } };
    expect(holdingMarketValue(s, id)).toBeGreaterThan(v0);
    expect(holdingUnrealized(s, id)).toBeGreaterThan(0);
  });

  it("売却益に譲渡益課税が適用される（利益時のみ）", () => {
    let s = initGame({ seed: 42, archetype: "labor" });
    const id = tradeableRivalId(s);
    s = buyRivalShares(s, id, 500).state;
    // 大きく値上がりさせる
    const mk = { ...s.markets["S5:US"] };
    mk.nearRivals = mk.nearRivals.map((r) => (r.id === id ? { ...r, scaleTier: 4, reputationTier: 4, share: 0.5 } : r));
    s = { ...s, markets: { ...s.markets, "S5:US": mk } };
    const wealthBefore = s.pc.wealth;
    const mv = holdingMarketValue(s, id);
    const cost = s.stockHoldings[id].costBasis;
    const gain = mv - cost;
    const r = sellRivalShares(s, id, 500);
    expect(r.ok).toBe(true);
    const expectedTax = gain > 0 ? Math.round(gain * capitalGainsRate(s)) : 0;
    expect(expectedTax).toBeGreaterThan(0);
    // 手取り ≒ wealth + proceeds − tax（proceeds=mv）
    expect(r.state.pc.wealth).toBe(wealthBefore + mv - expectedTax);
    expect(r.state.stockHoldings[id]).toBeUndefined(); // 全売却で消える
  });

  it("譲渡益税率は起業国基準（US 0.20 / JP 0.20315 …）", () => {
    expect(capitalGainsRate(initGame({ seed: 1, country: "US" }))).toBe(CAPITAL_GAINS_BY_COUNTRY.US);
    expect(capitalGainsRate(initGame({ seed: 1, country: "JP" }))).toBe(CAPITAL_GAINS_BY_COUNTRY.JP);
  });
});

describe("v0.19：非回帰（株式未使用＝baseline一致）", () => {
  it("増資/他社株を使わなければ両archetypeの finals が一致・決定論", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const a = advanceN(initGame({ seed: 3, archetype }), 20);
      const b = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(a.company.CASH).toBe(b.company.CASH);
      expect(a.gameOver).toBe(false);
      expect(a.company.capTable.pcShares).toBe(1_000_000); // 増資なし＝希薄化なし
    }
  });
});
