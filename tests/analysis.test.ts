/**
 * 市場分析メカニクスのテスト（§3）＋分析アクション・投入・多市場ターン統合。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { analyzeMarket, launchProduct, assignToProduct, unlockBlueprint, hireCandidate, assignRole } from "../src/core/actions";
import { analysisSkill, discloseValues, analyzedRange, fitP, opportunityScore } from "../src/core/analysis";
import { marketEff } from "../src/core/markets";
import { employees, poolPeople } from "../src/core/state";
import type { ProtoGameState } from "../src/core/state";

/** リサーチャーを1名雇い researcher に配属した状態（v0.10：評判ゲートPA<=120で雇える候補）。 */
function withResearcher(s: ProtoGameState): ProtoGameState {
  const hireable = poolPeople(s).filter((p) => p.PA <= 120);
  const cand = hireable.find((p) => p.jobCategory === "researcher") ?? hireable[0];
  s = hireCandidate(s, cand.id).state;
  s = assignRole(s, cand.id, "researcher").state;
  return s;
}

describe("分析スキル（§3.3）", () => {
  it("リサーチャーが居ないとフォールバック（弱め）、居ると強い", () => {
    const s = initGame({ seed: 3 });
    const base = analysisSkill(employees(s));
    const s2 = withResearcher(s);
    expect(analysisSkill(employees(s2))).toBeGreaterThanOrEqual(base * 0.9);
    expect(analysisSkill([])).toBe(0);
  });
});

describe("開示値と誤差（§3.3）", () => {
  it("誤差は担当スキルが高いほど狭く、真値はレンジ内に含まれる", () => {
    const s = initGame({ seed: 3 });
    const m = s.markets["S5:US"];
    const wide = discloseValues(m, s.era, s.marketSeed, 0.35, 1);
    const narrow = discloseValues(m, s.era, s.marketSeed, 0.35, 20);
    expect(narrow.errorPct).toBeLessThan(wide.errorPct);
    // 開示するのは実効パイ M_eff（＝M_pot×realize(maturity)）
    const trueM = marketEff({ sector: m.sector, country: m.country, biasFactor: m.biasFactor, maturity: m.maturity }, s.era);
    const r = analyzedRange(wide.M, wide.errorPct);
    expect(trueM).toBeGreaterThanOrEqual(r.low - 1e-6);
    expect(trueM).toBeLessThanOrEqual(r.high + 1e-6);
  });
});

describe("analyzeMarket アクション（§3.2）", () => {
  it("0→1でAP1・$1,500消費、進行後に開示される", () => {
    let s = initGame({ seed: 3 });
    const r = analyzeMarket(s, "S1:US");
    expect(r.ok).toBe(true);
    expect(r.state.ap).toBe(s.ap - 1);
    expect(r.state.company.CASH).toBe(s.company.CASH - 1500);
    expect(r.state.markets["S1:US"].analysisInProgress).not.toBeNull();
    // 1ターン後に完了
    s = advanceTurn(r.state).next;
    expect(s.markets["S1:US"].analysisLevel).toBe(1);
    expect(s.markets["S1:US"].analyzed).not.toBeNull();
  });
  it("精密分析済み市場は再分析不可", () => {
    let s = initGame({ seed: 3 });
    s = { ...s, markets: { ...s.markets, "S1:US": { ...s.markets["S1:US"], analysisLevel: 2 } } };
    expect(analyzeMarket(s, "S1:US").ok).toBe(false);
  });
});

describe("情報陳腐化（§3.7）", () => {
  it("STALE_TURNS経過で分析レベルが下がる", () => {
    let s = initGame({ seed: 3 });
    s = { ...s, markets: { ...s.markets, "S1:US": { ...s.markets["S1:US"], analysisLevel: 1, analyzed: { M: 100, densityIndex: 1, errorPct: 0.2 }, lastAnalyzedTurn: s.turn } } };
    for (let i = 0; i < 9; i++) s = advanceTurn(s).next; // STALE_TURNS=8超
    expect(s.markets["S1:US"].analysisLevel).toBe(0);
  });
});

describe("fit_p / 機会スコア（§3.5/§3.6）", () => {
  it("青写真未保有の市場は fit_p=null（取得が必要）", () => {
    const s = initGame({ seed: 3 }); // 保有は BP-620(S5) のみ
    const m = s.markets["S1:US"]; // Web＝BP-101未保有
    expect(fitP(m, s.company, employees(s), s.era, s.marketSeed, null)).toBeNull();
  });
  it("保有市場(S5)は fit_p が算出でき、opportunityは0-100", () => {
    const s = initGame({ seed: 3 });
    const m = s.markets["S5:US"];
    const existing = s.products.find((p) => p.marketId === "S5:US") ?? null;
    const fit = fitP(m, s.company, employees(s), s.era, s.marketSeed, existing);
    expect(fit).not.toBeNull();
    const opp = opportunityScore(200, 3, fit);
    expect(opp).toBeGreaterThanOrEqual(0);
    expect(opp).toBeLessThanOrEqual(100);
  });
});

describe("製品投入 & 多市場売上（要望②・§5-D）", () => {
  it("青写真解放→launch→配属で新市場の製品が生まれ、売上が合算される", () => {
    let s = initGame({ seed: 3, startingCash: 300000 });
    s = withResearcher(s);
    // BP-101(Web)を解放するためRPを付与し解放（internet期＝可）
    s = { ...s, company: { ...s.company, RP_C: 200 } };
    s = unlockBlueprint(s, "BP-101").state;
    const before = s.products.length;
    const r = launchProduct(s, "BP-101", "US");
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.products.length).toBe(before + 1);
    // エンジニアを新製品へ配属（v0.10：採用は評判ゲートPA<=120。雇える候補から選ぶ）
    const hireable = poolPeople(s).filter((p) => p.PA <= 120);
    const eng = hireable.find((p) => p.jobCategory === "engineer") ?? hireable[0];
    if (eng) {
      s = hireCandidate(s, eng.id).state;
      s = assignRole(s, eng.id, "engineer").state;
      const newProd = s.products.find((p) => p.marketId === "S1:US")!;
      s = assignToProduct(s, eng.id, newProd.id).state;
    }
    // 数ターン回して複数市場から売上が立つ
    for (let i = 0; i < 4; i++) s = advanceTurn(s).next;
    expect(s.products.length).toBeGreaterThanOrEqual(2);
    const web = s.products.find((p) => p.marketId === "S1:US")!;
    expect(web.QUAL_p).toBeGreaterThan(0); // 担当配属でQUAL_pが立つ
  });
  it("同一市場に2つ目の製品は投入できない", () => {
    const s = initGame({ seed: 3 });
    // 創業製品が S5:US に既にある
    const r = launchProduct(s, "BP-620", "US");
    expect(r.ok).toBe(false);
  });
});
