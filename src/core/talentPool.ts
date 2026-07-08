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
  WORLD_PA_TIERS,
  UNSKILLED_PA_MAX,
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

/** 人材プール生成の設定（v0.10：単一ワールドDB）。 */
export interface PoolConfig {
  poolSize: number; // 生成人数（＝ワールドDBの人数。除外はしない）
  era: Era;
  hireCountry?: PlayableCountry; // 要求給与の基準となる起業国
}

/**
 * 単一ワールド人材DBを生成する（v0.10・仕様 §4.10.5）。
 *  - 全ティア（未熟練〜世代の逸材）を WORLD_PA_TIERS 分布で含む（大半は普通/低スキル）。
 *  - labor/knowledge で分けない。低ティア(PA<80)は若年寄せ＝低CA＋stamina/health確保。
 *  - 評判ゲートによる除外はしない：全員 DB に存在する（採用可否は hire 時に評判で判定、
 *    可視性は国別スカウトサブスクで判定＝2つのゲートは別軸）。seed再現性あり。
 */
export function generateTalentPool(cfg: PoolConfig, rng: PRNG): Person[] {
  const pool: Person[] = [];
  for (let i = 0; i < cfg.poolSize; i++) {
    // (1) PA帯を希少性分布から抽選し、帯内で一様にPAを決める
    const tier = pickWeighted(WORLD_PA_TIERS, (t) => t.ratio, rng);
    const PA = rng.int(tier.min, tier.max);
    // (2) 国籍抽選（高PAはGDP偏り）
    const nationality = pickNationality(PA, cfg.era, rng);
    // (3) 未熟練(PA<80)は若年中心＝低成熟度で低CA、かつ stamina/health は年齢ボーナスで確保
    const age = PA < UNSKILLED_PA_MAX ? rng.int(19, 32) : rng.int(22, 55);
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
