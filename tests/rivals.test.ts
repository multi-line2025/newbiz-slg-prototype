/**
 * v0.12 回帰テスト：他企業（ライバル）タブ＝集約・追跡・動向ログ・フォグ整合・非回帰。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { aggregateRivals, snapshotRivals, computeRivalNews, isMarketVisible } from "../src/core/rivals";
import type { ProtoGameState } from "../src/core/state";

function advanceN(s: ProtoGameState, n: number): ProtoGameState {
  for (let i = 0; i < n; i++) s = advanceTurn(s).next;
  return s;
}
const midOf = (c: { sector: string; country: string }) => `${c.sector}:${c.country}`;

describe("v0.12：各社の同定・追跡", () => {
  it("自社市場のライバルidがターンをまたいで同定できる", () => {
    let s = initGame({ seed: 42, archetype: "labor" });
    const before = new Set(s.markets["S5:US"].nearRivals.map((r) => r.id));
    s = advanceN(s, 5);
    const persisted = s.markets["S5:US"].nearRivals.filter((r) => before.has(r.id));
    expect(before.size).toBeGreaterThan(0);
    expect(persisted.length).toBeGreaterThan(0); // 既存社は同一idで継続追跡できる
  });

  it("snapshotRivals は決定論（同seed・同ターンで一致）", () => {
    const a = snapshotRivals(advanceN(initGame({ seed: 5 }), 4).markets);
    const b = snapshotRivals(advanceN(initGame({ seed: 5 }), 4).markets);
    expect(a).toEqual(b);
  });
});

describe("v0.12：フォグ整合（分析済み/参入済み市場のみ開示）", () => {
  it("開始時は自社市場のみ開示・他市場は非開示（hiddenMarkets>0）", () => {
    const s = initGame({ seed: 7, archetype: "knowledge" });
    const selfIds = new Set(s.products.map((p) => p.marketId));
    const agg = aggregateRivals(s);
    expect(agg.visibleMarkets).toBeGreaterThanOrEqual(1);
    expect(agg.hiddenMarkets).toBeGreaterThan(0);
    // 全カードが可視市場（分析Lv>=1 か 自社製品あり）に属する
    for (const c of agg.cards) {
      const m = s.markets[midOf(c)];
      expect(m.analysisLevel >= 1 || selfIds.has(m.id)).toBe(true);
    }
  });

  it("未分析市場のライバルはカードに出ない→分析済みにすると開示される", () => {
    const s0 = initGame({ seed: 7 });
    const selfIds = new Set(s0.products.map((p) => p.marketId));
    const mid = Object.keys(s0.markets).find(
      (id) => !selfIds.has(id) && s0.markets[id].nearRivals.length > 0
    )!;
    expect(aggregateRivals(s0).cards.some((c) => midOf(c) === mid)).toBe(false); // 未分析＝非開示
    const s = { ...s0, markets: { ...s0.markets, [mid]: { ...s0.markets[mid], analysisLevel: 1 as const } } };
    expect(aggregateRivals(s).cards.some((c) => midOf(c) === mid)).toBe(true); // 分析後＝開示
  });

  it("computeRivalNews は未分析市場の動きを出さない（フォグ）", () => {
    const s = initGame({ seed: 7 });
    const selfIds = new Set(s.products.map((p) => p.marketId));
    // 空スナップショット＝全社が“新規”扱いになり得るが、可視市場ぶんしか出ない
    const news = computeRivalNews({}, s.markets, selfIds, 99);
    // 生成された参入ニュースの市場はすべて可視
    for (const line of news) {
      const visibleLabels = Object.values(s.markets)
        .filter((m) => isMarketVisible(m, selfIds))
        .map((m) => `${m.country}`);
      expect(visibleLabels.some((c) => line.includes(`×${c}`))).toBe(true);
    }
  });
});

describe("v0.12：動きログの生成", () => {
  it("ターン進行で動向ニュース（参入・シェア変動）が生成される", () => {
    let s = initGame({ seed: 42, archetype: "labor" });
    s = advanceN(s, 15);
    expect(s.rivalNews.length).toBeGreaterThan(0);
  });

  it("初期 rivalPrev が設定され、turn1で既存社を“全員参入”扱いしない", () => {
    const s0 = initGame({ seed: 42, archetype: "labor" });
    expect(Object.keys(s0.rivalPrev).length).toBeGreaterThan(0); // 初期スナップショット済み
    const s1 = advanceTurn(s0).next;
    const entries = s1.rivalNews.filter((n) => n.includes("参入"));
    // 自社市場の既存3社を一斉に参入扱いしない（新規参入があっても少数）
    expect(entries.length).toBeLessThan(3);
  });
});

describe("v0.12：非回帰（表示追加でゲーム進行は不変）", () => {
  it("ライバル表示処理は CASH/gameOver を変えない（決定論一致）", () => {
    const a = advanceN(initGame({ seed: 5, archetype: "knowledge" }), 12);
    const b = advanceN(initGame({ seed: 5, archetype: "knowledge" }), 12);
    expect(a.company.CASH).toBe(b.company.CASH);
    expect(a.gameOver).toBe(b.gameOver);
  });

  it("labor/knowledge とも20ターン生存（v0.11 envelope維持）", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const s = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(s.gameOver).toBe(false);
      expect(s.company.CASH).toBeGreaterThan(0);
    }
  });
});
