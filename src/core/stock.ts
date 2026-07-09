/**
 * ======================================================================
 *  stock.ts  株式（自社キャップテーブル／他社株投資）  v0.19・§8/§9.2
 * ----------------------------------------------------------------------
 *  - 自社：評価額 valuation（財務指標から動的算出）・PC持株比率・創業者持分価値。
 *  - 他社：ライバルの評価額/株価（scaleTier/reputationTier/share から）・保有価値・含み損益。
 *  純粋関数。会社economyには非干渉（他社株は個人資産wealthで売買）。
 * ======================================================================
 */

import type { ProtoGameState, ProtoCompany, NearRival, MarketState } from "./state";
import { computeRevenue } from "./finance";
import { isMarketVisible, selfMarketIds } from "./rivals";
import {
  VAL_REV_MULT, VAL_THXP_VAL, VAL_REP_VAL, VAL_FLOOR,
  RIVAL_VAL_BASE, RIVAL_SHARES, CAPITAL_GAINS_BY_COUNTRY,
} from "./model/constants";

/* ============================================================
 * 自社（キャップテーブル・評価額）
 * ============================================================ */

/**
 * 自社評価額（§8）。財務指標から動的に算出（毎ターン変動）。
 *  = max(下限, 年換算売上×売上倍率 + 保有CASH + 顧客THxP×係数 + 評判×係数)
 */
export function companyValuation(state: ProtoGameState): number {
  const c = state.company;
  const annualRevenue = computeRevenue(state) * 12;
  const v = annualRevenue * VAL_REV_MULT + c.CASH + c.THxP_customer * VAL_THXP_VAL + c.reputation * VAL_REP_VAL;
  return Math.round(Math.max(VAL_FLOOR, v));
}

/** PC（創業者）の持株比率 0-1。 */
export function pcShareRatio(company: ProtoCompany): number {
  const t = company.capTable.totalShares;
  return t > 0 ? company.capTable.pcShares / t : 0;
}

/** 創業者持分価値 ＝ PC持株比率 × 会社評価額（個人純資産に直結）。 */
export function founderEquityValue(state: ProtoGameState): number {
  return Math.round(pcShareRatio(state.company) * companyValuation(state));
}

/** 1株あたりの発行価格（増資の希薄化計算・pre-money valuation / totalShares）。 */
export function pricePerShare(state: ProtoGameState): number {
  return companyValuation(state) / state.company.capTable.totalShares;
}

/* ============================================================
 * 他社（ライバル株）
 * ============================================================ */

/** ライバルの評価額（規模ティア×評判×市場シェアで算出）。成長/衰退に連動。 */
export function rivalValuation(r: NearRival): number {
  return Math.round(
    RIVAL_VAL_BASE * (r.scaleTier + 1) * (0.6 + 0.1 * r.reputationTier) * (1 + 2 * r.share)
  );
}

/** ライバルの株価（評価額 / 発行株式数）。 */
export function rivalSharePrice(r: NearRival): number {
  return rivalValuation(r) / RIVAL_SHARES;
}

/** 全市場からライバルをidで検索（保有株の時価評価に使用）。 */
export function findRival(state: ProtoGameState, rivalId: string): NearRival | null {
  for (const m of Object.values(state.markets)) {
    const r = m.nearRivals.find((x) => x.id === rivalId);
    if (r) return r;
  }
  return null;
}

/** ライバルが属する市場。 */
export function rivalMarket(state: ProtoGameState, rivalId: string): MarketState | null {
  for (const m of Object.values(state.markets)) {
    if (m.nearRivals.some((x) => x.id === rivalId)) return m;
  }
  return null;
}

/**
 * 売買可能か（フォグ整合）：そのライバルの市場が分析済み(Lv>=1)/自社製品ありのときのみ。
 *  ＝業績を評価できる（DD済み）会社にだけ投資できる、という思想。
 */
export function isRivalTradeable(state: ProtoGameState, rivalId: string): boolean {
  const m = rivalMarket(state, rivalId);
  return m ? isMarketVisible(m, selfMarketIds(state)) : false;
}

/** 保有株の時価（上場廃止＝ライバル消滅なら0）。 */
export function holdingMarketValue(state: ProtoGameState, rivalId: string): number {
  const h = state.stockHoldings[rivalId];
  if (!h) return 0;
  const r = findRival(state, rivalId);
  if (!r) return 0; // 上場廃止（市場から退出）
  return Math.round(rivalSharePrice(r) * h.shares);
}

/** 含み損益（時価 − 取得原価）。 */
export function holdingUnrealized(state: ProtoGameState, rivalId: string): number {
  const h = state.stockHoldings[rivalId];
  if (!h) return 0;
  return holdingMarketValue(state, rivalId) - h.costBasis;
}

/** 保有他社株の時価総額（ポートフォリオ）。 */
export function portfolioValue(state: ProtoGameState): number {
  return Object.keys(state.stockHoldings).reduce((s, id) => s + holdingMarketValue(state, id), 0);
}

/** 譲渡益課税率（起業国基準）。 */
export function capitalGainsRate(state: ProtoGameState): number {
  return CAPITAL_GAINS_BY_COUNTRY[state.company.foundedCountry] ?? 0.2;
}
