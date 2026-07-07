/**
 * ======================================================================
 *  salary.ts  実効要求給与（仕様 §4.3 / §12.2 / 数値定義書 §2.1）
 * ----------------------------------------------------------------------
 *  実効要求給与 = 基準給与 ×(1 − 忠誠オフセット)× 国別最低賃金係数
 *   - 基準給与     : §12.2 の職種×CA帯テーブル
 *   - 忠誠オフセット: (loyalty − 10)/10 × 0.15  ← 忠誠が高いほど安く働く
 *   - 国別最低賃金 : 数値定義書 §2.1（US1.0 / JP0.70 / DE0.88 / GB0.85 / SG0.92）
 * ======================================================================
 */

import type { Person, JobCategory, PlayableCountry } from "./model/types";
import {
  BASE_SALARY_BY_JOB,
  LOYALTY_OFFSET_K,
  COUNTRY_FACTORS,
} from "./model/constants";

/** CAから給与帯の基準額を引く（§12.2）。CA≤100=駆け出し / ≤150=中堅 / それ以上=エース。 */
export function baseSalary(job: JobCategory, CA: number): number {
  const tier = BASE_SALARY_BY_JOB[job];
  if (CA <= 100) return tier.rookie;
  if (CA <= 150) return tier.mid;
  return tier.ace;
}

/** 忠誠オフセット（§4.3）。loyalty20→+0.15（15%安い）、loyalty1→−0.135（要求増）。 */
export function loyaltyOffset(loyalty: number): number {
  return ((loyalty - 10) / 10) * LOYALTY_OFFSET_K;
}

/**
 * 実効要求給与（§4.3 本式）。
 * @param job 職種
 * @param CA 現在能力
 * @param loyalty 忠誠(1-20)
 * @param country 起業国（最低賃金係数の適用先）
 */
export function effectiveSalary(
  job: JobCategory,
  CA: number,
  loyalty: number,
  country: PlayableCountry
): number {
  const base = baseSalary(job, CA);
  const offset = loyaltyOffset(loyalty);
  const minWage = COUNTRY_FACTORS[country].minWage;
  return Math.round(base * (1 - offset) * minWage);
}

/** Person から実効要求給与を求める（buildPerson・採用時に使用）。 */
export function personSalaryDemand(p: Person, country: PlayableCountry): number {
  return effectiveSalary(p.jobCategory, p.CA, p.attributes.hidden.loyalty, country);
}
