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
import type { ProtoGameState, Product, ProtoCompany } from "./state";
import { workforce, effectiveApMax } from "./state";
import {
  SCOUT_STEPS, AP_COST, RESEARCH_BUDGET_STEP, MARKET_BUDGET_STEP, ANALYSIS_STEPS,
  SCOUT_SUB_AP, SCOUT_SUB_COST,
  RECRUIT_TURNS, MAX_PENDING_OFFERS, OFFER_PA_MARGIN_DIV, OFFER_BASE, OFFER_SALARY_K,
  OFFER_AMBITION_K, OFFER_ACCEPT_MIN, OFFER_ACCEPT_MAX,
  COURT_BASE, PROPOSE_BASE, MARRIAGE_LUMP, ROMANCE_MIN_AGE,
  EDU_COST, EDU_GROWTH_K, CHILD_GROW_ENV, MARRIAGE_SCOUT_COST,
} from "./model/constants";
import { getBlueprint, blueprintStatus } from "./research";
import { marketSizeOf } from "./markets";
import { analysisSkill } from "./analysis";
import { refreshDerived } from "./finance";
import { reachablePaMax } from "./talentPool";
import { clamp } from "./util";
import { makePRNG } from "./prng";
import { applyGrowth } from "./growth";
import { repMatchProbability, isBloodRelated, marriageCandidate, currentLover } from "./family";

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

