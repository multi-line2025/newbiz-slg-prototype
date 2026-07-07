/**
 * ======================================================================
 *  finance.ts  収支計算とランウェイ（仕様 §3.1 / §6.3 / 市場成長モデル§2.1）
 * ----------------------------------------------------------------------
 *  売上 = s × M × ARPU ×(1+セールスプレミアム)  ← 有限市場シェアモデル（market.ts）
 *  支出 = Σ給与 + 固定費 + 研究投資 + マーケ予算(広告/PR/コミュニティ)
 *  CASH(t+1) = CASH(t) + 売上 − 支出
 *  monthlyBurn = 支出 / runwayTurns = CASH / burn
 * ======================================================================
 */

import { FIXED_COST } from "./model/constants";
import type { ProtoGameState } from "./state";
import { employees } from "./state";
import { productRevenue, marketSizeFactor } from "./market";
import { sum } from "./util";

export { marketSizeFactor };

/** 月次売上＝全製品の市場別売上を合算（多市場・§5-D / §2.1）。 */
export function computeRevenue(s: ProtoGameState): number {
  let total = 0;
  for (const p of s.products) {
    const market = s.markets[p.marketId];
    if (market) total += productRevenue(p, market, s.era);
  }
  return total;
}

/** 在籍社員の給与合計。 */
export function sumSalaries(s: ProtoGameState): number {
  return sum(
    employees(s).map((e) => e.contract?.salary ?? e.salaryDemand)
  );
}

/** 全製品のマーケ予算合計（広告＋PR＋コミュニティ）。 */
export function sumMarketBudgets(s: ProtoGameState): number {
  return sum(s.products.map((p) => p.adBudget + p.prBudget + p.commBudget));
}

/** 月次バーンレート = Σ給与 + 固定費 + 研究投資 + 全製品マーケ予算（§6.3 / §12.3 / 市場§4）。 */
export function computeMonthlyBurn(s: ProtoGameState): number {
  return sumSalaries(s) + FIXED_COST + s.company.researchBudget + sumMarketBudgets(s);
}

/**
 * 1ターン分の収支を反映した新しい state を返す（純粋関数）。
 * 派生値 monthlyBurn / runwayTurns も再計算する（§6.3 refreshDerived 相当）。
 */
export function applyFinance(s: ProtoGameState): ProtoGameState {
  const revenue = computeRevenue(s);
  const burn = computeMonthlyBurn(s);
  const nextCash = s.company.CASH + revenue - burn;
  const runway = burn > 0 ? nextCash / burn : Infinity;

  return {
    ...s,
    company: {
      ...s.company,
      CASH: nextCash,
      monthlyBurn: burn,
      runwayTurns: Math.max(0, runway),
    },
  };
}

/**
 * 派生値（monthlyBurn / runwayTurns）だけを現CASHから再計算する。
 * 採用・研究予算変更など「バーンが変わるがCASHは動かない」操作の直後に、
 * KPI表示を最新に保つために使う（ターンは進めない）。
 */
export function refreshDerived(s: ProtoGameState): ProtoGameState {
  const burn = computeMonthlyBurn(s);
  const runway = burn > 0 ? s.company.CASH / burn : Infinity;
  return {
    ...s,
    company: { ...s.company, monthlyBurn: burn, runwayTurns: Math.max(0, runway) },
  };
}
