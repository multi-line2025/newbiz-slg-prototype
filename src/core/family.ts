/**
 * ======================================================================
 *  family.ts  個人キャリア＆家族システム（v0.13・§9 人生ループ）
 * ----------------------------------------------------------------------
 *  恋愛/結婚（評判の釣り合いゲート）・妊娠/出産（妊孕性・PA継承）・子の教育。
 *  独立サブシステム：既存の経営ロジック（収支・QUAL・市場）には影響させない。
 *  純粋関数（stepFamily は rng を引数で受ける＝決定論）。
 * ======================================================================
 */

import { makePRNG, type PRNG } from "./prng";
import type { Person, Sex, PlayableCountry } from "./model/types";
import type { ProtoGameState, Pregnancy } from "./state";
import {
  REP_MATCH_MAX, ROMANCE_MIN_AGE, CONCEIVE_BASE, GESTATION_TURNS, PA_MUTATION,
  EDU_GROWTH_K, CHILD_GROW_ENV,
  LIFESTYLE_COST_BASE, SPOUSE_CONTRIB, SPOUSE_REP_PREMIUM,
  AFFORD_CASH_REF, AFFORD_REP_FULL, AFFORD_SIZE_FULL, AFFORD_W_CASH, AFFORD_W_REP, AFFORD_W_SIZE,
  MARRIAGE_POOL_SIZE, MARRIAGE_CHURN, MARRIAGE_MIN_AGE, MARRIAGE_MAX_AGE,
} from "./model/constants";
import { buildPerson, computeCA } from "./person";
import { baseSalary, effectiveSalary } from "./salary";
import { applyGrowth } from "./growth";
import { clamp } from "./util";

/** PC本人の Person。 */
export function pcPerson(state: ProtoGameState): Person {
  return state.people[state.pc.personId];
}

/** 姓（氏名の最終トークン）。子の姓継承・世代の一貫性に使う（v0.14）。 */
export function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}
/** 名（氏名の先頭トークン）。 */
function givenOf(name: string): string {
  return name.trim().split(/\s+/)[0];
}

/* ============================================================
 * v0.15：個人資産の収支（社員給与テーブルと一貫）
 *  PC役員報酬＝ manager給与(PC.CA) × 会社の支払い能力／配偶者インカム＝ effectiveSalary × 世帯拠出率。
 * ============================================================ */

/**
 * 会社の支払い能力係数（0-1）。CASH残高・評判・従業員数の加重で、
 * 序盤の小さい会社は低く（founderは薄給）、黒字化・成長で1に近づく。
 */
export function companyAffordability(state: ProtoGameState): number {
  const c = state.company;
  const cashF = clamp(c.CASH / AFFORD_CASH_REF, 0, 1);
  const repF = clamp(c.reputation / AFFORD_REP_FULL, 0, 1);
  const sizeF = clamp(state.employeeIds.length / AFFORD_SIZE_FULL, 0, 1);
  return clamp(AFFORD_W_CASH * cashF + AFFORD_W_REP * repF + AFFORD_W_SIZE * sizeF, 0, 1);
}

/**
 * PC役員報酬（会社CASH→wealth）。manager給与テーブルを PC.CA で引いた額 × 支払い能力。
 * ＝社員給与と桁が揃い、かつ会社が払える範囲に収まる（非回帰）。
 */
export function pcSalary(state: ProtoGameState): number {
  const pc = pcPerson(state);
  const managerBase = baseSalary("manager", pc.CA); // 社員と同一テーブル（rookie/mid/ace）
  return Math.round(managerBase * companyAffordability(state));
}
/** 個人の生活費（wealthから）。lifestyleに比例。 */
export function lifestyleCost(state: ProtoGameState): number {
  return Math.round(LIFESTYLE_COST_BASE * state.pc.lifestyleFactor);
}
/**
 * 配偶者インカム（世帯収入→wealth・会社CASHではない）。
 * ＝「その能力で働く社員」の実効給与 × 世帯拠出率。有能・高評判な伴侶ほど大きい（高望みの見返り）。
 */
export function spouseIncome(state: ProtoGameState): number {
  if (!state.pc.spouseId) return 0;
  const sp = state.people[state.pc.spouseId];
  if (!sp) return 0;
  const wage = effectiveSalary(sp.jobCategory, sp.CA, sp.attributes.hidden.loyalty, state.company.foundedCountry);
  const repMult = 1 + SPOUSE_REP_PREMIUM * (sp.reputation / 100); // 高評判の伴侶ほど稼ぐ
  return Math.round(wage * SPOUSE_CONTRIB * repMult);
}

