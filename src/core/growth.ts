/**
 * ======================================================================
 *  growth.ts  能力値の成長・減衰（仕様 §4.7 / 数値定義書 §1）
 * ----------------------------------------------------------------------
 *  Δattr = base_cat × 年齢係数_cat(age) × 伸びしろ係数 × 人格係数 × 環境係数 × 使用係数
 *
 *  ★重要（数値定義書 §1.7 実装注記）:
 *    年齢係数が負（＝減衰regime）の局面では、伸びしろ係数(PA-CA)/PA を 1.0固定 にする。
 *    そうしないと CA が PA に近いとき (PA-CA)/PA≒0 で減衰が消えてしまい、
 *    ベテランの「衰え」が表現できない。人格ドリフトも伸びしろ非依存。
 * ======================================================================
 */

import type { Person, Attributes } from "./model/types";
import {
  BASE_BY_CAT,
  AGE_CURVE,
  AGE_AMBITION_WEIGHT,
  USE_FACTOR,
  type GrowthCategory,
} from "./model/constants";
import { clamp, interpolateCurve } from "./util";
import { computeCA } from "./person";

/** 成長環境コンテキスト（プロトタイプ簡易版）。 */
export interface EnvContext {
  /** 環境係数 0.5〜1.5（メンター/研修/文化/士気/負荷の合成・数値定義書 §1.5）。 */
  factor: number;
}

/** 士気(morale)から簡易的に環境係数を算出（数値定義書 §1.5 の士気項のみ抜粋）。 */
export function envFromMorale(morale: number): EnvContext {
  // 士気寄与 = (morale-50)/50 × 0.15 を中立1.0に加算し [0.5,1.5] でクランプ
  const contribution = ((morale - 50) / 50) * 0.15;
  return { factor: clamp(1.0 + contribution, 0.5, 1.5) };
}

/** ageAmbitionWeight(age)（数値定義書 §1.3）。 */
export function ageAmbitionWeight(age: number): number {
  return interpolateCurve(AGE_AMBITION_WEIGHT, age);
}

/**
 * 人格係数（数値定義書 §1.4・仕様確定式）。
 * = clamp(0.5 + (professionalism×0.4 + determination×0.3 + (ambition×ageWeight)×0.3)/20, 0.5, 1.5)
 */
export function personaFactor(p: Person): number {
  const A = p.attributes;
  const ambAge = A.mental.ambition * ageAmbitionWeight(p.age);
  const raw =
    0.5 +
    (A.hidden.professionalism * 0.4 + A.mental.determination * 0.3 + ambAge * 0.3) / 20;
  return clamp(raw, 0.5, 1.5);
}

/**
 * 1能力カテゴリ・1ターンの成長Δ（数値定義書 §1 の合成式）。
 * @param useF 使用係数（1.0=実務で使う / 0.6=副次 / 0.3=不使用）
 * @returns 各能力値（1-20スケール）に加算するΔ。負なら減衰。
 */
export function growthDelta(
  p: Person,
  cat: GrowthCategory,
  env: EnvContext,
  useF: number
): number {
  const base = BASE_BY_CAT[cat];
  const ageF = interpolateCurve(AGE_CURVE[cat], p.age);

  // 伸びしろ係数。★減衰regime（ageF<0）または人格カテゴリでは 1.0 固定（§1.7）
  let headroom: number;
  if (ageF < 0 || cat === "hidden") {
    headroom = 1.0;
  } else {
    headroom = p.PA > 0 ? clamp((p.PA - p.CA) / p.PA, 0, 1) : 0;
  }

  const persona = personaFactor(p);
  return base * ageF * headroom * persona * env.factor * useF;
}

/**
 * 1人の能力値を1ターン分成長（or減衰）させ、CAを再算出した新しい Person を返す。
 * 純粋関数：元の person は書き換えず、更新後の person を返す。
 * プロトタイプでは 3つの可視カテゴリ（専門技能・メンタル・コンディション）を成長対象とし、
 * 使用係数は一律 USE_FACTOR.primary（＝在籍社員は実務で能力を使う想定）を用いる。
 */
export function applyGrowth(p: Person, env: EnvContext): Person {
  const cats: GrowthCategory[] = ["occupational", "mental", "condition"];
  const attrs: Attributes = {
    occupational: { ...p.attributes.occupational },
    mental: { ...p.attributes.mental },
    condition: { ...p.attributes.condition },
    hidden: { ...p.attributes.hidden },
  };

  for (const cat of cats) {
    const delta = growthDelta(p, cat, env, USE_FACTOR.primary);
    const group = attrs[cat] as unknown as Record<string, number>;
    for (const key of Object.keys(group)) {
      // Δを加算し、1-20 にクランプ（PA上限は computeCA後のCAでは自然に効く）
      group[key] = clamp(group[key] + delta, 1, 20);
    }
  }

  const updated: Person = { ...p, attributes: attrs };
  // Δ適用後は必ずCAを再算出（数値定義書 §1.7 / 仕様 §4.5）。CA ≤ PA を保証。
  updated.CA = Math.min(computeCA(attrs), p.PA);
  return updated;
}
