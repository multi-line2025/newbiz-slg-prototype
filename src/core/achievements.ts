/**
 * ======================================================================
 *  achievements.ts  実績（自己目標）＝サンドボックスの達成記録
 * ----------------------------------------------------------------------
 *  勝利条件ではなく「自己目標・実績」（ディレクター裁定＝サンドボックス確定）。
 *  達成してもゲームは終わらない。達成でトースト＋実績一覧にチェック。
 * ======================================================================
 */

import type { Id } from "./model/types";
import type { ProtoGameState } from "./state";
import { BLUEPRINTS } from "./research";

/** 実績定義。predicate が true になった瞬間に達成として記録する。 */
export interface Achievement {
  id: Id;
  label: string;
  desc: string;
  predicate: (s: ProtoGameState) => boolean;
}

/** 実績リスト（自己目標）。 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-hire", label: "はじめての仲間", desc: "初めて社員を採用する", predicate: (s) => s.employeeIds.length >= 1 },
  { id: "first-blueprint", label: "最初の設計図", desc: "2つ目以降の青写真を解放する", predicate: (s) => s.company.unlockedBlueprints.length >= 2 },
  { id: "qual-80", label: "高品質プロダクト", desc: "いずれかの製品QUAL_pが80に到達", predicate: (s) => s.products.some((p) => p.QUAL_p >= 80) },
  { id: "multi-market", label: "多角化", desc: "3つ以上の市場に製品を持つ", predicate: (s) => s.products.length >= 3 },
  { id: "analyst", label: "市場を読む者", desc: "いずれかの市場を精密分析(Lv2)", predicate: (s) => Object.values(s.markets).some((m) => m.analysisLevel >= 2) },
  { id: "profitable", label: "黒字化", desc: "12ターン連続で黒字を出す", predicate: (s) => s.profitStreak >= 12 },
  { id: "cash-100k", label: "資金 $100k", desc: "会社CASHが $100,000 到達", predicate: (s) => s.company.CASH >= 100000 },
  { id: "cash-500k", label: "資金 $500k", desc: "会社CASHが $500,000 到達", predicate: (s) => s.company.CASH >= 500000 },
  { id: "cash-1m", label: "資金 $1M", desc: "会社CASHが $1,000,000 到達", predicate: (s) => s.company.CASH >= 1000000 },
  { id: "team-10", label: "チーム10人", desc: "従業員が10人に到達", predicate: (s) => s.employeeIds.length >= 10 },
  { id: "all-blueprints", label: "全技術制覇", desc: "全ての青写真を解放", predicate: (s) => s.company.unlockedBlueprints.length >= BLUEPRINTS.length },
];

/** id から実績定義を引く。 */
export function getAchievement(id: Id): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * 未達成の実績のうち、現状態で条件を満たしたものを達成記録に追加する（純粋関数）。
 * @returns 更新後stateと、今回新たに達成した実績（トースト用）
 */
export function checkAchievements(state: ProtoGameState): { state: ProtoGameState; newly: Achievement[] } {
  const newly: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue; // 既達成はスキップ
    if (a.predicate(state)) newly.push(a);
  }
  if (newly.length === 0) return { state, newly };
  return {
    state: { ...state, achievements: [...state.achievements, ...newly.map((a) => a.id)] },
    newly,
  };
}
