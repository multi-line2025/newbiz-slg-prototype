/**
 * ======================================================================
 *  analysis.ts  市場分析メカニクス（リサーチャー主導・霧を晴らす）（§3）
 * ----------------------------------------------------------------------
 *  未分析＝霧（規模・密度・機会が不明＝博打）。リサーチャー配属＋AP＋CASH＋
 *  ターンで analysisLevel 0→1→2。精度＝research能力依存（スカウト誤差式流用）。
 *  fit_p（自社フィット）・Opportunity（機会スコア）・情報陳腐化 STALE_TURNS。
 * ======================================================================
 */

import type { Person, Era } from "./model/types";
import type { ProtoCompany, MarketState, Product } from "./state";
import { accuracyFactor } from "./scout";
import { densityOf, marketEff } from "./markets";
import { productCompetitiveness, marketRivalComp, earnedShareCap } from "./market";
import { computeQualP } from "./product";
import { blueprintForSector, sectorTier, type ProtoBlueprint } from "./research";
import { C_OPEN, TEAM_WEIGHTS } from "./model/constants";
import { clamp } from "./util";

/**
 * 分析スキル（研究合成・1-20）。リサーチ役配属者の research を 0.6/0.25/0.15 合成。
 * リサーチ役が居なければ全社員の best research を弱いフォールバック（創業者が読む・§3.3）。
 */
export function analysisSkill(employees: Person[]): number {
  const researchers = employees
    .filter((e) => e.assignedRole === "researcher")
    .map((e) => e.attributes.occupational.research)
    .sort((a, b) => b - a);
  const pool = researchers.length > 0
    ? researchers
    : employees.map((e) => e.attributes.occupational.research).sort((a, b) => b - a);
  if (pool.length === 0) return 0;
  if (pool.length === 1) return pool[0] * (researchers.length > 0 ? 1 : 0.7); // フォールバックは弱める
  const rest = pool.slice(2);
  const restAvg = rest.length > 0 ? rest.reduce((a, b) => a + b, 0) / rest.length : 0;
  const composite = TEAM_WEIGHTS.ace * pool[0] + TEAM_WEIGHTS.second * pool[1] + TEAM_WEIGHTS.rest * restAvg;
  return researchers.length > 0 ? composite : composite * 0.7;
}

/** market id から決定論的オフセット [-0.5,0.5]（開示値の中央を真値からずらす）。 */
function idOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

/**
 * 分析完了時の開示値を確定する（真値に research 依存の誤差を乗せる・§3.3）。
 * @param baseError 基礎誤差（±比率）
 * @param analystSkill 分析スキル（着手時に固定）
 */
export function discloseValues(
  market: MarketState, era: Era, seed: number, baseError: number, analystSkill: number
): { M: number; densityIndex: number; errorPct: number } {
  const errorPct = baseError * accuracyFactor(analystSkill);
  // 開示する規模は「実効パイ M_eff」（今この市場で取れる金額）
  const trueM = marketEff({ sector: market.sector, country: market.country, biasFactor: market.biasFactor, maturity: market.maturity }, era);
  const trueD = densityOf(market.maturity, seed, market.sector, market.country);
  const off = idOffset(market.id) * errorPct; // 中央を真値から ±0.5*err ずらす（真値はレンジ内に残る）
  return {
    M: Math.max(0, trueM * (1 + off)),
    densityIndex: Math.max(0, trueD * (1 + off)),
    errorPct,
  };
}

/** レンジ [low, high]（開示値±誤差）。 */
export function analyzedRange(center: number, errorPct: number): { low: number; high: number } {
  return { low: center * (1 - errorPct), high: center * (1 + errorPct) };
}

/**
 * 自社フィット fit_p（§3.5）。その市場に青写真pと現有人材を当てた予測上限シェア。
 * 製品が既にあればその QUAL_p、無ければ「今launchしたら」の仮QUAL_p（devTurns0）で試算。
 * 青写真未保有なら null（＝取得が必要）。
 */
export function fitP(
  market: MarketState, company: ProtoCompany, team: Person[], era: Era, seed: number,
  existingProduct: Product | null
): number | null {
  const bp = blueprintForSector(market.sector);
  if (!bp || !company.unlockedBlueprints.includes(bp.id)) return null; // 青写真未保有（切符なし）
  const tier = sectorTier(market.sector, company.unlockedBlueprints);
  const qualP = existingProduct
    ? existingProduct.QUAL_p
    : computeQualP(bp.id, team, 0, era, tier); // 仮に今launchした場合（tier天井込み）
  const cP = productCompetitiveness(qualP, team, company, tier);
  const sumCr = marketRivalComp(market, era, seed);
  return earnedShareCap(cP, sumCr);
}

/** 機会スコア（規模÷競合×自社フィット・§3.6・表示0-100）。 */
export function opportunityScore(M: number, sumCr: number, fit: number | null): number {
  if (fit == null) return 0;
  const raw = (M / (sumCr + C_OPEN)) * fit;
  return clamp(raw * 2, 0, 100);
}

/** その青写真をこの市場に出せるか（保有＋セクター一致）。 */
export function canServe(bp: ProtoBlueprint | undefined, company: ProtoCompany, sector: string): boolean {
  return !!bp && bp.targetSector === sector && company.unlockedBlueprints.includes(bp.id);
}
