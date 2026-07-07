/**
 * ======================================================================
 *  research.ts  研究(RP)・青写真ツリー・Era進行・QUAL反映
 * ----------------------------------------------------------------------
 *  仕様 §12.3（RP産出）/ §5.3（青写真4ノード）/ §7.1（Era進行・陳腐化）。
 *  「研究投資 → RP_C蓄積 → 青写真解放 → QUAL上昇」の本命レバーを担う。
 * ======================================================================
 */

import type { Person, Era, Id } from "./model/types";
import {
  RP_RESEARCH_K,
  RESEARCH_COEFF_PER_1000,
  RESEARCH_COEFF_MAX,
  QUAL_BASELINE_CEILING,
  ERA_ORDER,
  ERA_INTERVAL,
  OBSOLESCENCE_FACTORS,
  MISSION_CONFLICTS,
  RP_TIER,
  SECTORS as SECTORS_ALL,
  type Sector,
  type QualFormulaTerm,
} from "./model/constants";
import { clamp } from "./util";

/** 青写真ノード（§5.3＋製品品質§2.1＋動的市場§5 tier連鎖）。 */
export interface ProtoBlueprint {
  id: Id;
  name: string;
  prerequisites: Id[]; // 前提青写真（同ブランチの1つ下のtier）
  requiredEra: Era; // 到達Era条件（＝この技術の世代。陳腐化の基準にもなる）
  rpCost: number; // 解放に必要な社RP（tier逓増・§5.4）
  qualBonus: number; // （旧単一QUALモデル互換・現行未使用）
  missionTags: string[]; // ミッション整合判定に使うタグ
  requiredLicense: string | null; // 必要ライセンス（初版は充足扱い）
  targetSector: Sector; // 製品を出せるセクター（§2.1）
  qualFormula: QualFormulaTerm[]; // 製品QUALの品質規定式（重み合計1.0・§2.2）
  qualPolishAbilities: (keyof import("./model/types").MentalAttributes)[]; // 副参照（qualPolish）
  tier: 1 | 2 | 3 | 4; // 【新・§5】ツリーの深さ（1=参入切符 / 4=特化の頂点）
  branchId: Sector; // 【新・§5】同一セクター連鎖の識別（＝targetSector）
}

/** 各セクターのブランチ定義（tier1＝参入切符）。tier2〜4は下で自動生成する。 */
interface BranchDef {
  sector: Sector;
  tier1Id: Id;
  tier1Name: string;
  requiredEra: Era;
  missionTags: string[];
  requiredLicense: string | null;
  qualFormula: QualFormulaTerm[];
  qualPolishAbilities: (keyof import("./model/types").MentalAttributes)[];
  tierNames: [string, string, string]; // tier2/3/4 の名称
}

const BRANCHES: BranchDef[] = [
  {
    sector: "S1", tier1Id: "BP-101", tier1Name: "基礎ウェブ", requiredEra: "internet",
    missionTags: [], requiredLicense: null,
    qualFormula: [{ role: "designer", ability: "design", weight: 0.5 }, { role: "engineer", ability: "engineering", weight: 0.5 }],
    qualPolishAbilities: ["creativity", "vision"],
    tierNames: ["Webアプリ基盤", "SaaSプラットフォーム", "大規模Web分散基盤"],
  },
  {
    sector: "S2", tier1Id: "BP-210", tier1Name: "モバイル基盤", requiredEra: "smartphone",
    missionTags: [], requiredLicense: null,
    qualFormula: [{ role: "engineer", ability: "engineering", weight: 0.6 }, { role: "designer", ability: "design", weight: 0.4 }],
    qualPolishAbilities: ["creativity", "concentration"],
    tierNames: ["ネイティブアプリ", "モバイルSDK", "スーパーアプリ基盤"],
  },
  {
    sector: "S3", tier1Id: "BP-330", tier1Name: "フィンテック基礎", requiredEra: "internet",
    missionTags: [], requiredLicense: "金融ライセンス",
    qualFormula: [{ role: "engineer", ability: "engineering", weight: 0.5 }, { role: "finance", ability: "finance", weight: 0.3 }, { role: "researcher", ability: "research", weight: 0.2 }],
    qualPolishAbilities: ["decisions", "concentration"],
    tierNames: ["決済プラットフォーム", "融資エンジン", "統合金融基盤"],
  },
  {
    sector: "S4", tier1Id: "BP-450", tier1Name: "生成AI基礎", requiredEra: "ai",
    missionTags: ["高自動化"], requiredLicense: null,
    qualFormula: [{ role: "researcher", ability: "research", weight: 0.6 }, { role: "engineer", ability: "engineering", weight: 0.4 }],
    qualPolishAbilities: ["creativity", "anticipation"],
    tierNames: ["基盤モデル", "エージェント基盤", "汎用AI基盤"],
  },
  {
    sector: "S5", tier1Id: "BP-620", tier1Name: "EC基盤", requiredEra: "dawn",
    missionTags: [], requiredLicense: null,
    qualFormula: [{ role: "engineer", ability: "engineering", weight: 0.4 }, { role: "marketer", ability: "marketing", weight: 0.3 }, { role: "designer", ability: "design", weight: 0.3 }],
    qualPolishAbilities: ["anticipation", "creativity"],
    tierNames: ["マーケットプレイス", "物流最適化EC", "グローバルEC基盤"],
  },
  {
    sector: "S6", tier1Id: "BP-510", tier1Name: "福祉サービス", requiredEra: "dawn",
    missionTags: [], requiredLicense: null,
    qualFormula: [{ role: "sales", ability: "sales", weight: 0.8 }, { role: "manager", ability: "management", weight: 0.2 }],
    qualPolishAbilities: ["composure", "teamwork"],
    tierNames: ["訪問介護network", "対人ケア統合", "福祉プラットフォーム"],
  },
];

