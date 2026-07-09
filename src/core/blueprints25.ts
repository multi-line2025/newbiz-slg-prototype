/**
 * ======================================================================
 *  blueprints25.ts  25セクター経済の青写真タイムライン（データ層・v0.20 PhaseA）
 * ----------------------------------------------------------------------
 *  企画Excel v0.4 から抽出済みの blueprintTimeline.json を唯一の真実源として読み込み、
 *  型付き構造＋検索/逆引き/解禁可否ヘルパを提供する。
 *  ※ PhaseA：経済ロジックには一切干渉しない（表示＋可否判定のみ）。
 *     25セクター市場化・サービス開発の経済反映は PhaseB で行う。
 * ======================================================================
 */

import raw from "./data/blueprintTimeline.json";

/** セクター（25）。 */
export interface Sector25 { no: number; name: string; category: string; count: number; }
/** 基盤技術（9・ツリーの根）。spread＝波及先の人間可読テキスト。 */
export interface Foundation { name: string; spread: string; note: string; }
/** 要素技術（87）。year＝解禁年、field＝分野。 */
export interface Tech { id: string; name: string; year: number; field: string; }
/** サービス青写真（124）。gateYear＝着手可能年、prereqTechIds＝前提技術、cost＝4専門別ポイント。 */
export interface Service {
  no: number;
  sectorName: string;
  histYear: number;
  gateYear: number;
  slack: number;
  service: string;
  prereqTechIds: string[];
  cost: { eng: number; des: number; res: number; mgt: number; total: number };
}
/** 年帯ごとのコストスケール（9帯）。 */
export interface CostScaleBand { band: string; scale: number; }
/** セクター別の4専門重みプロファイル（25）。 */
export interface SectorProfile { no: number; sector: string; eng: number; des: number; res: number; mgt: number; tendency: string; }

// --- 唯一の真実源（JSON）を型付けして公開 ---
export const SECTORS25: Sector25[] = raw.sectors as Sector25[];
export const FOUNDATIONS: Foundation[] = raw.foundations as Foundation[];
export const TECHS: Tech[] = raw.techs as Tech[];
export const SERVICES: Service[] = raw.services as Service[];
export const COST_SCALE: CostScaleBand[] = raw.costScale as CostScaleBand[];
export const SECTOR_PROFILES: SectorProfile[] = raw.sectorProfiles as SectorProfile[];

// --- 索引（検索・逆引き） ---
const TECH_BY_ID = new Map<string, Tech>(TECHS.map((t) => [t.id, t]));
const SECTOR_PROFILE_BY_NAME = new Map<string, SectorProfile>(SECTOR_PROFILES.map((p) => [p.sector, p]));

/** 技術をidで引く。 */
export function techById(id: string): Tech | undefined { return TECH_BY_ID.get(id); }
/** セクター名で4専門プロファイルを引く。 */
export function sectorProfile(name: string): SectorProfile | undefined { return SECTOR_PROFILE_BY_NAME.get(name); }

/** ある技術を前提に含むサービス群（tech→依存service の逆引き）。 */
export function servicesRequiringTech(techId: string): Service[] {
  return SERVICES.filter((s) => s.prereqTechIds.includes(techId));
}
/** あるサービスの前提技術（service→prereqTechs）。存在しないidは除外。 */
export function prereqTechsOf(service: Service): Tech[] {
  return service.prereqTechIds.map((id) => techById(id)).filter((t): t is Tech => !!t);
}

/* ============================================================
 * 解禁ロジック（データ駆動・経済非干渉・PhaseA）
 * ============================================================ */

/** 技術が利用可能か：ゲーム内年 ≥ 解禁年。 */
export function techAvailable(tech: Tech, gameYear: number): boolean {
  return gameYear >= tech.year;
}

/** サービスの解禁状態。 */
export interface ServiceStatus {
  yearReached: boolean;   // gameYear ≥ gateYear
  missingTechs: Tech[];   // まだ未解禁の前提技術
  unlockable: boolean;    // 年到達 かつ 全前提技術が可用 → 着手可能
  earliestYear: number;   // 着手可能になる最早年（gateYear と 前提技術の最遅解禁年の大きい方）
}

/** サービスの解禁可否を評価する。 */
export function serviceStatus(service: Service, gameYear: number): ServiceStatus {
  const prereqs = prereqTechsOf(service);
  const missingTechs = prereqs.filter((t) => !techAvailable(t, gameYear));
  const yearReached = gameYear >= service.gateYear;
  const latestTechYear = prereqs.reduce((m, t) => Math.max(m, t.year), 0);
  return {
    yearReached,
    missingTechs,
    unlockable: yearReached && missingTechs.length === 0,
    earliestYear: Math.max(service.gateYear, latestTechYear),
  };
}

/** その年帯のコストスケール（年→帯）。年帯は "1980–1985" 形式。 */
export function costScaleForYear(year: number): CostScaleBand | undefined {
  return COST_SCALE.find((b) => {
    const m = b.band.match(/(\d{4}).*?(\d{4})/);
    if (!m) return false;
    return year >= Number(m[1]) && year <= Number(m[2]);
  });
}
