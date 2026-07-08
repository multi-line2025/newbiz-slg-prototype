/**
 * ======================================================================
 *  markets.ts  多市場（セクター×国）の生成・潜在パイ・競合密度（§1＋動的§2）
 * ----------------------------------------------------------------------
 *  市場＝セクター×国の1マス。潜在パイ M_pot は国×Era×セクター×seed偏りで決まる。
 *  競合密度は【成熟度アンカー＋seed noise】（§2.2）で決まり、成熟が進むほど混む。
 *  初期成熟度は sectorEraWeight（旬セクター＝高成熟・萌芽＝低成熟）で散らす（§2.3）。
 * ======================================================================
 */

import type { Era, PlayableCountry } from "./model/types";
import {
  SECTORS, SECTOR_ERA_WEIGHT, ERA_MARKET_MULT, M_BASE, COUNTRY_FACTORS,
  BIAS_AMP, BIAS_MIN, BIAS_MAX, APPEAL_NOISE, DENS_MIN, DENS_MAX,
  NEAR_BASE, NEAR_MIN, NEAR_MAX,
  DENS_MAT_MIN, DENS_MAT_MAX, MAT_BASE, MAT_NOISE, MAT_INIT_MIN, MAT_INIT_MAX,
  MATURITY_INIT_OVERRIDE, REV_FLOOR, REV_CURVE,
  type Sector,
} from "./model/constants";
import type { MarketState, NearRival } from "./state";
import { clamp } from "./util";
import { makePRNG } from "./prng";

const PLAYABLE: PlayableCountry[] = ["US", "JP", "DE", "GB", "SG"];

/** 市場ID＝`${sector}:${country}`。 */
export function marketId(sector: Sector, country: PlayableCountry): string {
  return `${sector}:${country}`;
}

/** 文字列を32bit整数へハッシュ（seed混ぜ・決定論ノイズの種）。 */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** (seed, sector, country, salt) から決定論的な [-1,1] ノイズ。 */
function noise(seed: number, sector: Sector, country: PlayableCountry, salt: string): number {
  const h = hashStr(`${seed}|${sector}|${country}|${salt}`);
  return (h / 0xffffffff) * 2 - 1;
}

/** その era で活性（weight>0）なセクター一覧。 */
export function activeSectors(era: Era): Sector[] {
  return SECTORS.filter((s) => SECTOR_ERA_WEIGHT[s][era] > 0);
}

/** セクターが最初に解禁されるEra（初期成熟度・near生成の基準）。 */
export function unlockEra(sector: Sector): Era {
  const order: Era[] = ["dawn", "internet", "smartphone", "ai"];
  return order.find((e) => SECTOR_ERA_WEIGHT[sector][e] > 0) ?? "ai";
}

/** §1.2 国×セクターの規模偏り（seed変動）。 */
export function sectorCountryBias(seed: number, sector: Sector, country: PlayableCountry): number {
  return clamp(1.0 + BIAS_AMP * noise(seed, sector, country, "bias"), BIAS_MIN, BIAS_MAX);
}

/** §2.1 潜在パイ M_pot（満成熟時の天井。セクター未解禁のEraでは0）。 */
export function marketSizeOf(m: { sector: Sector; country: PlayableCountry; biasFactor: number }, era: Era): number {
  const w = SECTOR_ERA_WEIGHT[m.sector][era];
  if (w <= 0) return 0;
  return M_BASE * COUNTRY_FACTORS[m.country].marketSize * ERA_MARKET_MULT[era] * w * m.biasFactor;
}

/**
 * §2.2 競合密度：成熟度アンカー（相関）＋seed noise（乖離）。
 * 未成熟→約0.35（空き）、成熟→約1.9（混雑）。稀に「空きなのに大/伸びる」旨い市場も生まれる。
 */
export function densityOf(maturity: number, seed: number, sector: Sector, country: PlayableCountry): number {
  const anchor = DENS_MAT_MIN + (DENS_MAT_MAX - DENS_MAT_MIN) * clamp(maturity, 0, 1);
  return clamp(anchor * (1 + APPEAL_NOISE * noise(seed, sector, country, "appeal")), DENS_MIN, DENS_MAX);
}

/** §1.3 nearライバル数（密度でスケール）。 */
export function nearCountOf(density: number): number {
  return clamp(Math.round(NEAR_BASE * density), NEAR_MIN, NEAR_MAX);
}