/** ブランチ定義からtier1〜4の全ノードを展開する。 */
function buildBlueprints(): ProtoBlueprint[] {
  const out: ProtoBlueprint[] = [];
  for (const b of BRANCHES) {
    let prevId: Id | null = null;
    for (let tier = 1 as 1 | 2 | 3 | 4; tier <= 4; tier = (tier + 1) as 1 | 2 | 3 | 4) {
      const id = tier === 1 ? b.tier1Id : `${b.sector}-t${tier}`;
      const name = tier === 1 ? b.tier1Name : b.tierNames[tier - 2];
      out.push({
        id, name,
        prerequisites: prevId ? [prevId] : [], // 同ブランチの1つ下のtierが前提
        requiredEra: b.requiredEra,
        rpCost: RP_TIER[tier],
        qualBonus: 8, missionTags: b.missionTags, requiredLicense: b.requiredLicense,
        targetSector: b.sector, qualFormula: b.qualFormula, qualPolishAbilities: b.qualPolishAbilities,
        tier, branchId: b.sector,
      });
      prevId = id;
    }
  }
  return out;
}

/** 全青写真（6セクター × tier1〜4 ＝ 24ノード）。 */
export const BLUEPRINTS: ProtoBlueprint[] = buildBlueprints();

/** セクター→そのセクターのtier1青写真（参入切符）を引く。 */
export function blueprintForSector(sector: Sector): ProtoBlueprint | undefined {
  return BLUEPRINTS.find((b) => b.targetSector === sector && b.tier === 1);
}

/** id から青写真定義を引く。 */
export function getBlueprint(id: Id): ProtoBlueprint | undefined {
  return BLUEPRINTS.find((b) => b.id === id);
}

/** 会社がそのセクターで到達している最深tier（保有ノードの最大tier。未保有=0）。 */
export function sectorTier(sector: Sector, unlockedBlueprints: Id[]): number {
  let maxTier = 0;
  for (const id of unlockedBlueprints) {
    const bp = getBlueprint(id);
    if (bp && bp.targetSector === sector && bp.tier > maxTier) maxTier = bp.tier;
  }
  return maxTier;
}

/** breadth（tier1切符を持つセクター数）と depth（最深ブランチのtier）。 */
export function breadthDepth(unlockedBlueprints: Id[]): { breadth: number; depth: number } {
  const tiers = SECTORS_ALL.map((s) => sectorTier(s, unlockedBlueprints));
  return { breadth: tiers.filter((t) => t >= 1).length, depth: Math.max(0, ...tiers) };
}

/* ---------------- Era 進行（§7.1） ---------------- */

/** Eraのインデックス。 */
export function eraIndex(era: Era): number {
  return ERA_ORDER.indexOf(era);
}

/**
 * 開始Eraとターンから現在Eraを求める（プロトタイプ簡略：一定ターンごとに次Eraへ）。
 * @param startEra 開始Era
 * @param turn 現在ターン（1始まり）
 */