/**
 * §9.3.1 妊孕性 fertility(age, sex)（0-1）。ピーク25歳。女性は40歳、男性は60歳でゼロ。
 *  16→25 で 0→1 に上昇、25以降は性別ごとの傾きで直線低下。
 */
export function fertility(age: number, sex: Sex): number {
  if (age < 16) return 0;
  const rise = clamp((age - 16) / 9, 0, 1); // 16→25 で 0→1
  if (age <= 25) return rise;
  if (sex === "female") {
    if (age >= 40) return 0;
    return clamp(1 - (age - 25) / 15, 0, 1); // 25→40 で 1→0
  }
  if (age >= 60) return 0;
  return clamp(1 - (age - 25) / 35, 0, 1); // 25→60 で 1→0（男性）
}

/**
 * ★評判の釣り合いゲート（0-1）。|rep_PC − rep_相手| がバンド内なら確率、超で0（不可）。
 *  差が小さいほど高く、REP_MATCH_MAX で0。PC評判が上がるほど高評判の相手が射程に入る。
 */
export function repMatchProbability(pcRep: number, partnerRep: number): number {
  const d = Math.abs(pcRep - partnerRep);
  if (d >= REP_MATCH_MAX) return 0; // 格が違いすぎて成立しない
  return clamp(1 - d / REP_MATCH_MAX, 0, 1);
}

/** §9.3.3 血族婚判定：同一 bloodlineId は不可（外部人材は bloodlineId=null で常に可）。 */
export function isBloodRelated(pcBloodline: string, p: Person): boolean {
  return p.bloodlineId != null && p.bloodlineId === pcBloodline;
}

/* ============================================================
 * v0.14：結婚市場（人材DBとは別の専用プール・評判分布・動的入替・スカウトfog）
 * ============================================================ */

/** 結婚候補を1人生成（評判は0-100で広く分布＝能力とは独立。scoutLevel=0でfog）。 */
export function generateMarriageCandidate(country: PlayableCountry, era: ProtoGameState["era"], rng: PRNG): Person {
  const PA = rng.int(60, 185);       // 能力は幅広い
  const age = rng.int(MARRIAGE_MIN_AGE, MARRIAGE_MAX_AGE);
  const p = buildPerson({ PA, age, nationality: country, era, hireCountry: country }, rng, "marry");
  p.reputation = rng.int(0, 100);    // ★評判は能力と独立に0-100へ広く分布（常に釣り合う相手が居る）
  p.scoutLevel = 0;                  // 未スカウト＝能力・正確な評判は不明（fog）
  p.relationToPC = "none";
  p.bloodlineId = null;              // 外部＝血族でない
  return p;
}

/** 結婚市場プールを新規生成（初期・MARRIAGE_POOL_SIZE 人）。 */
export function generateMarriagePool(country: PlayableCountry, era: ProtoGameState["era"], rng: PRNG): Person[] {
  const pool: Person[] = [];
  for (let i = 0; i < MARRIAGE_POOL_SIZE; i++) pool.push(generateMarriageCandidate(country, era, rng));
  return pool;
}

/**
 * 結婚市場を1ターン分だけ動的に入れ替える（他所で結婚して退出／新規登場）。
 * 交際中(lover)は退出させない。turn乱数と分離した専用rngで決定論（非回帰維持）。
 */
export function churnMarriagePool(state: ProtoGameState): Person[] {
  const rng = makePRNG((state.familySeed ^ (state.turn * 2654435761)) >>> 0);
  const keep: Person[] = [];
  const removable: Person[] = [];
  for (const p of state.marriagePool) {
    if (p.relationToPC === "lover") keep.push(p); // 交際中は残す
    else removable.push(p);
  }
  // 退出：非loverから MARRIAGE_CHURN 人を除く
  const churn = Math.min(MARRIAGE_CHURN, removable.length);
  const idx = new Set<number>();
  while (idx.size < churn) idx.add(rng.int(0, removable.length - 1));
  const survivors = removable.filter((_, i) => !idx.has(i));
  const next = [...keep, ...survivors];
  // 新規登場：プールサイズを維持
  while (next.length < MARRIAGE_POOL_SIZE) {
    next.push(generateMarriageCandidate(state.company.foundedCountry, state.era, rng));
  }
  return next;
}

/** 結婚市場からIDで候補を引く（lover含む）。 */
export function marriageCandidate(state: ProtoGameState, id: string): Person | undefined {
  return state.marriagePool.find((p) => p.id === id);
}

