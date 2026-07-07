/**
 * ======================================================================
 *  actions.ts  プレイヤーの意思決定アクション（AP消費・純粋関数）
 * ----------------------------------------------------------------------
 *  各アクションは (state, 引数) → { state, ok, message } を返す純粋関数。
 *  APやCASHが足りなければ ok=false で状態を変えずメッセージだけ返す。
 *  対象: スカウト(§4.8)・採用(§4.3)・配属(§4.6)・マーケ投資(§12.4)。
 * ======================================================================
 */

import type { Person, Id, Role, Contract, PlayableCountry } from "./model/types";
import type { ProtoGameState, Product } from "./state";
import { employees } from "./state";
import { SCOUT_STEPS, AP_COST, RESEARCH_BUDGET_STEP, MARKET_BUDGET_STEP, ANALYSIS_STEPS } from "./model/constants";
import { getBlueprint, blueprintStatus } from "./research";
import { marketSizeOf } from "./markets";
import { analysisSkill } from "./analysis";
import { refreshDerived } from "./finance";

/** アクションの結果。ok=false なら state は元のまま。 */
export interface ActionResult {
  state: ProtoGameState;
  ok: boolean;
  message: string;
}

/** そのまま失敗を返すヘルパ。 */
function fail(state: ProtoGameState, message: string): ActionResult {
  return { state, ok: false, message };
}

/** 会社の調査担当スキル＝在籍社員の max(management, research) の最大値（無ければ10=並）。 */
export function companyScoutSkill(state: ProtoGameState): number {
  const emps = employees(state);
  if (emps.length === 0) return 10;
  return Math.max(
    ...emps.map((e) => Math.max(e.attributes.occupational.management, e.attributes.occupational.research))
  );
}

/** 人材DBの1人を差し替えた新しい people を作る。 */
function withPerson(state: ProtoGameState, p: Person): Record<Id, Person> {
  return { ...state.people, [p.id]: p };
}

/**
 * スカウト（§4.8 / 数値定義書 §3）。
 * scoutLevel を 0→1（簡易・1AP/$2,000）または 1→2（精密・2AP/$8,000）に上げる。
 */
export function scoutCandidate(state: ProtoGameState, personId: Id): ActionResult {
  const p = state.people[personId];
  if (!p) return fail(state, "対象が見つかりません。");
  if (p.scoutLevel >= 2) return fail(state, `${p.name}は既に精密調査済みです。`);

  const step = SCOUT_STEPS[p.scoutLevel]; // 0→1 は index0、1→2 は index1
  if (state.ap < step.ap) return fail(state, `APが足りません（必要${step.ap}AP）。`);
  if (state.company.CASH < step.cash) return fail(state, `資金が足りません（必要$${step.cash}）。`);

  const nextLevel = (p.scoutLevel + 1) as 0 | 1 | 2;
  const updated: Person = { ...p, scoutLevel: nextLevel };
  const label = nextLevel === 1 ? "簡易スカウト" : "精密デューデリ";
  return {
    state: {
      ...state,
      ap: state.ap - step.ap,
      company: { ...state.company, CASH: state.company.CASH - step.cash },
      people: withPerson(state, updated),
    },
    ok: true,
    message: `${label}実施：${p.name}（-${step.ap}AP / -$${step.cash}）→ Lv${nextLevel}`,
  };
}

/**
 * 採用オファー（§4.3）。候補者を雇用し、実効要求給与で契約を結ぶ。
 * 給与は毎ターンのバーンに反映される（前払いはしない）。
 */
export function hireCandidate(state: ProtoGameState, personId: Id): ActionResult {
  const p = state.people[personId];
  if (!p) return fail(state, "対象が見つかりません。");
  if (!state.poolIds.includes(personId)) return fail(state, `${p.name}は候補プールにいません。`);
  if (state.ap < AP_COST.hire) return fail(state, `APが足りません（必要${AP_COST.hire}AP）。`);

  const salary = p.salaryDemand; // §4.3本式で算出済み（起業国の最低賃金係数込み）
  const contract: Contract = { type: "fulltime", remainingTurns: 24, equity: 0, salary };
  const updated: Person = { ...p, contract, morale: 60, assignedRole: null };

  return {
    state: refreshDerived({
      ...state,
      ap: state.ap - AP_COST.hire,
      people: withPerson(state, updated),
      employeeIds: [...state.employeeIds, personId],
      poolIds: state.poolIds.filter((id) => id !== personId),
    }),
    ok: true,
    message: `採用：${p.name}（月給$${salary}）を雇用。`,
  };
}

/**
 * 役割配属（§4.6）。配属で使用係数(成長)と役割貢献(QUAL/TRAC)が有効になる。
 */
