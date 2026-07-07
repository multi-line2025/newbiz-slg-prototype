/**
 * ======================================================================
 *  product.ts  製品QUAL_p（青写真ごとの製品品質）（§2）
 * ----------------------------------------------------------------------
 *  会社単一QUAL → 青写真ごとの製品QUALへ拡張。
 *  QUAL_p は「その青写真が定める担当職業の能力」の加重合成で決まる（要望③）。
 *   例：福祉(BP-510)=セールスのsales能力、生成AI(BP-450)=リサーチのresearch能力。
 * ======================================================================
 */

import type { Person, Era, JobCategory } from "./model/types";
import type { OccupationalAttributes, MentalAttributes } from "./model/types";
import {
  TEAM_WEIGHTS, QUAL_POLISH_MIN, QUAL_POLISH_MAX, DEV_RAMP, ERA_OBSOLETE,
  QUAL_TIER_CAP, DEV_SPEC_K,
} from "./model/constants";
import { getBlueprint, eraIndex, type ProtoBlueprint } from "./research";
import { activityCoeff } from "./market";
import { clamp } from "./util";

/**
 * §2.3-1 役割ごとのチーム実効能力 A(role, ability)。
 * その役割に配属した社員の当該能力（稼働係数込み）を降順に 0.6/0.25/0.15 で合成。
 * 配属者0人なら0（その製品は作れない）。
 */
export function teamAbility(team: Person[], role: JobCategory, ability: keyof OccupationalAttributes): number {
  const vals = team
    .filter((p) => p.assignedRole === role)
    .map((p) => p.attributes.occupational[ability] * activityCoeff(p))
    .sort((a, b) => b - a);
  if (vals.length === 0) return 0;
  if (vals.length === 1) return vals[0];
  const ace = vals[0];
  const second = vals[1];
  const rest = vals.slice(2);
  const restAvg = rest.length > 0 ? rest.reduce((a, b) => a + b, 0) / rest.length : 0;
  return TEAM_WEIGHTS.ace * ace + TEAM_WEIGHTS.second * second + TEAM_WEIGHTS.rest * restAvg;
}

/** §2.3-2 品質規定式の加重合成（0〜1）。 */
export function qualComposite(bp: ProtoBlueprint, team: Person[]): number {
  let composite = 0;
  for (const term of bp.qualFormula) {
    composite += term.weight * (teamAbility(team, term.role, term.ability) / 20);
  }
  return clamp(composite, 0, 1);
}

/** §2.3-3 副参照能力の磨き上げ（±15%）。副参照は「その製品に配属した全社員の平均」。 */
export function qualPolish(bp: ProtoBlueprint, team: Person[]): number {
  if (team.length === 0) return QUAL_POLISH_MIN;
  const abilities = bp.qualPolishAbilities;
  let sum = 0;
  let n = 0;
  for (const p of team) {
    for (const ab of abilities) {
      sum += p.attributes.mental[ab as keyof MentalAttributes] * activityCoeff(p);
      n++;
    }
  }
  const subAvg = n > 0 ? sum / n : 0;
  return clamp(QUAL_POLISH_MIN + 0.3 * (subAvg / 20), QUAL_POLISH_MIN, QUAL_POLISH_MAX);
}

/** §2.3-4／§5.2 開発成熟（devTurns 蓄積で 0.5→1.0）。tierが深いほど立ち上げが速い（DEV_RAMP_eff）。 */
export function devMaturity(devTurns: number, tier = 1): number {
  const ramp = DEV_RAMP * (1 - DEV_SPEC_K * (Math.max(1, tier) - 1));
  return clamp(0.5 + 0.5 * Math.min(1, devTurns / Math.max(1, ramp)), 0.5, 1.0);
}

/** §2.3-4 時代適合（旧世代の青写真はEra差で頭打ち＝陳腐化）。 */
export function eraFit(bp: ProtoBlueprint, era: Era): number {
  const gap = Math.max(0, eraIndex(era) - eraIndex(bp.requiredEra));
  return Math.pow(ERA_OBSOLETE, gap);
}

/** §5.2 tier別のQUAL_p天井（tier1=55…tier4=100）。 */
export function tierCap(tier: number): number {
  return QUAL_TIER_CAP[clamp(Math.max(1, tier), 1, QUAL_TIER_CAP.length) - 1];
}

/**
 * §2.3-5／§5.2 製品QUAL_p（0-100）。担当チーム・開発成熟・時代適合の合成に tier天井を適用。
 * @param tier そのセクターの到達tier（1..4）。汎用tier1は中品質止まり、特化tier4で100到達可。
 */
export function computeQualP(blueprintId: string, team: Person[], devTurns: number, era: Era, tier = 1): number {
  const bp = getBlueprint(blueprintId);
  if (!bp) return 0;
  const composite = qualComposite(bp, team);
  const polish = qualPolish(bp, team);
  const maturity = devMaturity(devTurns, tier);
  const fit = eraFit(bp, era);
  const base = 100 * composite * polish * maturity * fit;
  return clamp(Math.min(base, tierCap(tier)), 0, 100);
}