/** 現在の交際相手（lover）。無ければ null。 */
export function currentLover(state: ProtoGameState): Person | null {
  return state.marriagePool.find((p) => p.relationToPC === "lover") ?? null;
}

/** 候補の可視評判ビュー（fog）。未スカウトは評判バンドのみ、スカウト済みは正確な評判＋CA/PA。 */
export interface MarriageView {
  scouted: boolean;
  repExact: number | null; // スカウト済みのみ
  repBandLow: number;      // 未スカウト時の概略バンド
  repBandHigh: number;
  ca: number | null;
  pa: number | null;
}
export function marriageView(p: Person): MarriageView {
  if (p.scoutLevel >= 1) {
    return { scouted: true, repExact: p.reputation, repBandLow: p.reputation, repBandHigh: p.reputation, ca: p.CA, pa: p.PA };
  }
  const low = clamp(Math.floor((p.reputation - 10) / 10) * 10, 0, 100);
  return { scouted: false, repExact: null, repBandLow: low, repBandHigh: Math.min(100, low + 20), ca: null, pa: null };
}

/**
 * 恋愛/結婚の相手プール＝結婚市場の独身成人（v0.14・専用プール）。
 *  異性・成人・独身(relationToPC==="none")・非血族。
 */
export function eligiblePartners(state: ProtoGameState): Person[] {
  const pc = pcPerson(state);
  return state.marriagePool.filter(
    (p) =>
      p.sex !== pc.sex && // 異性（妊娠機構の都合・簡略。判断で補足）
      p.age >= ROMANCE_MIN_AGE &&
      p.relationToPC === "none" && // 独身（交際中の相手は別枠）
      !isBloodRelated(state.pc.bloodlineId, p)
  );
}

/** §9.3 子のPA＝両親PAの平均 ± 突然変異。1-200にクランプ。 */
export function inheritPA(fatherPA: number, motherPA: number, rng: PRNG): number {
  const avg = (fatherPA + motherPA) / 2;
  const mut = rng.int(-PA_MUTATION, PA_MUTATION);
  return clamp(Math.round(avg + mut), 1, 200);
}

/** 幼少期の能力値スケール（0歳≒0 → 成人でフル）。新生児のCAを低く保つ。 */
function childhoodScale(age: number): number {
  return clamp(age / 22, 0, 1);
}

/**
 * 0歳児を生成する（§9.3 出産）。両親PAからPA継承、bloodline継承、幼少期スケールで低CA。
 */
export function buildChild(
  state: ProtoGameState, fatherPA: number, motherPA: number, rng: PRNG
): Person {
  const PA = inheritPA(fatherPA, motherPA, rng);
  const child = buildPerson(
    { PA, age: 0, nationality: state.company.foundedCountry, era: state.era, hireCountry: state.company.foundedCountry },
    rng,
    "child"
  );
  // 幼少期は能力値を大幅に縮小（新生児＝ほぼ0）。以後 stepFamily/教育で成長。
  const scale = childhoodScale(0);
  const scaleAttrs = (g: Record<string, number>) => {
    for (const k of Object.keys(g)) g[k] = clamp(Math.round(g[k] * scale), 1, 20);
  };
  scaleAttrs(child.attributes.occupational as unknown as Record<string, number>);
  scaleAttrs(child.attributes.mental as unknown as Record<string, number>);
  scaleAttrs(child.attributes.condition as unknown as Record<string, number>);
  child.CA = Math.min(computeCA(child.attributes), PA);
  child.bloodlineId = state.pc.bloodlineId;
  child.relationToPC = "child";
  child.isSuccessorCandidate = true;
  // v0.14：姓はPCの姓を継承（名はランダムのまま）。世代をまたいで姓が一貫する。
  child.name = `${givenOf(child.name)} ${surnameOf(pcPerson(state).name)}`;
  return child;
}

/* ============================================================
 * v0.18：世代交代（引退・後継・死亡・兄弟姉妹）
 * ============================================================ */

export const SUCCESSION_MIN_AGE = 18; // 後継者指定・家族雇用の下限年齢（成人）

/** 有効な後継者（successorId が 18歳以上・存命の実子）を返す。無ければ null。 */
export function validSuccessor(state: ProtoGameState): Person | null {
  const id = state.pc.successorId;
  if (!id) return null;
  const p = state.people[id];
  if (!p) return null;
  if (!state.pc.childrenIds.includes(id)) return null;
  if (p.age < SUCCESSION_MIN_AGE) return null;
  return p;
}

