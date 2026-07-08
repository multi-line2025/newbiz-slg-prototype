/**
 * ======================================================================
 *  family.ts  個人キャリア＆家族システム（v0.13・§9 人生ループ）
 * ----------------------------------------------------------------------
 *  恋愛/結婚（評判の釣り合いゲート）・妊娠/出産（妊孕性・PA継承）・子の教育。
 *  独立サブシステム：既存の経営ロジック（収支・QUAL・市場）には影響させない。
 *  純粋関数（stepFamily は rng を引数で受ける＝決定論）。
 * ======================================================================
 */

import type { PRNG } from "./prng";
import type { Person, Sex } from "./model/types";
import type { ProtoGameState, Pregnancy } from "./state";
import {
  REP_MATCH_MAX, ROMANCE_MIN_AGE, CONCEIVE_BASE, GESTATION_TURNS, PA_MUTATION,
  EDU_GROWTH_K, CHILD_GROW_ENV,
} from "./model/constants";
import { buildPerson, computeCA } from "./person";
import { applyGrowth } from "./growth";
import { clamp } from "./util";

/** PC本人の Person。 */
export function pcPerson(state: ProtoGameState): Person {
  return state.people[state.pc.personId];
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

/**
 * 恋愛/結婚の相手プール＝ワールドの独身成人（§原案6・DBから選ぶ）。
 *  異性・成人・独身(relationToPC==="none")・非血族。社内恋愛可（社員も対象）。
 */
export function eligiblePartners(state: ProtoGameState): Person[] {
  const pc = pcPerson(state);
  return Object.values(state.people).filter(
    (p) =>
      p.id !== pc.id &&
      p.sex !== pc.sex && // 異性（妊娠機構の都合・簡略。判断で補足）
      p.age >= ROMANCE_MIN_AGE &&
      p.relationToPC === "none" && // 独身（lover/spouse/child でない）
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
  return child;
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

  // --- 3) 妊娠→出産（§9.3） ---
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
  } else if (s.pc.spouseId) {
    // 未妊娠かつ既婚：受胎判定（両親の妊孕性が積で効く）
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
