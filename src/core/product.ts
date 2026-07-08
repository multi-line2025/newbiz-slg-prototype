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
  LABOR_QUAL_BASE, LABOR_TIER_CAP, KLABOR_CONS, KLABOR_MGMT_Q, KLABOR_MGMT,
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

/* ============================================================
 * 労働集約型の産出モデル（設計提案§3・v0.8）
 * ----------------------------------------------------------------
 *  知識集約が「エース加重の技能合成」なのに対し、労働集約は
 *  「頭数×基礎資質の線形和（スループット）」で決まる。一般人材が主役。
 * ============================================================ */

/**
 * §3.1 基礎資質 baseAptitude（0..1）。単純作業をコツコツ回す資質。
 *  ＝(体力+健康+協調性+一貫性)/(4×20)。CA/PA・職業技能に依存しない
 *  （＝評判ゲートで届く“質”が低い一般人材でも高くなり得る属性群）。
 */
export function baseAptitude(p: Person): number {
  const a = p.attributes;
  return (a.condition.stamina + a.condition.health + a.mental.teamwork + a.hidden.consistency) / (4 * 20);
}

/**
 * §3.1 スループット（労働キャパシティの素）。配属者を“全員フル計上”で線形和。
 *  ＝Σ baseAptitude(p) × activityCoeff(p)。頭数がそのまま戦力になる。
 */
export function laborThroughput(team: Person[]): number {
  return team.reduce((sum, p) => sum + baseAptitude(p) * activityCoeff(p), 0);
}

/** チーム中の最良 management（現場管理の乗数用・0..20）。 */
function bestManagement(team: Person[]): number {
  return team.reduce((m, p) => Math.max(m, p.attributes.occupational.management), 0);
}

/** チームの平均 consistency（一貫性・0..20）。 */
function avgConsistency(team: Person[]): number {
  if (team.length === 0) return 0;
  return team.reduce((s, p) => s + p.attributes.hidden.consistency, 0) / team.length;
}

/** §3.2 現場管理の乗数 mgmtMult ＝ 1 + KLABOR_MGMT × (bestManagement/20)。 */
export function mgmtMult(team: Person[]): number {
  return 1 + KLABOR_MGMT * (bestManagement(team) / 20);
}

/** §3.1-3.2 労働キャパシティ ＝ スループット × 現場管理乗数（＝頭数×資質×まとめ役）。 */
export function laborCapacity(team: Person[]): number {
  return laborThroughput(team) * mgmtMult(team);
}

/** §3.3 労働集約の製品QUAL_p（低い床に固定＝“効くレバー帯”に収める・低天井）。 */
export function computeQualPLabor(team: Person[]): number {
  const q = LABOR_QUAL_BASE
    + KLABOR_CONS * (avgConsistency(team) / 20)     // 現場の一貫性で微増
    + KLABOR_MGMT_Q * (bestManagement(team) / 20);  // 現場管理で微増
  return clamp(q, 0, LABOR_TIER_CAP);
}

/**
 * §2.3-5／§5.2 製品QUAL_p（0-100）。業態(archetype)で分岐。
 *  labor＝頭数スループット由来の低い床固定QUAL、knowledge＝現行のエース加重合成×tier天井。
 * @param tier そのセクターの到達tier（1..4・knowledgeのみ）。汎用tier1は中品質止まり。
 */
export function computeQualP(blueprintId: string, team: Person[], devTurns: number, era: Era, tier = 1): number {
  const bp = getBlueprint(blueprintId);
  if (!bp) return 0;
  if (bp.archetype === "labor") return computeQualPLabor(team); // 労働集約は専用式
  const composite = qualComposite(bp, team);
  const polish = qualPolish(bp, team);
  const maturity = devMaturity(devTurns, tier);
  const fit = eraFit(bp, era);
  const base = 100 * composite * polish * maturity * fit;
  return clamp(Math.min(base, tierCap(tier)), 0, 100);
}
