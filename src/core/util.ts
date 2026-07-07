/**
 * ======================================================================
 *  util.ts  core 共通の小さな純粋関数
 * ======================================================================
 */

import type { CurvePoint } from "./model/constants";

/** 値を [min, max] に収める。 */
export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/** 数値配列の合計。 */
export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/**
 * 折れ線カーブを線形補間して age に対応する係数を返す。
 * 表の範囲外は端の値でクランプ（左端より若ければ左端値、右端より上なら右端値）。
 * 成長の年齢係数・成熟度カーブ・野心重みで共通利用する（数値定義書 §1.2 等）。
 */
export function interpolateCurve(curve: CurvePoint[], age: number): number {
  if (curve.length === 1) return curve[0].value;
  if (age <= curve[0].age) return curve[0].value;
  const last = curve[curve.length - 1];
  if (age >= last.age) return last.value;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (age >= a.age && age <= b.age) {
      const t = (age - a.age) / (b.age - a.age);
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}