/** 家族として直接雇用できる人物か（18歳以上の実子 or 兄弟姉妹・未雇用・存命）。 */
export function isHireableFamily(state: ProtoGameState, personId: string): boolean {
  const p = state.people[personId];
  if (!p) return false;
  if (state.employeeIds.includes(personId)) return false;
  if (p.age < SUCCESSION_MIN_AGE) return false;
  return state.pc.childrenIds.includes(personId) || state.pc.siblingIds.includes(personId);
}

/** 家族メンバー（実子・兄弟姉妹）か。UIの常時可視（フォグ対象外）に使う。 */
export function isFamilyMember(state: ProtoGameState, personId: string): boolean {
  return state.pc.childrenIds.includes(personId) || state.pc.siblingIds.includes(personId) || personId === state.pc.spouseId;
}

/**
 * 世代交代（succeed・§10）。指定後継者を新PCにし、generation++・wealth相続・会社継続。
 *  前PCの他の子＝新PCの兄弟姉妹(relative)、前PCは故人(peopleから除外)。新PCは独身スタート。
 *  ※ 呼び出し側で validSuccessor 済みを前提。
 */
export function succeed(state: ProtoGameState): { state: ProtoGameState; events: string[]; heir: Person } {
  const oldPcId = state.pc.personId;
  const heirId = state.pc.successorId!;
  const heir = state.people[heirId];
  const events: string[] = [];

  const people = { ...state.people };
  // 前PCは故人（people から除外）
  delete people[oldPcId];
  // 前PCの他の子 → 新PCの兄弟姉妹（relative）。既存の兄弟姉妹も引き継ぐ。
  const newSiblings = state.pc.childrenIds.filter((id) => id !== heirId && people[id]);
  for (const id of newSiblings) {
    people[id] = { ...people[id], relationToPC: "relative", isSuccessorCandidate: false };
  }
  // 新PC本人：主人公化（relationToPC=none・実務役割は解除）
  people[heirId] = { ...heir, relationToPC: "none", assignedRole: null };

  // 新PCが社員だった場合は employeeIds/assignments から外す（主人公化）
  const employeeIds = state.employeeIds.filter((id) => id !== heirId);
  const assignments = { ...state.assignments };
  delete assignments[heirId];

  // 兄弟姉妹＝前世代の兄弟＋今回の他の子（重複除去・故人除外）
  const siblingIds = [...state.pc.siblingIds, ...newSiblings].filter((id, i, a) => people[id] && a.indexOf(id) === i);

  const newPc = {
    personId: heirId,
    wealth: state.pc.wealth, // 家督（個人資産）を相続
    rpPersonal: 0,
    spouseId: null,          // 新PCは独身スタート
    childrenIds: [],
    lifestyleFactor: state.pc.lifestyleFactor,
    generation: state.pc.generation + 1,
    bloodlineId: state.pc.bloodlineId, // 血統は継続
    successorId: null,
    siblingIds,
  };

  // 結婚市場を新世代向けに再構成（前世代の候補は入れ替わる）。専用rng＝turn乱数と分離。
  const marriagePool = generateMarriagePool(
    state.company.foundedCountry, state.era,
    makePRNG((state.familySeed ^ (newPc.generation * 0x9e3779b1)) >>> 0)
  );

  const next: ProtoGameState = {
    ...state,
    people,
    employeeIds,
    assignments,
    pc: newPc,
    pregnancy: null,
    childEducation: {}, // 新世代の教育投資はリセット
    marriagePool,
    ap: state.apMax,    // 新PCは標準AP（実務未就任）
  };
  events.push(`🎗 世代交代：${heir.name}（第${newPc.generation}世代）が事業を継承しました。会社と個人資産を相続。`);
  if (siblingIds.length > 0) events.push(`👨‍👩‍👧 ${siblingIds.length}人の兄弟姉妹が一族に。家族タブから直接雇用できます。`);
  return { state: next, events, heir };
}

/** 世代交代 or 事業終了を解決する（死亡・引退の共通処理）。 */
export function resolveSuccessionOrEnd(state: ProtoGameState, deathOrRetireMsg: string): { state: ProtoGameState; events: string[] } {
  const events: string[] = [deathOrRetireMsg];
  if (validSuccessor(state)) {
    const r = succeed(state);
    events.push(...r.events);
    return { state: r.state, events };
  }
  events.push(`【ゲームオーバー】後継者が不在のため、事業は幕を閉じました。`);
  return { state: { ...state, gameOver: true, endTurn: state.turn }, events };
}

/** 家族ステップの戻り値。 */
export interface FamilyStepResult {
  state: ProtoGameState;
  events: string[];
}