export function eraForTurn(startEra: Era, turn: number): Era {
  const start = eraIndex(startEra);
  const steps = Math.floor((turn - 1) / ERA_INTERVAL);
  const idx = clamp(start + steps, 0, ERA_ORDER.length - 1);
  return ERA_ORDER[idx];
}

/** ある青写真が現Eraに到達しているか（requiredEra 以上）。 */
export function eraReached(bp: ProtoBlueprint, era: Era): boolean {
  return eraIndex(era) >= eraIndex(bp.requiredEra);
}

/* ---------------- 陳腐化・QUAL反映（§7.1） ---------------- */

/** 陳腐化係数：現Eraが青写真世代より進むほどQUAL寄与が下がる。 */
export function obsolescenceFactor(bp: ProtoBlueprint, era: Era): number {
  const gen = eraIndex(era) - eraIndex(bp.requiredEra);
  if (gen <= 0) return OBSOLESCENCE_FACTORS[0];
  const i = Math.min(gen, OBSOLESCENCE_FACTORS.length - 1);
  return OBSOLESCENCE_FACTORS[i];
}

/** 解放済み青写真1つの、現Eraでの実効QUAL寄与（陳腐化込み）。 */
export function effectiveQualBonus(bp: ProtoBlueprint, era: Era): number {
  return bp.qualBonus * obsolescenceFactor(bp, era);
}

/**
 * 解放済み青写真から現在のQUAL上限を算出（§7.1）。
 * = 基準上限 + Σ 実効QUAL寄与、[0,100]にクランプ。
 */
export function qualCeiling(unlockedIds: Id[], era: Era): number {
  let ceil = QUAL_BASELINE_CEILING;
  for (const id of unlockedIds) {
    const bp = getBlueprint(id);
    if (bp) ceil += effectiveQualBonus(bp, era);
  }
  return clamp(ceil, 0, 100);
}

/* ---------------- ミッション整合（§5.3） ---------------- */

/** 青写真がミッションと整合するか（衝突タグを持たない）。 */
export function missionAllows(bp: ProtoBlueprint, missionTags: string[]): boolean {
  for (const tag of bp.missionTags) {
    const conflicts = MISSION_CONFLICTS[tag];
    if (conflicts && conflicts.some((c) => missionTags.includes(c))) return false;
  }
  return true;
}

/* ---------------- 解放判定（§5.3） ---------------- */

/** 解放不可の理由（UIのグレーアウト説明用）。 */
export type LockReason =
  | "unlocked" // 解放済み
  | "prereq" // 前提未達
  | "era" // Era未到達
  | "rp" // RP不足
  | "mission" // ミッション衝突（グレーアウト）
  | "ok"; // 解放可能

/**
 * 青写真の状態を判定する。
 * 解放可能 = 前提済 AND Era到達 AND RP充足 AND ミッション整合（法律・国は初版充足扱い）。
 */
export function blueprintStatus(
  bp: ProtoBlueprint,
  unlockedIds: Id[],
  era: Era,
  rpC: number,
  missionTags: string[]
): LockReason {
  if (unlockedIds.includes(bp.id)) return "unlocked";
  // ミッション衝突は最優先でグレーアウト（§5.3）
  if (!missionAllows(bp, missionTags)) return "mission";
  if (!bp.prerequisites.every((p) => unlockedIds.includes(p))) return "prereq";
  if (!eraReached(bp, era)) return "era";
  if (rpC < bp.rpCost) return "rp";
  return "ok";
}

/* ---------------- RP産出（§12.3） ---------------- */

/** 研究投資係数：$1,000ごとに+0.1（上限2.0・下限0）。 */
export function researchCoeff(budget: number): number {
  return clamp((budget / 1000) * RESEARCH_COEFF_PER_1000, 0, RESEARCH_COEFF_MAX);
}

/**
 * 社RP/ターン（§12.3）＝ Σ(リサーチ役の research) × RP_RESEARCH_K × 研究投資係数。
 * リサーチ役＝assignedRole==="researcher" の社員。
 */
export function rpPerTurn(employees: Person[], budget: number): number {
  const coeff = researchCoeff(budget);
  let sumResearch = 0;
  for (const e of employees) {
    if (e.assignedRole === "researcher") sumResearch += e.attributes.occupational.research;
  }
  return sumResearch * RP_RESEARCH_K * coeff;
}
