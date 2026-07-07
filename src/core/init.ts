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

  // 初期採用：創業製品(EC=eng/marketing/design)の品質規定式に効く役割を優先して安く雇う。
  // EC向けにエンジニア＋マーケター（不在なら安い順で補完）。序盤のランウェイは残す。
  const hireCount = opts.hireCount ?? 2;
  const sortedBySalary = [...pool].sort((a, b) => a.salaryDemand - b.salaryDemand);
  const preferred = ["engineer", "marketer", "designer"];
  const picks: Person[] = [];
  for (const job of preferred) {
    if (picks.length >= hireCount) break;
    const cand = sortedBySalary.find((p) => p.jobCategory === job && !picks.includes(p));
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
    // 初期社員は自分の職種ロールに配属（役割貢献・使用係数が有効になる）
    people[p.id] = { ...p, contract, morale: 60, assignedRole: p.jobCategory };
    employeeIds.push(p.id);
    // 採用した人は候補プールから外す
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
    devTurns: 3, QUAL_p: 0,
    sticky: 8, paid: 0, stickySales: 0, // 種火の初期シェア8%
    adBudget: 0, prBudget: 0, commBudget: 0,
  };
  starter.QUAL_p = computeQualP("BP-620", team, starter.devTurns, era, 1); // 創業＝tier1切符
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