export function assignRole(state: ProtoGameState, personId: Id, role: Role): ActionResult {
  const p = state.people[personId];
  if (!p) return fail(state, "対象が見つかりません。");
  if (!state.employeeIds.includes(personId)) return fail(state, `${p.name}は社員ではありません。`);
  if (state.ap < AP_COST.assign) return fail(state, `APが足りません（必要${AP_COST.assign}AP）。`);

  const updated: Person = { ...p, assignedRole: role };
  return {
    state: {
      ...state,
      ap: state.ap - AP_COST.assign,
      people: withPerson(state, updated),
    },
    ok: true,
    message: `配属：${p.name} → ${role}`,
  };
}

/** 製品を差し替えた新しい products 配列。 */
function withProduct(state: ProtoGameState, p: Product): Product[] {
  return state.products.map((x) => (x.id === p.id ? p : x));
}

/** マーケの3チャネル予算キー（広告/PR/コミュニティ）。 */
export type MarketChannel = "adBudget" | "prBudget" | "commBudget";

const CHANNEL_LABEL: Record<MarketChannel, string> = {
  adBudget: "広告", prBudget: "PR/口コミ", commBudget: "コミュニティ",
};

/**
 * 製品ごとのマーケ予算（広告/PR/コミュニティ）増減（市場成長モデル§4）。
 * AP不要の設定操作。毎ターンのバーンに加算され、その製品の市場でシェア増分を生む。
 * @param dir +1 で$1,000増額、-1 で減額
 */
export function setMarketBudget(state: ProtoGameState, productId: Id, channel: MarketChannel, dir: 1 | -1): ActionResult {
  const prod = state.products.find((p) => p.id === productId);
  if (!prod) return fail(state, "製品が見つかりません。");
  const cur = prod[channel];
  const next = Math.max(0, cur + dir * MARKET_BUDGET_STEP);
  if (next === cur) return fail(state, `${CHANNEL_LABEL[channel]}予算はこれ以上下げられません。`);
  const updated: Product = { ...prod, [channel]: next };
  return {
    state: refreshDerived({ ...state, products: withProduct(state, updated) }),
    ok: true,
    message: `${prod.marketId}の${CHANNEL_LABEL[channel]}予算を $${next}/ターン に。`,
  };
}

/**
 * 製品を市場へ投入（launch）。解放済み青写真を、そのセクター×指定国の市場に出す（要望②）。
 * 1市場につき1製品。以降その市場でシェアを争う。
 */
export function launchProduct(state: ProtoGameState, blueprintId: Id, country: PlayableCountry): ActionResult {
  const bp = getBlueprint(blueprintId);
  if (!bp) return fail(state, "青写真が見つかりません。");
  if (!state.company.unlockedBlueprints.includes(bp.id)) return fail(state, `${bp.name}は未解放です。`);
  const marketId = `${bp.targetSector}:${country}`;
  const market = state.markets[marketId];
  if (!market) return fail(state, "その市場は存在しません。");
  if (marketSizeOf({ sector: market.sector, country: market.country, biasFactor: market.biasFactor }, state.era) <= 0) {
    return fail(state, `${bp.name}の市場（${marketId}）は現時代では未成立です。`);
  }
  if (state.products.some((p) => p.marketId === marketId)) return fail(state, `${marketId}には既に製品があります。`);
  if (state.ap < 1) return fail(state, "APが足りません（必要1AP）。");
  const setup = 2000;
  if (state.company.CASH < setup) return fail(state, `資金が足りません（設立$${setup}）。`);

  const product: Product = {
    id: `prod-${blueprintId}-${country}-${state.turn}`,
    blueprintId, sector: bp.targetSector, country, marketId,
    devTurns: 0, QUAL_p: 0,
    sticky: 3, paid: 0, stickySales: 0, // 種火の初期シェア3%
    adBudget: 0, prBudget: 0, commBudget: 0,
  };
  return {
    state: refreshDerived({
      ...state,
      ap: state.ap - 1,
      company: { ...state.company, CASH: state.company.CASH - setup },
      products: [...state.products, product],
    }),
    ok: true,
    message: `製品投入：『${bp.name}』を ${marketId} へ（-1AP / -$${setup}）。担当を配属しよう。`,
  };
}

/** 社員を製品へ配属（QUAL_p・force算出に使用・要望③）。AP不要の管理操作。 */
export function assignToProduct(state: ProtoGameState, personId: Id, productId: Id | null): ActionResult {
  if (!state.employeeIds.includes(personId)) return fail(state, "社員ではありません。");
  if (productId && !state.products.some((p) => p.id === productId)) return fail(state, "製品が見つかりません。");
  const assignments = { ...state.assignments };
  if (productId) assignments[personId] = productId;
  else delete assignments[personId];
  const name = state.people[personId]?.name ?? personId;
  const prod = state.products.find((p) => p.id === productId);
  return {
    state: { ...state, assignments },
    ok: true,
    message: productId ? `${name} を製品『${prod?.marketId}』へ配属。` : `${name} の製品配属を解除。`,
  };
}

