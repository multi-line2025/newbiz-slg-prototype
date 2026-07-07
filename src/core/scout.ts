/**
 * ======================================================================
 *  scout.ts  スカウト段階開示（仕様 §4.8 / 数値定義書 §3）
 * ----------------------------------------------------------------------
 *  scoutLevel 0→1→2 で見える情報が増える。
 *   - level0: 専門技能の粗い星のみ（PA・人格は不明）
 *   - level1: PA・人格を「レンジ表示」（担当スキル依存の誤差幅・ぼやけ）
 *   - level2: 正確値
 *  誤差式（§3.2）: 実誤差 = 基礎誤差 × 精度係数
 *              精度係数 = clamp(1.5 − 調査担当スキル/20, 0.5, 1.45)
 *              調査担当スキル = max(担当者.management, 担当者.research)
 * ======================================================================
 */

import type { Person } from "./model/types";
import { SCOUT_STEPS } from "./model/constants";
import { clamp } from "./util";

/** 精度係数（§3.2）。担当スキルが高いほど誤差が縮む。 */
export function accuracyFactor(scoutSkill: number): number {
  return clamp(1.5 - scoutSkill / 20, 0.5, 1.45);
}

/**
 * person.id から決定論的なオフセット比率[-0.5,0.5]を作る（再現性・§2.5）。
 * レンジの中心を真値からずらし、プレイヤーが「中央＝真値」と決め打ちできないようにする。
 */
function idOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return ((h >>> 0) % 1000) / 1000 - 0.5; // [-0.5, 0.5)
}

/** レンジ [low, high]。真値は必ず範囲内に含まれる。 */
export interface Range {
  low: number;
  high: number;
}

/** 真値 true を、誤差 error・id由来オフセットでぼかしたレンジにする。 */
export function blurToRange(trueVal: number, error: number, id: string, lo: number, hi: number): Range {
  const center = trueVal + idOffset(id) * error; // 中心を最大±0.5*error ずらす（真値は範囲内に残る）
  return {
    low: Math.round(clamp(center - error, lo, hi)),
    high: Math.round(clamp(center + error, lo, hi)),
  };
}

/** UIに渡す「見えている情報」。scoutLevel でゲートされる。 */
export interface ScoutView {
  scoutLevel: 0 | 1 | 2;
  occStars: number; // 専門技能の粗い星 1-5（全レベルで可視）
  caKnown: number | null; // ★オーナー要望：未スカウト(level0)ではCAも非表示。level1以上で開示
  paKnown: number | null; // level2でのみ正確値
  paRange: Range | null; // level1でのレンジ
  loyaltyKnown: number | null; // level2
  loyaltyRange: Range | null; // level1
  controversyKnown: number | null; // level2（不祥事リスクの目安）
}

/** 専門技能の平均から粗い星（1-5）を出す。 */
export function occStars(p: Person): number {
  const occ = Object.values(p.attributes.occupational);
  const avg = occ.reduce((a, b) => a + b, 0) / occ.length; // 1-20
  return clamp(Math.round(avg / 4), 1, 5);
}

/**
 * 候補者の見えている情報を組み立てる。
 * @param scoutSkill 調査担当のスキル（max(management, research)）
 */
export function scoutedView(p: Person, scoutSkill: number): ScoutView {
  const level = p.scoutLevel;
  const stars = occStars(p);

  if (level === 0) {
    // ★未スカウト：専門技能の粗い星のみ。CA・PA・人格は一切不明（オーナー要望）
    return {
      scoutLevel: 0,
      occStars: stars,
      caKnown: null,
      paKnown: null, paRange: null,
      loyaltyKnown: null, loyaltyRange: null,
      controversyKnown: null,
    };
  }

  if (level === 1) {
    // 簡易スカウト：CAは開示（現在能力は接触で見抜ける）、PA・忠誠はぼやけレンジ
    const f = accuracyFactor(scoutSkill);
    const paErr = SCOUT_STEPS[0].baseErrorPA * f;
    const perErr = SCOUT_STEPS[0].baseErrorPersona * f;
    return {
      scoutLevel: 1,
      occStars: stars,
      caKnown: p.CA,
      paKnown: null,
      paRange: blurToRange(p.PA, paErr, p.id + "PA", 1, 200),
      loyaltyKnown: null,
      loyaltyRange: blurToRange(p.attributes.hidden.loyalty, perErr, p.id + "LO", 1, 20),
      controversyKnown: null,
    };
  }

  // level 2：正確値
  return {
    scoutLevel: 2,
    occStars: stars,
    caKnown: p.CA,
    paKnown: p.PA,
    paRange: null,
    loyaltyKnown: p.attributes.hidden.loyalty,
    loyaltyRange: null,
    controversyKnown: p.attributes.hidden.controversy,
  };
}
