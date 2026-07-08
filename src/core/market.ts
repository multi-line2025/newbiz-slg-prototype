/**
 * ======================================================================
 *  market.ts  多市場・製品ベースのシェア争奪モデル
 *              （市場成長モデルv0.1 ＋ 市場分析製品品質モデルv0.1）
 * ----------------------------------------------------------------------
 *  各製品は 1市場（セクター×国）で、有限パイのシェアをライバルと奪い合う。
 *  C_p の QUAL項は「その製品の QUAL_p」で決まる（§2.4）。
 *  sticky（品質・口コミ・セールス・コミュニティ由来・減衰遅）＋
 *  paid（広告由来・減衰速＝賃借）。すべて純粋関数（rng不使用＝決定論）。
 * ======================================================================
 */

import type { Person, PlayableCountry, Era } from "./model/types";
import type { ProtoCompany, NearRival, MarketState, Product } from "./state";
import {
  ARPU_SALES_PREMIUM, SALES_UNIT_PRICE, COUNTRY_FACTORS,
  Q_BASE, Q_SLOPE, KCOMP_SALES, KCOMP_TH, TH_REF, KCOMP_REP,
  SCALE_STRENGTH, SECTOR_MATCH, C_OPEN, REACH_AMP, FAR_PRESSURE,
  KAD, KPR, KREP_ORG, KSALES, KCOMM_TH, KCOMM_S,
  QUAL_AD_BACKFIRE, QUAL_AD_FIT_FULL, BACKFIRE_K, BACKFIRE_TH,
  DECAY_PAID, DECAY_STICKY, ERODE_STICKY, RIVAL_GROWTH, SPEC_CP_K,
  QLABOR_CORE, KLABOR_TH,
} from "./model/constants";
import { densityOf, marketEff } from "./markets";
import { clamp } from "./util";

/* ============================================================
 * 基本形状・力（§4.3 / §4.6）
 * ============================================================ */

/**
 * QUAL依存の口コミ形状（§4.3・v0.7.2で崖を撤去）。
 * QUAL<40で0、40〜70で緩やかに0→2.5、70超で加速。
 * これで tier1(天井62)の創業製品でも口コミ圏に入れる（旧60の崖を解消）。
 */
export function wordOfMouthTrac(qual: number): number {
  if (qual < 40) return 0;
  if (qual <= 70) return ((qual - 40) / 30) * 2.5;
  return 2.5 + ((qual - 70) / 30) * 3.0;
}

/** 稼働係数：過労・病欠で低下（§4.6）。 */
export function activityCoeff(p: Person): number {
  const st = p.attributes.condition.stamina / 20;
  const he = p.attributes.condition.health / 20;
  return clamp(0.6 + 0.4 * st * he, 0.6, 1.0);
}

/** セールス実効頭数 salesForce ＝ Σ_{sales配属}(sales/20)×稼働（§4.4）。 */
export function salesForce(team: Person[]): number {
  let f = 0;
  for (const e of team) {
    if (e.assignedRole === "sales") f += (e.attributes.occupational.sales / 20) * activityCoeff(e);
  }
  return f;
}

/** マーケ実効頭数 marketerForce ＝ Σ_{marketer配属}(marketing/20)（§4.2）。 */
export function marketerForce(team: Person[]): number {
  let f = 0;
  for (const e of team) {
    if (e.assignedRole === "marketer") f += e.attributes.occupational.marketing / 20;
  }
  return f;
}

/** 国別の市場規模係数（数値定義§2.1・UI/互換用）。 */
export function marketSizeFactor(country: PlayableCountry): number {
  return COUNTRY_FACTORS[country].marketSize;
}

/* ============================================================
 * 競争力と上限シェア（§3・§2.4）
 * ============================================================ */

/** QUALcore ＝ 品質を競争力の芯にする（QUAL0→0.4, QUAL100→1.0）。 */
export function qualCore(qual: number): number {
  return Q_BASE + Q_SLOPE * (qual / 100);
}

/**
 * 製品競争力 C_p（§2.4＋動的§5.2＋v0.8 業態分岐）。
 *  knowledge：QUAL主導（qualCore）×セールス×THxP×評判×tier特化ボーナス（現行）。
 *  labor：頭数主導。QLABOR_CORE×(1+KLABOR_TH×laborCap)×評判（qualCore/sales/THxP/tierは無効）。
 * @param tier knowledgeのtier（1..4）
 * @param archetype 業態（labor は頭数スループット主導）
 * @param laborCap 事前計算した laborCapacity（labor時のみ使用・循環import回避のため引数で受ける）
 */
