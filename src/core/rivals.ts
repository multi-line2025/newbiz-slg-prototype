/**
 * ======================================================================
 *  rivals.ts  他企業（ライバル）の集約・追跡・動向（v0.12・表示レイヤ）
 * ----------------------------------------------------------------------
 *  既にシミュレート済みの各市場 nearRivals を「各社」として集約し、
 *   - 安定ID(NearRival.id)でターンをまたいで同定・追跡
 *   - 推定シェア/規模/志向のカード表示
 *   - 前ターン差分から動きニュース（参入・規模拡大・シェア変動）
 *  を提供する純粋関数群。ゲームロジック（シミュ）は変更しない＝表示のみ。
 *  フォグ整合：詳細は「分析済み(Lv>=1)／自社製品あり」の市場のライバルのみ開示。
 * ======================================================================
 */

import type { MarketState, NearRival, ProtoGameState, RivalSnapshot } from "./state";
import { rivalCompetitiveness } from "./market";
import { C_OPEN, SECTOR_NAME } from "./model/constants";

/** ライバルの推定市場シェア（0-1）。自社cPを含めない“各社間の相対競争力”の目安（分析済み市場用）。 */
export function estimatedRivalShare(r: NearRival, marketRivals: NearRival[]): number {
  const sumCr = marketRivals.reduce((s, x) => s + rivalCompetitiveness(x), 0);
  return rivalCompetitiveness(r) / (sumCr + C_OPEN);
}

/**
 * 表示用シェア（0-1）。自社が競っている市場はシミュ実値 r.share（毎ターン変動）を、
 * 未参入の分析済み市場は推定シェアを用いる。→ 自社市場はシェア変動が動きとして見える。
 */
export function rivalShare(r: NearRival, marketRivals: NearRival[]): number {
  return r.share > 0 ? r.share : estimatedRivalShare(r, marketRivals);
}

/** 全市場のライバルのスナップショットを作る（前ターン比較用）。 */
export function snapshotRivals(markets: Record<string, MarketState>): RivalSnapshot {
  const snap: RivalSnapshot = {};
  for (const m of Object.values(markets)) {
    for (const r of m.nearRivals) {
      snap[r.id] = { estShare: rivalShare(r, m.nearRivals), scaleTier: r.scaleTier };
    }
  }
  return snap;
}

/** 自社製品が居る市場IDの集合（参入済み＝可視）。 */
export function selfMarketIds(state: ProtoGameState): Set<string> {
  return new Set(state.products.map((p) => p.marketId));
}

/** その市場のライバル詳細が可視か（分析Lv>=1 または 自社製品あり）。フォグ整合の要。 */
export function isMarketVisible(market: MarketState, selfIds: Set<string>): boolean {
  return market.analysisLevel >= 1 || selfIds.has(market.id);
}

/** 市場の表示ラベル（例：EC基盤×US）。 */
export function marketLabel(m: { sector: MarketState["sector"]; country: string }): string {
  return `${SECTOR_NAME[m.sector]}×${m.country}`;
}

/**
 * 前ターン差分から「各社の動き」ニュースを生成する（可視市場のみ・フォグ整合）。
 * 参入 / 規模拡大 / シェア拡大 を検出。過去に見えていた社(prev有)は参入扱いしない。
 */
export function computeRivalNews(
  prev: RivalSnapshot,
  markets: Record<string, MarketState>,
  selfIds: Set<string>,
  maxNews = 8
): string[] {
  const news: string[] = [];
  for (const m of Object.values(markets)) {
    if (!isMarketVisible(m, selfIds)) continue; // 未分析・未参入は動向も伏せる
    const label = marketLabel(m);
    for (const r of m.nearRivals) {
      const p = prev[r.id];
      const est = rivalShare(r, m.nearRivals);
      if (!p) { news.push(`🏢 ${r.name} が ${label} に参入しました。`); continue; }
      if (r.scaleTier > p.scaleTier) news.push(`📈 ${r.name} が規模を拡大（${label}）。`);
      else if (est - p.estShare > 0.03) news.push(`🔺 ${r.name} がシェアを伸ばしています（${label}）。`);
      else if (p.estShare - est > 0.03) news.push(`🔻 ${r.name} がシェアを落としています（${label}）。`);
    }
  }
  return news.slice(0, maxNews);
}

/** 1社ぶんの動き（前ターン差分から算出）。 */
export interface RivalMovement {
  isNew: boolean;     // 直近で新規参入
  scaleUp: boolean;   // 規模拡大中
  shareUp: boolean;   // シェア拡大
  shareDown: boolean; // シェア縮小
  aggressive: boolean; // 攻勢的（aggression高 or share志向）
}

/** UI表示用の1社ビュー（可視市場のライバル）。 */
export interface RivalView {
  id: string;
  name: string;
  sector: MarketState["sector"];
  country: string;
  marketLabel: string;
  scaleTier: number;
  reputationTier: number;
  ambitionFocus: NearRival["ambitionFocus"];
  aggression: number;
  estShare: number;
  movement: RivalMovement;
}

/** 集約結果：可視な各社カード＋未分析市場の件数（フォグ表示用）。 */
export interface RivalAggregate {
  cards: RivalView[];
  hiddenMarkets: number;      // ライバルが居るのに未分析/未参入で詳細不明な市場数
  visibleMarkets: number;     // 詳細開示中の市場数
}

/**
 * 他企業タブ用の集約。可視市場のライバルを各社カード化し、state.rivalPrev との差分で動きを付与。
 * 未分析・未参入市場は個社を出さず件数のみ返す（フォグ整合）。
 */
export function aggregateRivals(state: ProtoGameState): RivalAggregate {
  const selfIds = selfMarketIds(state);
  const prev = state.rivalPrev ?? {};
  const cards: RivalView[] = [];
  let hiddenMarkets = 0;
  let visibleMarkets = 0;

  for (const m of Object.values(state.markets)) {
    if (m.nearRivals.length === 0) continue;
    if (!isMarketVisible(m, selfIds)) { hiddenMarkets++; continue; }
    visibleMarkets++;
    for (const r of m.nearRivals) {
      const est = rivalShare(r, m.nearRivals);
      const p = prev[r.id];
      const movement: RivalMovement = {
        isNew: !p,
        scaleUp: !!p && r.scaleTier > p.scaleTier,
        shareUp: !!p && est - p.estShare > 0.01,
        shareDown: !!p && p.estShare - est > 0.01,
        aggressive: r.aggression >= 0.7 || r.ambitionFocus === "share",
      };
      cards.push({
        id: r.id, name: r.name, sector: m.sector, country: m.country,
        marketLabel: marketLabel(m),
        scaleTier: r.scaleTier, reputationTier: r.reputationTier,
        ambitionFocus: r.ambitionFocus, aggression: r.aggression,
        estShare: est, movement,
      });
    }
  }
  cards.sort((a, b) => b.estShare - a.estShare); // 大手（推定シェア高）順
  return { cards, hiddenMarkets, visibleMarkets };
}