/**
 * 市場分析の実行（§3）。リサーチャー配属＋AP＋CASH＋数ターンで analysisLevel を上げる。
 * 精度は分析スキル（research合成）に依存（着手時に固定）。
 */
export function analyzeMarket(state: ProtoGameState, marketId: string): ActionResult {
  const market = state.markets[marketId];
  if (!market) return fail(state, "市場が見つかりません。");
  if (market.analysisInProgress) return fail(state, `${marketId}は分析中です。`);
  if (market.analysisLevel >= 2) return fail(state, `${marketId}は精密分析済みです。`);

  const skill = analysisSkill(employees(state));
  if (skill <= 0) return fail(state, "分析担当（研究能力を持つ社員）が必要です。");

  const targetLevel = (market.analysisLevel + 1) as 1 | 2;
  const step = ANALYSIS_STEPS[targetLevel - 1];
  if (state.ap < step.ap) return fail(state, `APが足りません（必要${step.ap}AP）。`);
  if (state.company.CASH < step.cash) return fail(state, `資金が足りません（必要$${step.cash}）。`);

  const markets = {
    ...state.markets,
    [marketId]: {
      ...market,
      analysisInProgress: { targetLevel, turnsLeft: step.turns, analystSkill: skill },
    },
  };
  const label = targetLevel === 1 ? "市場スキャン" : "精密市場分析";
  return {
    state: {
      ...state,
      ap: state.ap - step.ap,
      company: { ...state.company, CASH: state.company.CASH - step.cash },
      markets,
    },
    ok: true,
    message: `${label}開始：${marketId}（-${step.ap}AP / -$${step.cash} / ${step.turns}ターン後に完了）`,
  };
}

/**
 * 研究投資予算の増減（§12.3）。$1,000単位。予算はAP不要の設定操作で、
 * 毎ターンのバーンに加算され、研究投資係数（RP産出）を決める。
 * @param dir +1 で増額、-1 で減額
 */
export function setResearchBudget(state: ProtoGameState, dir: 1 | -1): ActionResult {
  const next = Math.max(0, state.company.researchBudget + dir * RESEARCH_BUDGET_STEP);
  if (next === state.company.researchBudget) return fail(state, "研究予算はこれ以上下げられません。");
  return {
    state: refreshDerived({ ...state, company: { ...state.company, researchBudget: next } }),
    ok: true,
    message: `研究投資予算を $${next}/ターン に設定。`,
  };
}

/**
 * 青写真の解放（§5.3）。前提・Era・RP・ミッション整合を満たすときのみ実行。
 * 蓄積した RP_C を消費し、QUAL上限を押し上げ、現QUALも即時に引き上げる。
 */
export function unlockBlueprint(state: ProtoGameState, bpId: Id): ActionResult {
  const bp = getBlueprint(bpId);
  if (!bp) return fail(state, "青写真が見つかりません。");

  const c = state.company;
  const status = blueprintStatus(bp, c.unlockedBlueprints, state.era, c.RP_C, c.missionTags);
  switch (status) {
    case "unlocked":
      return fail(state, `${bp.name}は解放済みです。`);
    case "mission":
      return fail(state, `${bp.name}はミッション（${c.missionTags.join("・")}）と衝突し選べません。`);
    case "prereq":
      return fail(state, `${bp.name}は前提青写真（${bp.prerequisites.join(",")}）が未解放です。`);
    case "era":
      return fail(state, `${bp.name}は時代（${bp.requiredEra}）に未到達です。`);
    case "rp":
      return fail(state, `RPが足りません（必要${bp.rpCost} / 保有${Math.floor(c.RP_C)}）。`);
  }
  if (state.ap < AP_COST.unlockBlueprint) return fail(state, `APが足りません（必要${AP_COST.unlockBlueprint}AP）。`);

  // 解放：RP消費 → 解放済みに追加。青写真は「製品を出せるセクターの切符」（QUALは製品側で決まる）
  return {
    state: {
      ...state,
      ap: state.ap - AP_COST.unlockBlueprint,
      company: {
        ...c,
        RP_C: c.RP_C - bp.rpCost,
        unlockedBlueprints: [...c.unlockedBlueprints, bp.id],
      },
    },
    ok: true,
    message: `青写真『${bp.name}』を解放（-${bp.rpCost}RP）→ ${bp.targetSector}市場に製品を出せる`,
  };
}
