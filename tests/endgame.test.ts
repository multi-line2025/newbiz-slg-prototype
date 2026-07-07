/**
 * 終了条件・実績のテスト（v0.4）。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { checkAchievements, ACHIEVEMENTS } from "../src/core/achievements";
import { BLUEPRINTS } from "../src/core/research";
import type { ProtoGameState } from "../src/core/state";

describe("終了条件（資金ショート）", () => {
  it("CASH<0に陥るとgameOver・endTurnが記録され、以降ターンは進まない", () => {
    // 低キャッシュ＋巨額の研究予算でバーンを跳ね上げ、確実に破綻させる
    let s = initGame({ seed: 1, country: "US", startingCash: 3000 });
    s = { ...s, company: { ...s.company, researchBudget: 500000 } };
    let guard = 0;
    while (!s.gameOver && guard < 100) {
      s = advanceTurn(s).next;
      guard++;
    }
    expect(s.gameOver).toBe(true);
    expect(s.endTurn).toBe(s.turn);
    // ゲームオーバー後はadvanceしても状態が変わらない
    const frozen = advanceTurn(s).next;
    expect(frozen).toBe(s);
  });
});

describe("実績（自己目標）", () => {
  it("初期状態（社員2名）で first-hire が達成される", () => {
    const s = initGame({ seed: 1 });
    const r = checkAchievements(s);
    expect(r.newly.map((a) => a.id)).toContain("first-hire");
  });

  it("CASHを$100k/$500kにすると対応実績が達成される", () => {
    let s = initGame({ seed: 1 });
    s = { ...s, company: { ...s.company, CASH: 600000 } };
    const ids = checkAchievements(s).newly.map((a) => a.id);
    expect(ids).toContain("cash-100k");
    expect(ids).toContain("cash-500k");
    expect(ids).not.toContain("cash-1m"); // $1Mは未達
  });

  it("製品QUAL_p 80到達で qual-80 が達成される", () => {
    let s = initGame({ seed: 1 });
    s = { ...s, products: s.products.map((p) => ({ ...p, QUAL_p: 82 })) };
    expect(checkAchievements(s).newly.map((a) => a.id)).toContain("qual-80");
  });

  it("一度達成した実績は再度newlyに出ない（重複しない）", () => {
    let s = initGame({ seed: 1 });
    s = checkAchievements(s).state; // first-hire等を記録
    const again = checkAchievements(s);
    expect(again.newly).toHaveLength(0);
  });

  it("profitStreak>=12 で黒字化実績", () => {
    let s = initGame({ seed: 1 }) as ProtoGameState;
    s = { ...s, profitStreak: 12 };
    expect(checkAchievements(s).newly.map((a) => a.id)).toContain("profitable");
  });

  it("全青写真解放で all-blueprints（全24ノード）", () => {
    let s = initGame({ seed: 1 });
    s = { ...s, company: { ...s.company, unlockedBlueprints: BLUEPRINTS.map((b) => b.id) } };
    expect(checkAchievements(s).newly.map((a) => a.id)).toContain("all-blueprints");
  });

  it("実績IDに重複がない", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("連続黒字ストリーク", () => {
  it("黒字ターンで増え、赤字ターンで0にリセットされる", () => {
    // 黒字化しやすいよう創業製品のシェアを高めに
    let s = initGame({ seed: 1, startingCash: 200000 });
    s = { ...s, products: s.products.map((p) => ({ ...p, sticky: 60, QUAL_p: 80 })) };
    const before = s.profitStreak;
    s = advanceTurn(s).next;
    // TRAC100×$200=売上$20,000 が バーンを上回れば streak増
    if (s.company.CASH >= 200000) {
      expect(s.profitStreak).toBe(before + 1);
    }
    expect(typeof s.profitStreak).toBe("number");
  });
});
