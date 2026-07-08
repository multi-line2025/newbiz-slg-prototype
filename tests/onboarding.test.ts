/**
 * 序盤オンボーディング（死の谷が無いこと）の回帰テスト（v0.7.2）。
 * 「初心者の素直な操作＝初期社員は創業製品に配属済みのまま[次のターン]を押すだけ」で、
 * 創業製品が軌道に乗り（黒字化に到達し）、資金ショートしないことを複数seedで保証する。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { productRevenue } from "../src/core/market";
import type { ProtoGameState } from "../src/core/state";

const SEEDS = [12345, 2024, 777, 42, 99999];

/** そのターンの収支（売上−バーン）。 */
function netProfit(before: number, after: number): number {
  return after - before;
}

describe("死の谷の撤去（初心者が素直に遊べる）", () => {
  it("初期人材は“普通”のまま（能力の底上げをしない）＝役割カバレッジでturn1レバーを担保", () => {
    for (const seed of SEEDS) {
      const s = initGame({ seed, country: "US" });
      // 創業チームに sales 職が含まれ、創業製品に配属されている（turn1から効く直販レバー）。
      const salesOnStarter = s.employeeIds.some(
        (id) => s.people[id].assignedRole === "sales" && s.assignments[id] === s.products[0].id
      );
      expect(salesOnStarter).toBe(true);
      // 品質フロア等の底上げは無く、QUAL_pは人材/開発で決まる“普通”の値（低くてよい）。
      expect(s.products[0].qualFloor).toBe(0);
    }
  });

  it("パッシブ（次のターン連打）で20ターン以内にゲームオーバーしない", () => {
    for (const seed of SEEDS) {
      let s: ProtoGameState = initGame({ seed, country: "US" });
      for (let t = 0; t < 20; t++) s = advanceTurn(s).next;
      expect(s.gameOver).toBe(false);
      expect(s.company.CASH).toBeGreaterThan(0);
    }
  });

  it("パッシブで15ターン以内に黒字ターン（売上≥バーン）に到達する＝軌道に乗る", () => {
    for (const seed of SEEDS) {
      let s: ProtoGameState = initGame({ seed, country: "US" });
      let reachedBreakEven = false;
      for (let t = 0; t < 15; t++) {
        const before = s.company.CASH;
        s = advanceTurn(s).next;
        if (netProfit(before, s.company.CASH) >= 0) reachedBreakEven = true;
      }
      expect(reachedBreakEven).toBe(true);
    }
  });

  it("創業製品のTRACとM_eff由来売上が序盤に上向く（下降し続けない）", () => {
    for (const seed of SEEDS) {
      let s: ProtoGameState = initGame({ seed, country: "US" });
      const rev: number[] = [];
      for (let t = 0; t < 12; t++) {
        s = advanceTurn(s).next;
        const p = s.products[0];
        const m = s.markets[p.marketId];
        rev.push(m ? productRevenue(p, m, s.era) : 0);
      }
      // 終盤の売上が序盤より高い（右肩上がり）
      expect(rev[rev.length - 1]).toBeGreaterThan(rev[1]);
    }
  });
});
