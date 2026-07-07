/**
 * ======================================================================
 *  prng.ts  シード付き擬似乱数生成器（mulberry32）
 * ----------------------------------------------------------------------
 *  技術設計書 §1.1「乱数＝シード付きPRNG（再現性）」に対応。
 *  同じ seed からは必ず同じ乱数列が出る＝セーブ/リプレイの再現性を担保する。
 *  core は副作用を持たないため、乱数はこの PRNG を「引数で渡して」使う。
 * ======================================================================
 */

/** PRNG インターフェース。core の純粋関数はこれを受け取って乱数を使う。 */
export interface PRNG {
  /** 次の一様乱数 [0,1) を返す（内部状態を進める）。 */
  next(): number;
  /** [min, max) の一様乱数（小数）。 */
  float(min: number, max: number): number;
  /** [min, max] の一様整数。 */
  int(min: number, max: number): number;
  /** 確率 p (0-1) で true を返す。 */
  chance(p: number): boolean;
  /** 平均 mean・標準偏差 std の正規乱数（Box-Muller 法）。 */
  normal(mean: number, std: number): number;
  /** [0.95, 1.05] のような小さなノイズ係数を返す（生成時CAの個体差用）。 */
  noise(spread: number): number;
  /** 次ターン用に新しい seed を吐き出す（advanceTurn で seed を進める）。 */
  nextSeed(): number;
}

/**
 * mulberry32：軽量で質の良い 32bit シード PRNG。
 * @param seed 初期シード（整数）
 */
export function makePRNG(seed: number): PRNG {
  // 内部状態（32bit 符号なし整数として扱う）
  let state = seed >>> 0;

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);

  const int = (min: number, max: number): number =>
    Math.floor(min + next() * (max - min + 1));

  const chance = (p: number): boolean => next() < p;

  const normal = (mean: number, std: number): number => {
    // Box-Muller 変換（0 を避けるため微小値を足す）
    const u1 = next() || 1e-12;
    const u2 = next();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    return mean + std * mag * Math.cos(2.0 * Math.PI * u2);
  };

  const noise = (spread: number): number => float(1 - spread, 1 + spread);

  const nextSeed = (): number => Math.floor(next() * 0xffffffff) >>> 0;

  return { next, float, int, chance, normal, noise, nextSeed };
}

/**
 * 重み付き抽選：items から weightFn の重みに比例して1つ選ぶ。
 * 人材の PA帯抽選・国籍抽選（GDP偏り）に使う（技術設計 §2.9）。
 */
export function pickWeighted<T>(items: T[], weightFn: (t: T) => number, rng: PRNG): T {
  const weights = items.map((it) => Math.max(0, weightFn(it)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[0];
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}
