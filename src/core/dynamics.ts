/**
 * ======================================================================
 *  dynamics.ts  市場成熟・成長・参入ダイナミクス（§2〜§4・§7の前段ブロック）
 * ----------------------------------------------------------------------
 *  既存パイプラインの前段に「成熟→実効パイ→密度→参入」を差し込む。
 *   §3 ヒット駆動の成長：高シェア×高QUAL_p が未成熟市場を育てる。
 *   §4 成功が呼ぶ参入：成長・実効パイ・自社の可視的成功で近接ライバルが流入。
 *  すべて純粋関数（rng不使用＝決定論。参入で追加するライバルもseedから決定論生成）。
 * ======================================================================
 */

import type { Era } from "./model/types";
import type { MarketState, Product, NearRival, ProtoCompany } from "./state";
import {
  MAT_GROWTH_K, MAT_REGRESS, QUAL_HIT_MIN, QUAL_HIT_FULL, RIVAL_HIT_W,
  ENTRY_RATE, ATTR_GROWTH, ATTR_PROFIT, ATTR_SUCCESS, DMAT_REF, M_REF, EXIT_RATE,
  HOT_STALE_K, STALE_MIN, STALE_TURNS,
} from "./model/constants";
import { densityOf, nearCountOf, marketEff, makeOneRival } from "./markets";
import { clamp } from "./util";

/** §3.1 品質ゲート：QUAL_p<QUAL_HIT_MIN は市場を育てない、FULLで満ヒット。 */
export function qualGate(qualP: number): number {
  return clamp((qualP - QUAL_HIT_MIN) / (QUAL_HIT_FULL - QUAL_HIT_MIN), 0, 1);
}

/** ライバル成功の代理指標（scaleTier/reputationTier由来・§3.1 qualProxy）。 */
function rivalQualProxy(r: NearRival): number {
  return clamp((r.scaleTier / 4) * 0.6 + (r.reputationTier / 4) * 0.4, 0, 1);
}

/** §3.1 市場全体のヒット圧（自社＋近接ライバル）。 */
export function totalHit(market: MarketState, selfProduct: Product | null): number {
  const s = selfProduct ? (selfProduct.sticky + selfProduct.paid) / 100 : 0;
  const hitSelf = selfProduct ? s * qualGate(selfProduct.QUAL_p) : 0;
  let rivalHit = 0;
  for (const r of market.nearRivals) rivalHit += r.share * rivalQualProxy(r);
  return hitSelf + RIVAL_HIT_W * clamp(rivalHit, 0, 1);
}

/** §3.1 成熟度の1ターン更新（未成熟ほど伸び・放置は緩やか冷却）。 */
export function stepMaturity(market: MarketState, selfProduct: Product | null): { maturity: number; delta: number } {
  const hit = totalHit(market, selfProduct);
  const delta = MAT_GROWTH_K * hit * (1 - market.maturity) - MAT_REGRESS * market.maturity;
  return { maturity: clamp(market.maturity + delta, 0, 1), delta };
}

/** §4.2 市場のホットさ（急成長・大量参入中ほど大）。 */
export function hotness(market: MarketState): number {
  const growthHot = clamp(market.lastDeltaMaturity / DMAT_REF, 0, 1);
  const entryHot = clamp(market.entryAccrual, 0, 1);
  return clamp(0.5 * growthHot + 0.5 * entryHot, 0, 1);
}

/** §4.2 ホット市場は分析が早く陳腐化（STALE_eff）。 */
export function staleEff(market: MarketState): number {
  return clamp(Math.round(STALE_TURNS * (1 - HOT_STALE_K * hotness(market))), STALE_MIN, STALE_TURNS);
}

/** §4.1 参入魅力度（成長＋実効パイ＋自社の可視的成功）。 */
export function attractivenessMult(deltaMaturity: number, mEff: number, ownVisibleSuccess: number): number {
  return 1
    + ATTR_GROWTH * (deltaMaturity / DMAT_REF)
    + ATTR_PROFIT * (mEff / M_REF)
    + ATTR_SUCCESS * ownVisibleSuccess;
}

export interface DynamicsStepResult {
  market: MarketState; // 更新後（maturity/entryAccrual/nearCountTarget/near群）
}

/**
 * 1市場の動的更新（§7 前段：成長→実効パイ→密度→参入）。
 * @param selfProduct この市場に出している自社製品（無ければnull）
 * @param company 会社（可視的成功＝評判×シェアの算出用）
 */
export function stepDynamics(
  market: MarketState, selfProduct: Product | null, company: ProtoCompany, era: Era, seed: number
): DynamicsStepResult {
  // A. 成長（先にmaturityを更新）
  const { maturity, delta } = stepMaturity(market, selfProduct);

  // 実効パイ・密度・目標near数（maturity更新後）
  const mEff = marketEff({ sector: market.sector, country: market.country, biasFactor: market.biasFactor, maturity }, era);
  const density = densityOf(maturity, seed, market.sector, market.country);
  const target = nearCountOf(density);

  // C. 参入（魅力度で流入）
  const s = selfProduct ? (selfProduct.sticky + selfProduct.paid) / 100 : 0;
  const ownVisibleSuccess = s * (company.reputation / 100);
  const gap = Math.max(0, target - market.nearRivals.length);
  const mult = attractivenessMult(delta, mEff, ownVisibleSuccess);
  let entryAccrual = market.entryAccrual + ENTRY_RATE * gap * mult;

  let nearRivals = market.nearRivals;
  const additions = Math.floor(entryAccrual);
  if (additions > 0 && nearRivals.length < target) {
    const toAdd = Math.min(additions, target - nearRivals.length);
    const added: NearRival[] = [];
    for (let i = 0; i < toAdd; i++) {
      added.push(makeOneRival(seed, market.sector, market.country, nearRivals.length + i));
    }
    nearRivals = [...nearRivals, ...added];
    entryAccrual -= toAdd;
  }

  // 撤退（過密/冷却の是正）
  if (nearRivals.length > target) {
    const remove = Math.round(EXIT_RATE * (nearRivals.length - target));
    if (remove > 0) nearRivals = nearRivals.slice(0, nearRivals.length - remove);
  }

  return {
    market: {
      ...market,
      maturity,
      lastDeltaMaturity: delta,
      entryAccrual,
      nearCountTarget: target,
      nearRivals,
    },
  };
}
