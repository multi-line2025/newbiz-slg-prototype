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
import { snapshotRivals } from "./rivals";
import { DEFAULT_MISSION_TAGS, WORLD_POOL_SIZE, ORDINARY_PA_MIN, UNSKILLED_PA_MAX, type Archetype } from "./model/constants";

export interface InitOptions {
  seed?: number;
  country?: PlayableCountry;
  era?: Era;
  startingCash?: number;
  hireCount?: number; // 初期採用人数
  poolSize?: number; // 候補プール生成試行数
  archetype?: Archetype; // 業態（既定 knowledge＝v0.7.2互換。labor＝労働集約MVP・v0.8）
}

/** 初期状態を生成する。 */
export function initGame(opts: InitOptions = {}): ProtoGameState {
  const seed = opts.seed ?? 12345;
  const country = opts.country ?? "US";
  const era = opts.era ?? "internet";
  const archetype: Archetype = opts.archetype ?? "knowledge";
  const rng = makePRNG(seed);

  // 会社評判は初期は無名（10）
  const reputation = 10;
  // v0.10：単一ワールドDB（約500人・全ティア混在）。評判/サブスクは別軸ゲートで後段に効く。
  const pool = generateTalentPool(
    { poolSize: opts.poolSize ?? WORLD_POOL_SIZE, era, hireCountry: country },
    rng
  );

  const people: Record<string, Person> = {};
  const poolIds: string[] = [];
  for (const p of pool) {
    people[p.id] = p;
    poolIds.push(p.id);
  }

  // 初期採用（v0.7.2 方針：人材は“普通”のまま。能力は底上げしない）。
  // v0.10：単一ワールドDBから業態の性質どおりに選抜（labor=未熟練／knowledge=ordinary）。
  const picks: Person[] = [];
  if (archetype === "labor") {
    // 労働集約：未熟練層(PA<80＝安い低CA)のみから最安8名。現場管理1名＋一般作業員7名。
    // これで v0.9 の「安い低CAの頭数」を維持（DB統合後もlaborの開始CAは低いまま）。
    const unskilled = pool.filter((p) => p.PA < UNSKILLED_PA_MAX).sort((a, b) => a.salaryDemand - b.salaryDemand);
    const manager = unskilled.find((p) => p.jobCategory === "manager");
    if (manager) picks.push(manager); // 現場管理（mgmtMult＝現場のまとめ役）
    for (const p of unskilled) {
      if (picks.length >= 8) break;
      if (!picks.includes(p)) picks.push(p); // 一般作業員（最安から詰める）
    }
  } else {
    // 知識集約（v0.7.2 互換）：ordinary層＝普通の即戦力ルーキー(PA 80〜120・CA>=60)から
    // 役割カバレッジ重視で2名。sales(turn1直販レバー・§4.4)＋engineer(EC品質の主weight)。
    // “普通”のまま（エリート/best-in-roleは採らない）。ただし 500人DBでは「最安＝その職種の技能が
    // たまたま極端に低い人」を引きやすいので、“職務が務まる下限(ability>=9/20)”を満たす最安を優先。
    // これは能力の底上げではなく「役割ミスマッチのダズを避ける」選抜（v0.9の起点を再現）。
    const ordinary = pool
      .filter((p) => p.PA >= ORDINARY_PA_MIN && p.PA <= 120 && p.CA >= 60)
      .sort((a, b) => a.salaryDemand - b.salaryDemand);
    const hireCount = opts.hireCount ?? 2;
    const roleAbility: Record<string, keyof Person["attributes"]["occupational"]> = { sales: "sales", engineer: "engineering" };
    for (const job of ["sales", "engineer"]) {
      if (picks.length >= hireCount) break;
      const ab = roleAbility[job];
      const competent = ordinary.find((p) => p.jobCategory === job && !picks.includes(p) && p.attributes.occupational[ab] >= 9);
      const cand = competent ?? ordinary.find((p) => p.jobCategory === job && !picks.includes(p));
      if (cand) picks.push(cand);
    }
    for (const p of ordinary) {
      if (picks.length >= hireCount) break;
      if (!picks.includes(p)) picks.push(p);
    }
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

  // 創業製品：業態で分岐。
  //  knowledge＝EC基盤(BP-620・dawn)を自国のEC市場へ（初期売上の種火）。
  //  labor＝受託フルフィルメント(BP-700)を同じS5市場へ（頭数スループットで稼ぐ）。
  const starterBlueprint = archetype === "labor" ? "BP-700" : "BP-620";
  const marketSeed = seed ^ 0x9e3779b9; // 市場グリッドは別seedで散らす
  const markets = generateMarkets(marketSeed);
  const starterMarket = marketId("S5", country);
  const team = employeeIds.map((id) => people[id]); // 初期社員を創業製品に配属
  const starter: Product = {
    id: "prod-starter",
    blueprintId: starterBlueprint, sector: "S5", country, marketId: starterMarket,
    devTurns: 4, QUAL_p: 0, // 少しだけ開発を積んだ状態で船出（普通の水準）
    qualFloor: 0, // 品質フロアは無し（人材/開発で決まる普通のQUAL_p）
    sticky: 8, paid: 0, stickySales: 0, // 種火の初期シェア8%
    adBudget: 0, prBudget: 0, commBudget: 0,
  };
  starter.QUAL_p = computeQualP(starterBlueprint, team, starter.devTurns, era, 1);
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
    unlockedBlueprints: [starterBlueprint], // 創業製品の青写真は保有済み
    missionTags: [...DEFAULT_MISSION_TAGS],
    THxP_customer: 0,
  };

  const state: ProtoGameState = {
    turn: 1,
    archetype,
    era,
    startEra: era,
    company,
    ap: 10,
    apMax: 10,
    people,
    employeeIds,
    poolIds,
    scoutSubscriptions: [country], // 起業国は開始時から加入済み（初期に候補が見える）
    pendingHires: [], // 進行中の採用オファー（創業メンバーは即時雇用済み・v0.11）
    rivalPrev: snapshotRivals(markets), // 初期ライバルを基準化（turn1で全社を“参入”扱いしない・v0.12）
    rivalNews: [], // 他企業の動きログ
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