/** §2.1 収益実現率 realize(maturity)（未成熟は小・成熟で最大）。 */
export function realize(maturity: number): number {
  return REV_FLOOR + (1 - REV_FLOOR) * Math.pow(clamp(maturity, 0, 1), REV_CURVE);
}

/** §2.1 実効パイ M_eff ＝ M_pot × realize(maturity)。 */
export function marketEff(m: { sector: Sector; country: PlayableCountry; biasFactor: number; maturity: number }, era: Era): number {
  return marketSizeOf(m, era) * realize(m.maturity);
}

/** 近接ライバルを1社だけ決定論生成（参入で追加する用）。 */
export function makeOneRival(seed: number, sector: Sector, country: PlayableCountry, index: number): NearRival {
  const rng = makePRNG(hashStr(`${seed}|${sector}|${country}|entry|${index}`));
  const names = ["Nova", "Orbit", "Pulse", "Quark", "Rune", "Spark", "Titan", "Vertex", "Wisp", "Zenith"];
  return {
    id: `${sector}:${country}:e${index}`,
    name: `${names[index % names.length]}${country}`,
    sector: "same",
    scaleTier: rng.int(1, 2),
    reputationTier: rng.int(1, 2),
    aggression: rng.float(0.35, 0.9),
    ambitionFocus: rng.chance(0.4) ? "share" : rng.chance(0.5) ? "tech" : "expand",
    share: 0,
    growthProgress: 0,
  };
}

/**
 * §2.3 初期成熟度：旬セクター（sectorEraWeight大）は高成熟、萌芽は低成熟。
 * プロトタイプは MATURITY_INIT_OVERRIDE（S1=0.6/S6=0.15）で体感差を明示。
 */
export function maturityInit(seed: number, sector: Sector, country: PlayableCountry): number {
  const override = MATURITY_INIT_OVERRIDE[sector];
  if (override != null) {
    // 体感用の固定値に軽いseedジッタを乗せる（国ごとに少しずらす）
    return clamp(override * (1 + 0.15 * noise(seed, sector, country, "mat")), MAT_INIT_MIN, MAT_INIT_MAX);
  }
  const w = SECTOR_ERA_WEIGHT[sector][unlockEra(sector)];
  return clamp(MAT_BASE * w * (1 + MAT_NOISE * noise(seed, sector, country, "mat")), MAT_INIT_MIN, MAT_INIT_MAX);
}

/**
 * その市場の近接ライバル群を生成（プロトタイプ簡易版・全て同一セクター＝sectorMatch1.0）。
 * cross-sectorの弱い干渉はfarPressureに畳み込む（§1.3の簡略）。
 */
function makeNearRivals(seed: number, sector: Sector, country: PlayableCountry, count: number): NearRival[] {
  const rng = makePRNG(hashStr(`${seed}|${sector}|${country}|rivals`));
  const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
  const rivals: NearRival[] = [];
  // near群は実頭数で保持（ΣC_rは合計＋farPressure。参入/撤退で増減・§4）
  const detail = clamp(count, NEAR_MIN, NEAR_MAX);
  for (let i = 0; i < detail; i++) {
    rivals.push({
      id: `${sector}:${country}:r${i}`,
      name: `${names[i % names.length]}${country}`,
      sector: "same",
      scaleTier: rng.int(1, 2),
      reputationTier: rng.int(1, 3),
      aggression: rng.float(0.3, 0.85),
      ambitionFocus: rng.chance(0.3) ? "share" : rng.chance(0.5) ? "tech" : "expand",
      share: 0,
      growthProgress: 0,
    });
  }
  return rivals;
}

/** 全 sector×country の市場グリッドを生成（§1・§6・動的§2）。init で1回。 */
export function generateMarkets(seed: number): Record<string, MarketState> {
  const out: Record<string, MarketState> = {};
  for (const sector of SECTORS) {
    for (const country of PLAYABLE) {
      const bias = sectorCountryBias(seed, sector, country);
      const maturity = maturityInit(seed, sector, country);
      const density = densityOf(maturity, seed, sector, country);
      const target = nearCountOf(density);
      const id = marketId(sector, country);
      out[id] = {
        id, sector, country,
        biasFactor: bias,
        nearRivals: makeNearRivals(seed, sector, country, target),
        analysisLevel: 0,
        analyzed: null,
        lastAnalyzedTurn: null,
        analysisInProgress: null,
        maturity,
        entryAccrual: 0,
        nearCountTarget: target,
        lastDeltaMaturity: 0,
      };
    }
  }
  return out;
}
