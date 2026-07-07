/**
 * ======================================================================
 *  talentPool.ts  初期人材プール生成（仕様 §4.10）
 * ----------------------------------------------------------------------
 *  二段構え:
 *   (1) 存在  … PA希少性分布から PA を抽選し、高PA帯はGDPシェア^αで国籍を偏らせる
 *   (2) 到達可能性 … 会社評判ゲートで到達可能上限PAを超える人材は原則除外
 *  （プロトタイプ簡易版。野心・順応性の高い変人の例外は簡略実装）
 * ======================================================================
 */

import type { PRNG } from "./prng";
import { pickWeighted } from "./prng";
import type { Person, PlayableCountry, Era } from "./model/types";
import {
  PA_TIERS,
  REPUTATION_GATES,
  COUNTRY_FACTORS,
  GDP_BY_ERA,
  GDP_ALPHA,
} from "./model/constants";
import { buildPerson } from "./person";

const PLAYABLE: PlayableCountry[] = ["US", "JP", "DE", "GB", "SG"];

/** 会社評判から到達可能上限PAを引く（仕様 §4.10.4 評判ゲート）。 */
export function reachablePaMax(reputation: number): number {
  for (const g of REPUTATION_GATES) {
    if (reputation >= g.reputationMin && reputation < g.reputationMax) {
      return g.reachablePaMax;
    }
  }
  // 上端（評判100）は最後のゲート
  return REPUTATION_GATES[REPUTATION_GATES.length - 1].reachablePaMax;
}

/**
 * 国籍を抽選する。高PA帯(150+)は GDPシェア^α で経済強国に偏り、
 * それ未満は人材プール厚み係数（人口/教育基盤の近似）で重み付けする（仕様 §4.10.3）。
 */
function pickNationality(PA: number, era: Era, rng: PRNG): PlayableCountry {
  const highPA = PA >= 150;
  return pickWeighted(
    PLAYABLE,
    (co) => {
      const thickness = COUNTRY_FACTORS[co].poolThickness;
      if (highPA) {
        const gdp = GDP_BY_ERA[era][co];
        return thickness * Math.pow(gdp, GDP_ALPHA);
      }
      return thickness;
    },
    rng
  );
}

/** 人材プール生成の設定（プロトタイプ簡易版）。 */
export interface PoolConfig {
  poolSize: number; // 生成試行数（ゲート除外で実数はこれ以下になる）
  reputation: number; // 会社評判（到達可能ティアを決める）
  era: Era;
  hireCountry?: PlayableCountry; // 要求給与の基準となる起業国
}

/**
 * 人材プールを生成する（仕様 §4.10.5）。
 * @returns 生成された Person 配列（評判ゲートを通過したもの）
 */
export function generateTalentPool(cfg: PoolConfig, rng: PRNG): Person[] {
  const pool: Person[] = [];
  const gateMax = reachablePaMax(cfg.reputation);

  for (let i = 0; i < cfg.poolSize; i++) {
    // (1) PA帯を希少性分布から抽選し、帯内で一様にPAを決める
    const tier = pickWeighted(PA_TIERS, (t) => t.ratio, rng);
    const PA = rng.int(tier.min, tier.max);

    // (2) 国籍抽選（高PAはGDP偏り）
    const nationality = pickNationality(PA, cfg.era, rng);

    // (3) 到達可能性ゲート：評判で届く上限PAを超える人材は原則除外
    //     例外：野心・順応性が極めて高い「変人」は稀に来る（仕様 §4.3 の簡易版）
    if (PA > gateMax) {
      const exception = rng.chance(0.05); // 5%の例外枠
      if (!exception) continue;
    }

    const age = rng.int(20, 55);
    pool.push(
      buildPerson(
        { PA, age, nationality, era: cfg.era, hireCountry: cfg.hireCountry },
        rng,
        "pool"
      )
    );
  }
  return pool;
}