/**
 * 1ターンの家族処理（§9.3）：PC評判の進行、子の成長（教育で加速）、妊娠判定→出産。
 *  加齢自体は turn.ts の共通加齢ループが people 全員に適用済み（PC・子・配偶者も加齢）。
 */
export function stepFamily(state: ProtoGameState, rng: PRNG): FamilyStepResult {
  let s = state;
  const events: string[] = [];

  // --- 0) PC死亡（寿命到達・§10/§11）。決定論：age >= lifeExpectancy で他界 ---
  //   有効な後継者あり → 世代交代／なし → ゲーム終了。（寿命≒70代＝20Tプレイテストには不到達＝非回帰）
  {
    const pc = s.people[s.pc.personId];
    if (pc && pc.age >= pc.lifeExpectancy) {
      return resolveSuccessionOrEnd(s, `🕯 創業者 ${pc.name} が天寿を全う（享年${Math.floor(pc.age)}）。`);
    }
  }

  const people = { ...s.people };

  // --- 1) PC個人評判の進行（会社の成功が個人の格を上げる＝進行報酬） ---
  {
    const pc = people[s.pc.personId];
    if (pc) {
      const target = clamp(s.company.reputation + s.achievements.length * 4, 0, 100);
      const rep = clamp(pc.reputation + (target - pc.reputation) * 0.25, 0, 100);
      people[s.pc.personId] = { ...pc, reputation: rep };
    }
  }

  // --- 2) 子の成長（教育レベルで env を上げて加速・§9.4） ---
  for (const cid of s.pc.childrenIds) {
    const child = people[cid];
    if (!child || child.age >= 25) continue;
    const edu = s.childEducation[cid] ?? 0;
    const env = { factor: clamp(CHILD_GROW_ENV + edu * EDU_GROWTH_K, 0.5, 3.0) };
    people[cid] = applyGrowth(child, env);
  }
  s = { ...s, people };

  // --- 2b) 個人資産の収支（v0.14）：PC役員報酬（会社CASH→wealth）＋配偶者インカム − 生活費 ---
  {
    const salary = pcSalary(s);
    const income = spouseIncome(s);
    const living = lifestyleCost(s);
    s = {
      ...s,
      company: { ...s.company, CASH: s.company.CASH - salary }, // 会社が役員報酬を支出
      pc: { ...s.pc, wealth: s.pc.wealth + salary + income - living },
    };
  }

  // --- 2c) 結婚市場の動的入替（v0.14・専用rngでturn乱数と分離＝経済は非回帰） ---
  s = { ...s, marriagePool: churnMarriagePool(s) };

  // --- 3) 妊娠→出産（§9.3。子作りトグルONのターンのみ受胎判定・v0.14） ---
  if (s.pregnancy) {
    if (s.turn >= s.pregnancy.dueTurn) {
      const father = s.people[s.pregnancy.fatherId];
      const mother = s.people[s.pregnancy.motherId];
      if (father && mother) {
        const child = buildChild(s, father.PA, mother.PA, rng);
        s = {
          ...s,
          people: { ...s.people, [child.id]: child },
          pc: { ...s.pc, childrenIds: [...s.pc.childrenIds, child.id] },
          pregnancy: null,
        };
        events.push(`👶 出産：${child.name}（第${s.pc.childrenIds.length}子・${child.sex === "female" ? "女" : "男"}の子）が誕生しました。`);
      } else {
        s = { ...s, pregnancy: null };
      }
    }
  } else if (s.pc.spouseId && s.tryForChild) {
    // 未妊娠・既婚・子作りON：受胎判定（両親の妊孕性が積で効く）
    const pc = pcPerson(s);
    const spouse = s.people[s.pc.spouseId];
    if (spouse) {
      const mother = pc.sex === "female" ? pc : spouse;
      const father = pc.sex === "female" ? spouse : pc;
      const fMother = fertility(mother.age, "female");
      const fFather = fertility(father.age, "male");
      const healthAdj = clamp((mother.attributes.condition.health / 20) * 0.5 + 0.5, 0.5, 1.0);
      const pConceive = CONCEIVE_BASE * fMother * fFather * healthAdj;
      if (fMother > 0 && fFather > 0 && rng.chance(pConceive)) {
        const preg: Pregnancy = { motherId: mother.id, fatherId: father.id, dueTurn: s.turn + GESTATION_TURNS };
        s = { ...s, pregnancy: preg };
        events.push(`💛 ${mother.id === pc.id ? "あなた" : spouse.name} が妊娠しました（約${GESTATION_TURNS}ヶ月後に出産予定）。`);
      }
    }
  }

  return { state: s, events };
}