export function productCompetitiveness(
  qualP: number, team: Person[], company: ProtoCompany,
  tier = 1, archetype: "knowledge" | "labor" = "knowledge", laborCap = 0
): number {
  if (archetype === "labor") {
    return (
      QLABOR_CORE *
      (1 + KLABOR_TH * laborCap) *
      (1 + KCOMP_REP * (company.reputation / 100))
    );
  }
  const specBonus = 1 + SPEC_CP_K * (Math.max(1, tier) - 1);
  return (
    qualCore(qualP) *
    (1 + KCOMP_SALES * salesForce(team)) *
    (1 + KCOMP_TH * Math.min(1, company.THxP_customer / TH_REF)) *
    (1 + KCOMP_REP * (company.reputation / 100)) *
    specBonus
  );
}

/** ライバル1社の競争力 C_r_i（§3.2・§1.3）。sectorは市場内なので"same"=1.0。 */
export function rivalCompetitiveness(r: NearRival): number {
  const scale = SCALE_STRENGTH[clamp(r.scaleTier, 0, SCALE_STRENGTH.length - 1)];
  const aggr = clamp(r.aggression + (r.ambitionFocus === "share" ? 0.2 : 0), 0, 1);
  const sectorMatch = SECTOR_MATCH[r.sector];
  return scale * (0.6 + 0.1 * r.reputationTier) * (0.7 + 0.6 * aggr) * sectorMatch;
}

/**
 * 市場のライバル競争力合計 ΣC_r（§1.3＋動的§2.2）。
 * near群は実頭数で保持するため合計をそのまま用い、farPressure×密度(成熟度アンカー)を加える。
 */
export function marketRivalComp(market: MarketState, _era: Era, seed: number): number {
  const density = densityOf(market.maturity, seed, market.sector, market.country);
  const nearSum = market.nearRivals.reduce((s, r) => s + rivalCompetitiveness(r), 0);
  return nearSum + FAR_PRESSURE[market.country] * density;
}

/** 稼いだ上限シェア s*_earned（§3.3）。 */
export function earnedShareCap(cP: number, sumCr: number): number {
  return cP / (cP + sumCr + C_OPEN);
}

/** 到達上限シェア s*_reach（QUALで頭打ち・§3.3）。 */
export function reachShareCap(qual: number, sEarned: number): number {
  return Math.min(qual / 100, sEarned * REACH_AMP);
}

/** 広告のQUAL適合度倍率（40未満は0＝逆噴射帯・§5.1）。 */
export function qualAdFit(qual: number): number {
  if (qual < QUAL_AD_BACKFIRE) return 0;
  if (qual <= QUAL_AD_FIT_FULL) return (qual - QUAL_AD_BACKFIRE) / (QUAL_AD_FIT_FULL - QUAL_AD_BACKFIRE);
  return 1.0 + (qual - QUAL_AD_FIT_FULL) / 75;
}

/* ============================================================
 * 製品×市場の1ターン更新（§7 C工程を1製品ぶん）
 * ============================================================ */

export interface ProductStepResult {
  product: Product; // 更新後（sticky/paid）
  nearRivals: NearRival[]; // 更新後（share・内生成長）
  dTHxP: number; // 顧客THxPの増減（会社共有へ加算）
  events: string[];
  info: { M: number; cP: number; sumCr: number; sEarned: number; sReach: number; TRAC: number };
}

/**
 * 1製品×その市場の1ターン更新（設計書§5-C／市場成長モデル§4〜6）。
 * product.QUAL_p は前段（§2.3）で確定済みの値を用いる。
 */