/** 会社の調査担当スキル＝戦力(社員＋実務PC)の max(management, research) の最大値（無ければ10=並）。 */
export function companyScoutSkill(state: ProtoGameState): number {
  const emps = workforce(state);
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
  // v0.10：個別スカウト（深掘り）は加入国の候補にのみ実行可能（可視性ゲート）
  if (!state.scoutSubscriptions.includes(p.nationality as PlayableCountry)) {
    return fail(state, `${p.name}の国は未加入です（スカウトサブスクに加入すると深掘りできます）。`);
  }
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
 * 国別スカウトサブスクに加入する（v0.10）。加入国の候補者の★が見え、個別深掘りが可能になる。
 * 加入は 1AP。月額はその後の monthlyBurn に加算される（前払い無し）。
 */
export function subscribeScoutCountry(state: ProtoGameState, country: PlayableCountry): ActionResult {
  if (state.scoutSubscriptions.includes(country)) return fail(state, `${country}は既に加入済みです。`);
  if (state.ap < SCOUT_SUB_AP) return fail(state, `APが足りません（必要${SCOUT_SUB_AP}AP）。`);
  return {
    state: refreshDerived({
      ...state,
      ap: state.ap - SCOUT_SUB_AP,
      scoutSubscriptions: [...state.scoutSubscriptions, country],
    }),
    ok: true,
    message: `スカウトサブスク加入：${country}（月額$${SCOUT_SUB_COST[country]}／候補の★が開示）`,
  };
}

/**
 * 国別スカウトサブスクを解約する（v0.10）。いつでも解約可（0AP）。
 * 解約でその国の候補は再びフォグ（★・素性が不明）に戻り、新規の個別深掘りは不可になる。
 * （既存の深掘り結果は保持し、再加入で再び見える。）
 */
export function unsubscribeScoutCountry(state: ProtoGameState, country: PlayableCountry): ActionResult {
  if (country === state.company.foundedCountry) return fail(state, `本拠地(${country})は常に加入・無料のため解約できません。`);
  if (!state.scoutSubscriptions.includes(country)) return fail(state, `${country}は未加入です。`);
  return {
    state: refreshDerived({
      ...state,
      scoutSubscriptions: state.scoutSubscriptions.filter((c) => c !== country),
    }),
    ok: true,
    message: `スカウトサブスク解約：${country}（可視性が戻り、月額$${SCOUT_SUB_COST[country]}が外れました）`,
  };
}

/** 候補者を即時に雇用する内部処理（契約・士気・プール移動）。creation/オファー受諾で使う。 */
function employPerson(state: ProtoGameState, personId: Id, salary: number): ProtoGameState {
  const p = state.people[personId];
  const contract: Contract = { type: "fulltime", remainingTurns: 24, equity: 0, salary };
  const updated: Person = { ...p, contract, morale: 60, assignedRole: null };
  return refreshDerived({
    ...state,
    people: withPerson(state, updated),
    employeeIds: [...state.employeeIds, personId],
    poolIds: state.poolIds.filter((id) => id !== personId),
    pendingHires: state.pendingHires.filter((o) => o.personId !== personId),
  });
}

/**
 * 【内部/テスト用】候補者を即時に雇用する（§4.3）。プレイヤーUIは makeOffer（3ターン）を使う。
 * ※ 情報リーク防止：PA・評判上限を露出するメッセージ/ゲートは持たない。
 */
export function hireCandidate(state: ProtoGameState, personId: Id): ActionResult {
  const p = state.people[personId];
  if (!p) return fail(state, "対象が見つかりません。");
  if (!state.poolIds.includes(personId)) return fail(state, `${p.name}は候補プールにいません。`);
  if (state.ap < AP_COST.hire) return fail(state, `APが足りません（必要${AP_COST.hire}AP）。`);
  const salary = p.salaryDemand;
  return {
    state: { ...employPerson(state, personId, salary), ap: state.ap - AP_COST.hire },
    ok: true,
    message: `採用：${p.name}（月給$${salary}）を雇用。`,
  };
}

/**
 * 採用オファーを出す（v0.11・リクルート）。即時雇用ではなく3ターンの交渉に入る。
 * 返答（受諾/辞退）は resolvePendingHires で確率的に解決する。
 * ※ リーク遮断：PA・評判上限は一切露出しない。二重オファー不可・同時オファー上限あり。
 */
export function makeOffer(state: ProtoGameState, personId: Id): ActionResult {
  const p = state.people[personId];
  if (!p) return fail(state, "対象が見つかりません。");
  if (state.employeeIds.includes(personId)) return fail(state, `${p.name}は既に社員です。`);
  if (!state.poolIds.includes(personId)) return fail(state, `${p.name}は候補にいません。`);
  if (state.pendingHires.some((o) => o.personId === personId)) return fail(state, `${p.name}へは既にオファー交渉中です。`);
  if (state.pendingHires.length >= MAX_PENDING_OFFERS) {
    return fail(state, `同時オファーは${MAX_PENDING_OFFERS}件まで。いずれかの返答を待ちましょう。`);
  }
  if (state.ap < AP_COST.hire) return fail(state, `APが足りません（必要${AP_COST.hire}AP）。`);
  const salary = p.salaryDemand; // 提示は要求給与（本MVPでは給与交渉なし）
  const offer = { personId, remaining: RECRUIT_TURNS, salaryOffered: salary };
  return {
    state: refreshDerived({ ...state, ap: state.ap - AP_COST.hire, pendingHires: [...state.pendingHires, offer] }),
    ok: true,
    message: `オファー提出：${p.name}（${RECRUIT_TURNS}ターン後に返答）。`,
  };
}

/**
 * オファー受諾確率（0-1・純粋関数・v0.11）。UIには一切露出しない内部値。
 *  評判で届く範囲(内部アンカー reachablePaMax)なら概ね受諾、超える高位人材は無名企業に概ね辞退。
 *  境界は確率的にぼかし、提示給与↑で受諾↑・野心×無名度で受諾↓。閾値もPA数値も表に出さない。
 */
export function offerAcceptProbability(company: ProtoCompany, person: Person, salaryOffered: number): number {
  const gate = reachablePaMax(company.reputation);              // 内部アンカー（非露出）
  const paMargin = (gate - person.PA) / OFFER_PA_MARGIN_DIV;    // >0=射程内 / <0=高望み
  let p = OFFER_BASE + paMargin;
  const salaryRatio = salaryOffered / Math.max(1, person.salaryDemand);
  p += OFFER_SALARY_K * (salaryRatio - 1);                      // 高提示ほど受諾↑
  p -= OFFER_AMBITION_K * (person.attributes.mental.ambition / 20) * (1 - company.reputation / 100);
  return clamp(p, OFFER_ACCEPT_MIN, OFFER_ACCEPT_MAX);
}

/** 進行中オファーを1ターン進め、返答ターン(remaining→0)で受諾/辞退を確率解決する（v0.11）。 */
export function resolvePendingHires(
  state: ProtoGameState,
  rng: { chance: (p: number) => boolean },
  events: string[]
): ProtoGameState {
  let s = state;
  const next: ProtoGameState["pendingHires"] = [];
  for (const offer of state.pendingHires) {
    const p = s.people[offer.personId];
    if (!p || s.employeeIds.includes(offer.personId)) continue; // 候補が消えた/既に社員→オファー消滅
    const rem = offer.remaining - 1;
    if (rem > 0) { next.push({ ...offer, remaining: rem }); continue; }
    // 返答ターン：受諾判定（PA・閾値は一切表に出さない）
    if (rng.chance(offerAcceptProbability(s.company, p, offer.salaryOffered))) {
      s = employPerson(s, offer.personId, offer.salaryOffered);
      events.push(`🎉 採用成立：${p.name} が着任しました。`);
    } else {
      events.push(`オファーを辞退されました：${p.name}。`);
    }
  }
  return { ...s, pendingHires: next };
}

/* ============================================================
 * v0.13：個人キャリア＆家族（恋愛・結婚・教育）の意思決定アクション
 * ============================================================ */

/**
 * 求愛（§9・恋愛）。★評判の釣り合いゲート×確率で交際(lover)に発展。PA・数値は露出しない。
 *  失敗（振られる）でも ok=true（AP消費・結果はメッセージ）。相手プールは結婚市場（v0.14）。
 */
export function courtCandidate(state: ProtoGameState, personId: Id): ActionResult {
  const pc = state.people[state.pc.personId];
  const t = marriageCandidate(state, personId);
  if (!t) return fail(state, "対象が見つかりません。");
  if (state.pc.spouseId) return fail(state, "既に配偶者がいます。");
  if (currentLover(state)) return fail(state, "既に交際中の相手がいます。");
  if (t.sex === pc.sex) return fail(state, `${t.name}とは結ばれません。`);
  if (t.age < ROMANCE_MIN_AGE) return fail(state, `${t.name}はまだ成人していません。`);
  if (isBloodRelated(state.pc.bloodlineId, t)) return fail(state, `${t.name}は血族のため結ばれません（§9.3.3）。`);
  if (t.relationToPC !== "none") return fail(state, `${t.name}は恋愛対象外です。`);
  if (state.ap < 1) return fail(state, "APが足りません（必要1AP）。");
  const prob = COURT_BASE * repMatchProbability(pc.reputation, t.reputation);
  if (prob <= 0) return fail(state, `${t.name}とは評判の格が違いすぎて、相手にされません。`);
  const rng = makePRNG(state.familySeed);
  const success = rng.chance(prob);
  const familySeed = rng.nextSeed();
  if (success) {
    const marriagePool = state.marriagePool.map((p) => (p.id === personId ? { ...p, relationToPC: "lover" as const } : p));
    return { state: { ...state, ap: state.ap - 1, familySeed, marriagePool }, ok: true, message: `💘 ${t.name} との交際が始まりました。` };
  }
  return { state: { ...state, ap: state.ap - 1, familySeed }, ok: true, message: `${t.name} に振られました。またの機会に。` };
}

/**
 * 求婚（§9・結婚）。交際中(lover)の相手に、評判釣り合い×確率で結婚(spouse)。3AP＋結婚一時金。
 *  成立で相手を結婚市場から people(配偶者) へ移す。
 */
export function proposeMarriage(state: ProtoGameState, personId: Id): ActionResult {
  const pc = state.people[state.pc.personId];
  const t = marriageCandidate(state, personId);
  if (!t) return fail(state, "対象が見つかりません。");
  if (state.pc.spouseId) return fail(state, "既に配偶者がいます。");
  if (t.relationToPC !== "lover") return fail(state, `${t.name}とはまず交際する必要があります。`);
  if (state.ap < 3) return fail(state, "APが足りません（必要3AP）。");
  if (state.pc.wealth < MARRIAGE_LUMP) return fail(state, `結婚一時金 $${MARRIAGE_LUMP.toLocaleString()} が不足しています。`);
  const prob = PROPOSE_BASE * repMatchProbability(pc.reputation, t.reputation);
  if (prob <= 0) return fail(state, `${t.name}とは評判の格が違いすぎます。`);
  const rng = makePRNG(state.familySeed ^ 0x5bd1e995);
  const success = rng.chance(prob);
  const familySeed = rng.nextSeed();
  if (success) {
    const spouse: Person = { ...t, relationToPC: "spouse" };
    return {
      state: {
        ...state, ap: state.ap - 3, familySeed,
        pc: { ...state.pc, spouseId: personId, wealth: state.pc.wealth - MARRIAGE_LUMP },
        people: withPerson(state, spouse), // 配偶者は people 側へ（妊娠/出産・インカム機構に接続）
        marriagePool: state.marriagePool.filter((p) => p.id !== personId),
      },
      ok: true,
      message: `💍 ${t.name} と結婚しました！`,
    };
  }
  return { state: { ...state, ap: state.ap - 1, familySeed }, ok: true, message: `${t.name} に求婚を断られました。` };
}

/**
 * 結婚候補の身辺調査（v0.14・fog解除）。個人資産と1APで、正確な評判＋CA/PAを開示する（見合い＝DD）。
 */
export function scoutMarriageCandidate(state: ProtoGameState, personId: Id): ActionResult {
  const t = marriageCandidate(state, personId);
  if (!t) return fail(state, "対象が見つかりません。");
  if (t.scoutLevel >= 1) return fail(state, `${t.name}は既に調査済みです。`);
  if (state.ap < 1) return fail(state, "APが足りません（必要1AP）。");
  if (state.pc.wealth < MARRIAGE_SCOUT_COST) return fail(state, `調査費 $${MARRIAGE_SCOUT_COST.toLocaleString()} が不足しています。`);
  const marriagePool = state.marriagePool.map((p) => (p.id === personId ? { ...p, scoutLevel: 1 as const } : p));
  return {
    state: { ...state, ap: state.ap - 1, pc: { ...state.pc, wealth: state.pc.wealth - MARRIAGE_SCOUT_COST }, marriagePool },
    ok: true,
    message: `🔍 ${t.name} の身辺を調査しました（評判・能力を開示）。`,
  };
}

/** 子作りトグルの設定（v0.14）。ONのターンのみ受胎判定が走る。 */
export function setTryForChild(state: ProtoGameState, value: boolean): ActionResult {
  return { state: { ...state, tryForChild: value }, ok: true, message: value ? "子作りをONにしました。" : "子作りをOFFにしました。" };
}

/**
 * 子の教育（§9.4）。個人資産と1APを投じ、教育レベルを上げて子の成長を加速（即時に一段成長）。
 */
export function educateChild(state: ProtoGameState, childId: Id): ActionResult {
  const child = state.people[childId];
  if (!child || child.relationToPC !== "child") return fail(state, "対象の子が見つかりません。");
  if (state.ap < 1) return fail(state, "APが足りません（必要1AP）。");
  if (state.pc.wealth < EDU_COST) return fail(state, `教育費 $${EDU_COST.toLocaleString()} が不足しています。`);
  const edu = (state.childEducation[childId] ?? 0) + 1;
  const env = { factor: clamp(CHILD_GROW_ENV + edu * EDU_GROWTH_K, 0.5, 3.0) };
  const grown = applyGrowth(child, env); // 即時に一段成長（教育の手応え）
  return {
    state: {
      ...state, ap: state.ap - 1,
      pc: { ...state.pc, wealth: state.pc.wealth - EDU_COST },
      people: withPerson(state, grown),
      childEducation: { ...state.childEducation, [childId]: edu },
    },
    ok: true,
    message: `📚 ${child.name} に教育を施しました（教育Lv${edu}）。`,
  };
}

/**
 * 役割配属（§4.6）。配属で使用係数(成長)と役割貢献(QUAL/TRAC)が有効になる。
 */
export function assignRole(state: ProtoGameState, personId: Id, role: Role): ActionResult {
  const p = state.people[personId];
  if (!p) return fail(state, "対象が見つかりません。");
  const isPC = personId === state.pc.personId; // v0.16：社長は特例で配属可（employeeIds非会員のまま）
  if (!isPC && !state.employeeIds.includes(personId)) return fail(state, `${p.name}は社員ではありません。`);
  if (state.ap < AP_COST.assign) return fail(state, `APが足りません（必要${AP_COST.assign}AP）。`);

  const updated: Person = { ...p, assignedRole: role };
  let next: ProtoGameState = { ...state, ap: state.ap - AP_COST.assign, people: withPerson(state, updated) };
  // 社長が現場に立つと apMax が下がる → 現在APも新上限にクランプ（経営judgeが手薄に）。
  if (isPC) next = { ...next, ap: Math.min(next.ap, effectiveApMax(next)) };
  return {
    state: next,
    ok: true,
    message: isPC ? `社長が現場へ：${p.name}（社長・兼務）→ ${role}（AP上限−${state.apMax - effectiveApMax(next)}）` : `配属：${p.name} → ${role}`,
  };
}

/** 社長を実務から外す（v0.16）。assignedRole と製品配属を解除し、apMax を回復。 */
export function releasePC(state: ProtoGameState): ActionResult {
  const pcId = state.pc.personId;
  const p = state.people[pcId];
  if (!p || p.assignedRole == null) return fail(state, "社長は現在、実務に就いていません。");
  const assignments = { ...state.assignments };
  delete assignments[pcId];
  return {
    state: { ...state, people: withPerson(state, { ...p, assignedRole: null }), assignments },
    ok: true,
    message: `社長が実務を離れ、経営に専念します（AP上限が回復）。`,
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
    devTurns: 0, QUAL_p: 0, qualFloor: 0, // 通常の新製品は担当チームで品質が決まる
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
  const isPC = personId === state.pc.personId; // v0.16：社長は特例で製品配属可
  if (!isPC && !state.employeeIds.includes(personId)) return fail(state, "社員ではありません。");
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

  const skill = analysisSkill(workforce(state)); // v0.16：実務PCも分析戦力に含む
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
