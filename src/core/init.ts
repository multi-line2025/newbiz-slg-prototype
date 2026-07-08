/**
 * ======================================================================
 *  init.ts  初期ゲーム状態の生成
 * ----------------------------------------------------------------------
 *  会社を1社設立し、人材プールを生成、数名を初期採用して開始する。
 *  seed を固定すれば毎回同じ初期状態になる（再現性）。
 * ======================================================================
 */

import type { PlayableCountry, Era, Contract, Person } from "./model/types";
import { makePRNG } from "./prng";
import { generateTalentPool } from "./talentPool";
import type { ProtoGameState, Product } from "./state";
import { computeMonthlyBurn } from "./finance";
import { computeQualP } from "./product";
import { generateMarkets, marketId } from "./markets";
import { DEFAULT_MISSION_TAGS } from "./model/constants";

export interface InitOptions {
  seed?: number;
  country?: PlayableCountry;
  era?: Era;
  startingCash?: number;
  hireCount?: number; // 初期採用人数
  poolSize?: number; // 候補プール生成試行数
}

/** 初期状態を生成する。 */
export function initGame(opts: InitOptions = {}): ProtoGameState {
  const seed = opts.seed ?? 12345;
  const country = opts.country ?? "US";
  const era = opts.era ?? "internet";
  const rng = makePRNG(seed);

  // 会社評判は初期は無名（10）
  const reputation = 10;
  const pool = generateTalentPool(
    { poolSize: opts.poolSize ?? 40, reputation, era, hireCountry: country },
    rng
  );

  const people: Record<string, Person> = {};
  const poolIds: string[] = [];
  for (const p of pool) {
    people[p.id] = p;
    poolIds.push(p.id);
  }

  // 初期採用（v0.7.2 方針：人材は“普通”のまま。能力は底上げしない）。
  // 死の谷の解消は成長レバー/しきい値の是正で行い、ここでは「役割の穴を塞ぐ」だけ。
  // 安い駆け出しを 職種カバレッジ重視で採る：sales(turn1から効く直販レバー・§4.4)＋
  // engineer(EC品質の主weight)＋marketer(EC品質＋広告効率)。能力値は普通。
  const hireCount = opts.hireCount ?? 2;
  const sortedBySalary = [...pool].sort((a, b) => a.salaryDemand - b.salaryDemand);
  const preferred = ["sales", "engineer"];
  const picks: Person[] = [];
  for (const job of preferred) {
    if (picks.length >= hireCount) break;
    const cand = sortedBySalary.find((p) => p.jobCategory === job && !picks.includes(p)); // 各職種の“最安”＝普通の駆け出し
    if (cand) picks.push(cand);
  }
  for (const p of sortedBySalary) {
    if (picks.length >= hireCount) break;
    if (!picks.includes(p)) picks.push(p);
  }
  const employeeIds: string[] = [];
  for (const p of picks) {
    const contract: Contract = {
      type: "fulltime",
      remainingTurns: 24,
      equity: 0,
      salary: p.salaryDemand,
    };
    // 普通の駆け出しをそのまま配属（能力・忠誠・士気は素のまま）。
    people[p.id] = { ...p, contract, morale: 60, assignedRole: p.jobCategory };
    employeeIds.push(p.id);
    const idx = poolIds.indexOf(p.id);
    if (idx >= 0) poolIds.splice(idx, 1);
  }

  // 創業製品：EC基盤(BP-620・dawn＝全Era)を無償解放し自国のEC市場へ投入（初期売上の種火）
  const marketSeed = seed ^ 0x9e3779b9; // 市場グリッドは別seedで散らす
  const markets = generateMarkets(marketSeed);
  const starterMarket = marketId("S5", country);
  const team = employeeIds.map((id) => people[id]); // 初期社員を創業製品に配属
  const starter: Product = {
    id: "prod-starter",
    blueprintId: "BP-620", sector: "S5", country, marketId: starterMarket,
    devTurns: 4, QUAL_p: 0, // 少しだけ開発を積んだ状態で船出（普通の水準）
    qualFloor: 0, // 品質フロアは無し（人材/開発で決まる普通のQUAL_p）
    sticky: 8, paid: 0, stickySales: 0, // 種火の初期シェア8%
    adBudget: 0, prBudget: 0, commBudget: 0,
  };
  starter.QUAL_p = computeQualP("BP-620", team, starter.devTurns, era, 1); // tier1切符（普通のQUAL_p）
  const assignments: Record<string, string> = {};
  for (const id of employeeIds) assignments[id] = starter.id;

  const company = {
    name: "NewCo",
    foundedCountry: country,
    CASH: opts.startingCash ?? 120000, // 多市場は混雑市場だと勝ちにくいため、分析で空き市場を探す猶予を持たせる
    reputation,
    monthlyBurn: 0,
    runwayTurns: 0,
    RP_C: 0,
    researchBudget: 0,
    unlockedBlueprints: ["BP-620"], // 創業製品の青写真は保有済み
    missionTags: [...DEFAULT_MISSION_TAGS],
    THxP_customer: 0,
  };

  const state: ProtoGameState = {
    turn: 1,
    era,
    startEra: era,
    company,
    ap: 10,
    apMax: 10,
    people,
    employeeIds,
    poolIds,
    markets,
    products: [starter],
    assignments,
    rngSeed: rng.nextSeed(),
    marketSeed,
    log: [],
    gameOver: false,
    endTurn: null,
    profitStreak: 0,
    achievements: [],
  };

  const burn = computeMonthlyBurn(state);
  state.company.monthlyBurn = burn;
  state.company.runwayTurns = burn > 0 ? state.company.CASH / burn : Infinity;
  return state;
}
