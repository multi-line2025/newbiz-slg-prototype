/**
 * ======================================================================
 *  person.ts  人材（Person）の生成と CA 算出
 * ----------------------------------------------------------------------
 *  - computeCA : 可視能力値21項目の平均×10（仕様 §4.5）
 *  - buildPerson : 性別・年齢・国籍・能力値・人格を生成（仕様 §4.10.2 / §4.10）
 *  name_generator.py の氏名生成を統合。
 * ======================================================================
 */

import type { PRNG } from "./prng";
import type {
  Person,
  Attributes,
  PlayableCountry,
  JobCategory,
  Sex,
  Era,
} from "./model/types";
import { generateName } from "./model/names";
import { MATURITY_CURVE, BASE_LIFE, LIFE_K } from "./model/constants";
import { clamp, sum, interpolateCurve } from "./util";
import { effectiveSalary } from "./salary";

/** 職業カテゴリの一覧（生成時にランダム割当）。 */
const JOB_CATEGORIES: JobCategory[] = [
  "engineer",
  "designer",
  "marketer",
  "sales",
  "finance",
  "researcher",
  "manager",
];

/** 国コード → 所属クラスタ（数値定義書 §2.2）。 */
const CLUSTER_BY_COUNTRY: Record<PlayableCountry, string> = {
  JP: "EA",
  SG: "SEA",
  US: "NA",
  GB: "UK",
  DE: "EU",
};

/**
 * 可視能力値（専門技能7＋メンタル11＋コンディション3＝21項目）の平均×10。
 * 人格・隠しパラメータは CA に計上しない（仕様 §4.5）。
 * @returns CA（0〜200に丸めてクランプ）
 */
export function computeCA(attr: Attributes): number {
  const visible = [
    ...Object.values(attr.occupational), // 専門技能 7項目
    ...Object.values(attr.mental), // メンタル 11項目
    ...Object.values(attr.condition), // コンディション 3項目
  ];
  const avg = sum(visible) / visible.length;
  return clamp(Math.round(10 * avg), 0, 200);
}

/** 生成時CAの成熟度 maturity(age)（数値定義書 §4.10）。 */
export function maturity(age: number): number {
  return interpolateCurve(MATURITY_CURVE, age);
}

/** 寿命の再評価（仕様 §4.4）。 */
export function recomputeLifeExpectancy(p: Person): number {
  return BASE_LIFE + (p.attributes.condition.health - 10) * LIFE_K;
}

/**
 * 目標平均値 target（1〜20）まわりに散らして1能力値を生成する。
 * これにより「可視能力値の平均×10 ≒ 目標CA」を満たす能力値セットを作れる。
 */
function genAttr(targetAvg: number, rng: PRNG, spread = 2): number {
  return clamp(Math.round(rng.normal(targetAvg, spread)), 1, 20);
}

/** buildPerson に渡す生成パラメータ。 */
export interface BuildPersonParams {
  PA: number; // 潜在能力（0-200）＝抽選済み
  age: number; // 年齢
  nationality: PlayableCountry; // 国籍
  era: Era; // 現在のEra（未使用だが将来の人格傾向用に受け取る）
  hireCountry?: PlayableCountry; // 要求給与の最低賃金係数の基準（起業国）。既定は国籍
  sex?: Sex; // 指定があれば固定
  jobCategory?: JobCategory;
}

/**
 * 人材を1人生成する（仕様 §4.10.2）。
 * PA は抽選済みで渡し、年齢に応じた生成時CA（原石度）を能力値に反映する。
 */
export function buildPerson(params: BuildPersonParams, rng: PRNG, idPrefix = "p"): Person {
  const { PA, age, nationality } = params;
  const sex: Sex = params.sex ?? (rng.chance(0.5) ? "male" : "female");
  const jobCategory: JobCategory =
    params.jobCategory ?? JOB_CATEGORIES[rng.int(0, JOB_CATEGORIES.length - 1)];

  // 生成時CA = PA × 成熟度(age) × ノイズ[0.95,1.05]（仕様 §4.10.2）
  const targetCA = clamp(PA * maturity(age) * rng.noise(0.05), 1, PA);
  const targetAvg = targetCA / 10; // 可視能力値の目標平均（1-20）

  // 可視能力値（①専門技能②メンタル③コンディション）を目標平均まわりに生成
  const attributes: Attributes = {
    occupational: {
      engineering: genAttr(targetAvg, rng),
      design: genAttr(targetAvg, rng),
      marketing: genAttr(targetAvg, rng),
      sales: genAttr(targetAvg, rng),
      finance: genAttr(targetAvg, rng),
      research: genAttr(targetAvg, rng),
      management: genAttr(targetAvg, rng),
    },
    mental: {
      composure: genAttr(targetAvg, rng),
      decisions: genAttr(targetAvg, rng),
      determination: genAttr(targetAvg, rng),
      concentration: genAttr(targetAvg, rng),
      anticipation: genAttr(targetAvg, rng),
      creativity: genAttr(targetAvg, rng),
      vision: genAttr(targetAvg, rng),
      leadership: genAttr(targetAvg, rng),
      teamwork: genAttr(targetAvg, rng),
      ambition: genAttr(targetAvg, rng),
      bravery: genAttr(targetAvg, rng),
    },
    condition: {
      // コンディションは若い人ほど高め（年齢を軽く反映）
      stamina: genAttr(clamp(targetAvg + (35 - age) / 15, 1, 20), rng),
      stressResist: genAttr(targetAvg, rng),
      health: genAttr(clamp(targetAvg + (35 - age) / 15, 3, 20), rng),
    },
    // ④人格・隠しは CA非計上の「無料の修正子」。独立に1-20でランダム生成（仕様 §4.8）
    hidden: {
      integrity: rng.int(1, 20),
      professionalism: rng.int(1, 20),
      adaptability: rng.int(1, 20),
      consistency: rng.int(1, 20),
      loyalty: rng.int(1, 20),
      temperament: rng.int(1, 20),
      controversy: rng.int(1, 20),
      durability: rng.int(1, 20),
    },
  };

  // 生成した能力値から実CAを算出。ノイズで target を上振れても CA ≤ PA を保証（仕様 §4.5）
  const CA = Math.min(computeCA(attributes), PA);

  const person: Person = {
    id: `${idPrefix}-${rng.nextSeed().toString(36)}`,
    name: generateName(nationality, sex, rng),
    sex,
    bloodlineId: null,
    age,
    retirementAge: 65,
    lifeExpectancy: BASE_LIFE + (attributes.condition.health - 10) * LIFE_K,
    fertility: 0,
    nationality,
    residence: nationality,
    cluster: CLUSTER_BY_COUNTRY[nationality],
    jobCategory,
    assignedRole: null,
    CA,
    PA,
    attributes,
    // 実効要求給与＝§4.3本式（職種×CA帯の基準給与×忠誠オフセット×国別最低賃金係数）
    salaryDemand: effectiveSalary(
      jobCategory,
      CA,
      attributes.hidden.loyalty,
      params.hireCountry ?? nationality
    ),
    morale: 60,
    reputation: 0,
    scoutLevel: 0,
    languages: [nationality],
    contract: null,
    traits: [],
    relationToPC: "none",
    isSuccessorCandidate: false,
  };
  return person;
}