export function stepProductMarket(
  product: Product,
  team: Person[],
  market: MarketState,
  company: ProtoCompany,
  era: Era,
  seed: number,
  tier = 1,
  archetype: "knowledge" | "labor" = "knowledge",
  laborCap = 0
): ProductStepResult {
  const events: string[] = [];
  const M = marketEff({ sector: market.sector, country: market.country, biasFactor: market.biasFactor, maturity: market.maturity }, era);

  const qualP = product.QUAL_p;
  const cP = productCompetitiveness(qualP, team, company, tier, archetype, laborCap);
  const sumCr = marketRivalComp(market, era, seed);
  const sEarned = earnedShareCap(cP, sumCr);
  const sReach = reachShareCap(qualP, sEarned);
  const tracNow = product.sticky + product.paid;
  const s = tracNow / 100;

  const roomEarned = sEarned > 0 ? clamp((sEarned - s) / sEarned, 0, 1) : 0;
  const roomReach = sReach > 0 ? clamp((sReach - s) / sReach, 0, 1) : 0;

  let dPaid = 0, dSticky = 0, dStickySales = 0, dTHxP = 0;

  // 広告（§4.2/§5.2）
  const uAd = product.adBudget / 1000;
  if (uAd > 0) {
    if (qualP < QUAL_AD_BACKFIRE) {
      const backfire = Math.sqrt(uAd) * (QUAL_AD_BACKFIRE - qualP) / QUAL_AD_BACKFIRE;
      dSticky -= BACKFIRE_K * backfire;
      dTHxP -= BACKFIRE_TH * backfire;
      events.push(`⚠ ${market.id}：低品質(QUAL_p${qualP.toFixed(0)})への広告が逆噴射。`);
    } else {
      const fit = qualAdFit(qualP);
      dPaid += KAD * Math.sqrt(uAd) * fit * (1 + 0.3 * marketerForce(team)) * roomReach;
    }
  }
  // PR/口コミ（§4.3）
  const uPr = product.prBudget / 1000;
  const womQ = wordOfMouthTrac(qualP);
  if (womQ > 0) {
    // v0.7.2：種火要件を緩やかに（0.3+0.7×TRAC → 0.55+0.45×TRAC）。
    // TRACゼロ近傍でも口コミが立ち上がり、初製品が軌道に乗れるように。
    dSticky += KPR * womQ *
      (0.55 + 0.45 * (tracNow / 100)) *
      (0.5 + 0.5 * Math.min(1, company.THxP_customer / TH_REF)) *
      (1 + KREP_ORG * (company.reputation / 100)) *
      (1 + 0.5 * uPr) * roomEarned;
  }
  // セールス直販（§4.4）
  const sForce = salesForce(team);
  if (sForce > 0) {
    const aSales = KSALES * sForce * (0.7 + 0.3 * (qualP / 100)) * roomEarned;
    dSticky += aSales;
    dStickySales += aSales;
  }
  // コミュニティ/THxP（§4.5）
  const uComm = product.commBudget / 1000;
  if (uComm > 0) {
    dTHxP += KCOMM_TH * uComm;
    dSticky += KCOMM_S * uComm * roomEarned;
  }

  // 減衰（§6.1）
  let paid = product.paid * (1 - DECAY_PAID);
  let sticky = product.sticky - DECAY_STICKY * product.sticky;
  let stickySales = product.stickySales * (1 - DECAY_STICKY);

  // ライバル奪還（§6.2）
  if (sticky / 100 > sEarned) {
    const erode = ERODE_STICKY * (sticky - sEarned * 100);
    sticky -= erode;
    stickySales = Math.max(0, stickySales - erode * (stickySales / Math.max(1, sticky + erode)));
  }

  // 加算＆確定（§6.3）
  sticky = clamp(sticky + dSticky, 0, sEarned * 100);
  stickySales = clamp(stickySales + dStickySales, 0, sticky);
  const headroom = Math.max(0, sReach * 100 - sticky);
  paid = clamp(paid + dPaid, 0, headroom);
  const TRAC = clamp(sticky + paid, 0, 100);

  // ライバル内生成長（§6.2）
  const nextRivals = market.nearRivals.map((r) => {
    const rShare = rivalCompetitiveness(r) / (cP + sumCr + C_OPEN);
    let growthProgress = r.growthProgress + rShare * RIVAL_GROWTH;
    let scaleTier = r.scaleTier;
    if (growthProgress >= 1 && scaleTier < 4) {
      scaleTier += 1;
      growthProgress -= 1;
    }
    return { ...r, share: rShare, scaleTier, growthProgress };
  });

  const nextProduct: Product = { ...product, sticky, paid, stickySales };
  return {
    product: nextProduct,
    nearRivals: nextRivals,
    dTHxP,
    events,
    info: { M, cP, sumCr, sEarned, sReach, TRAC },
  };
}

/* ============================================================
 * 売上（§2.1・市場ごと・合算は turn/finance で）
 * ============================================================ */

/** 製品のセールス由来シェア比率。 */
export function salesShareFrac(product: Product): number {
  const trac = product.sticky + product.paid;
  if (trac <= 0) return 0;
  return clamp(product.stickySales / trac, 0, 1);
}

/** 1製品の月次売上 ＝ s × M_eff × ARPU ×(1+プレミアム)（§2.1・M→M_eff差し替え）。 */
export function productRevenue(product: Product, market: MarketState, era: Era): number {
  const M = marketEff({ sector: market.sector, country: market.country, biasFactor: market.biasFactor, maturity: market.maturity }, era);
  const s = (product.sticky + product.paid) / 100;
  const premium = 1 + ARPU_SALES_PREMIUM * salesShareFrac(product);
  return s * M * SALES_UNIT_PRICE * premium;
}
