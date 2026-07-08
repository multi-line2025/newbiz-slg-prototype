/**
 * ======================================================================
 *  constants.ts  数値定義書 v0.1 の「定数の正典」を投入
 * ----------------------------------------------------------------------
 *  出典: 企画チーム『数値定義書_v0.1』（NUM-DEF-0.1）。
 *  各定数は数値定義書の節番号を根拠コメントとして付す。
 *  ★印は「要プレイテスト」＝プロトタイプ計測後に再調整予定の値。
 * ======================================================================
 */

import type {
  Era,
  PlayableCountry,
  PaTier,
  ReputationGate,
  JobCategory,
} from "./types";

/* ============================================================
 * 1. 成長・減衰係数（数値定義書 §1）
 * ============================================================ */

/** 成長係数を計算するときの能力カテゴリ。 */
export type GrowthCategory = "occupational" | "mental" | "condition" | "hidden";

/** §1.1 カテゴリ別 基準成長量 base_cat。 */
export const BASE_BY_CAT: Record<GrowthCategory, number> = {
  occupational: 0.1, // 専門技能：速い
  mental: 0.05, // メンタル：ゆっくり
  condition: 0.08, // コンディション：中
  hidden: 0.01, // 人格：ほぼ固定（ドリフトのみ）
};

/** 折れ線カーブの1点（age→係数）。表の間は線形補間する。 */
export interface CurvePoint {
  age: number;
  value: number;
}

/** §1.2 カテゴリ別 年齢係数カーブ（負値＝減衰）。 */
export const AGE_CURVE: Record<GrowthCategory, CurvePoint[]> = {
  // ① 専門技能（ピーク35〜45、以降 不使用なら萎縮）
  occupational: [
    { age: 20, value: 1.2 },
    { age: 25, value: 1.1 },
    { age: 30, value: 0.9 },
    { age: 35, value: 0.5 },
    { age: 40, value: 0.2 },
    { age: 45, value: 0.0 },
    { age: 50, value: -0.15 },
    { age: 60, value: -0.3 },
    { age: 70, value: -0.45 },
  ],
  // ② メンタル（定年間近ピーク・終始プラス）
  mental: [
    { age: 20, value: 0.6 },
    { age: 30, value: 0.7 },
    { age: 40, value: 0.8 },
    { age: 50, value: 0.9 },
    { age: 60, value: 0.7 },
    { age: 65, value: 0.3 },
  ],
  // ③ コンディション（40歳ピーク・以降最も落ちる）
  condition: [
    { age: 20, value: 1.0 },
    { age: 30, value: 0.8 },
    { age: 40, value: 0.3 },
    { age: 45, value: -0.2 },
    { age: 50, value: -0.5 },
    { age: 60, value: -0.9 },
    { age: 70, value: -1.3 },
  ],
  // ④ 人格（ほぼ固定・劣悪環境時のみ微ドリフト）
  hidden: [{ age: 0, value: 0.0 }],
};

/** §1.3 ageAmbitionWeight（野心の年齢調整）。 */
export const AGE_AMBITION_WEIGHT: CurvePoint[] = [
  { age: 25, value: 1.0 },
  { age: 35, value: 0.8 },
  { age: 45, value: 0.6 },
  { age: 55, value: 0.4 },
  { age: 60, value: 0.2 },
];

/** §1.6 使用係数 useF。 */
export const USE_FACTOR = {
  primary: 1.0, // 主参照能力（実務で使う）
  secondary: 0.6, // 副参照
  unused: 0.3, // 配属外（萎縮方向）
};

/** §4.10 生成時CAの成熟度 maturity(age)。 */
export const MATURITY_CURVE: CurvePoint[] = [
  { age: 22, value: 0.5 },
  { age: 25, value: 0.58 },
  { age: 30, value: 0.7 },
  { age: 35, value: 0.85 },
  { age: 40, value: 0.95 },
  { age: 45, value: 1.0 },
];

/* ============================================================
 * 2. 国別係数（数値定義書 §2）
 * ============================================================ */

/** §2.1 国別3係数（基準＝米国1.0）。 */
export interface CountryFactors {
  poolThickness: number; // 人材プール厚み係数
  marketSize: number; // 市場規模係数
  minWage: number; // 最低賃金係数
}

export const COUNTRY_FACTORS: Record<PlayableCountry, CountryFactors> = {
  US: { poolThickness: 1.0, marketSize: 1.0, minWage: 1.0 },
  JP: { poolThickness: 0.75, marketSize: 0.55, minWage: 0.7 },
  DE: { poolThickness: 0.55, marketSize: 0.45, minWage: 0.88 },
  GB: { poolThickness: 0.5, marketSize: 0.4, minWage: 0.85 },
  SG: { poolThickness: 0.2, marketSize: 0.1, minWage: 0.92 },
};

/** §4.7 Era×国 GDPシェア代表値（高PA帯の国籍抽選重み）。 */
export const GDP_BY_ERA: Record<Era, Record<PlayableCountry, number>> = {
  dawn: { US: 1.0, JP: 0.7, DE: 0.5, GB: 0.5, SG: 0.2 },
  internet: { US: 1.0, JP: 1.0, DE: 0.5, GB: 0.5, SG: 0.35 },
  smartphone: { US: 1.0, JP: 0.5, DE: 0.5, GB: 0.5, SG: 0.5 },
  ai: { US: 1.0, JP: 0.5, DE: 0.5, GB: 0.5, SG: 0.6 },
};

/** §4.7 GDP偏り強度 α。高PA帯(150+)の国籍抽選重み = GDPシェア^α。 */
export const GDP_ALPHA = 1.2;

/* ============================================================
 * 3. 人材プール生成（数値定義書 §4.10 / 仕様 §4.10.2, §4.10.4）
 * ============================================================ */

/** 仕様 §4.10.2 PA希少性分布。 */
export const PA_TIERS: PaTier[] = [
  { min: 80, max: 120, ratio: 0.7, label: "一般" },
  { min: 120, max: 150, ratio: 0.22, label: "優秀" },
  { min: 150, max: 170, ratio: 0.06, label: "一流" },
  { min: 170, max: 185, ratio: 0.018, label: "超一流" },
  { min: 185, max: 200, ratio: 0.002, label: "世代の逸材" },
];

/** 仕様 §4.10.4 会社評判→到達可能上限PA帯（評判ゲート）。
 *  v0.8：序盤を締め、成長で開く（労働集約設計提案§9）。無名は一般層(80-120)中心＝
 *  「一般人材で下積み」体験が成立。評判を積むほど良い人材が解禁＝知識集約への転換がご褒美。 */
export const REPUTATION_GATES: ReputationGate[] = [
  { reputationMin: 0, reputationMax: 10, reachablePaMax: 105 }, // 無名：ほぼ一般(80-120)のみ
  { reputationMin: 10, reputationMax: 25, reachablePaMax: 120 }, // 駆け出し：一般上位まで
  { reputationMin: 25, reputationMax: 45, reachablePaMax: 140 }, // 実績→「優秀」に手が届き始める
  { reputationMin: 45, reputationMax: 70, reachablePaMax: 165 }, // 「一流」参入
  { reputationMin: 70, reputationMax: 90, reachablePaMax: 185 }, // 「超一流」
  { reputationMin: 90, reputationMax: 100, reachablePaMax: 200 }, // 「世代の逸材」
];

/* ============================================================
 * 4. 収支・寿命（仕様 §3.1 / §4.4 / §12.4）
 * ============================================================ */

/** 仕様 §12.4 売上単価（TRAC1ptあたりの月次売上）。 */
export const SALES_UNIT_PRICE = 200;

/** 会社の固定費（月額）。v0.7.2：序盤バーンを抑えるため1000→600。 */
export const FIXED_COST = 600;

/** 仕様 §4.4 寿命式 lifeExpectancy = BASE_LIFE + (health-10)*LIFE_K。 */
export const BASE_LIFE = 72;
export const LIFE_K = 1.3;

/** 個人の基礎生活費（§12.5）。プロトタイプでは PC の収支では未使用。 */
export const BASE_LIVING = 2000;

/* ============================================================
 * 5. その他の確定値（数値定義書 §4）
 * ============================================================ */

/** §4.1 受胎ベース確率。 */
export const CONCEPTION_BASE = 0.2;
/** §4.2 PA遺伝の突然変異δの標準偏差。 */
export const PA_MUTATION_SIGMA = 10;
/** §4.3 不祥事の基礎ショック量（評判pt）。 */
export const BASE_SHOCK = 25;
/** §4.3 在籍者1人1ターンの不祥事基礎発生確率。 */
export const SCANDAL_BASE = 0.003;
/** §4.4 評判の減衰率/ターン。 */
export const REP_DECAY = 0.04;
/** §4.4 THxP寄与係数 β1。 */
export const BETA1 = 0.3;
/** §4.4 金銭露出係数 β2。 */
export const BETA2 = 0.12;
/** §4.8 引き抜き成立係数。 */
export const POACH_BASE = 0.5;
/** §4.8 引き抜き抽選の発火閾値（vuln がこれ未満は狙われない）。 */
export const POACH_VULN_MIN = 0.15;

/* ============================================================
 * 6. 給与テーブル（仕様 §12.2 / §4.3）
 * ============================================================ */

/** CA帯別の基準月額給与（仕様 §12.2）。歩合は簡略化のため基本給に含めない。 */
export interface SalaryTier {
  rookie: number; // 駆け出し CA〜100
  mid: number; // 中堅 CA100〜150
  ace: number; // エース CA150〜
}

export const BASE_SALARY_BY_JOB: Record<JobCategory, SalaryTier> = {
  engineer: { rookie: 3000, mid: 6000, ace: 12000 },
  designer: { rookie: 2500, mid: 5000, ace: 10000 },
  marketer: { rookie: 2500, mid: 5500, ace: 11000 },
  sales: { rookie: 2000, mid: 4500, ace: 9000 },
  finance: { rookie: 4000, mid: 8000, ace: 15000 },
  researcher: { rookie: 3000, mid: 6000, ace: 12000 }, // §12.2に個別記載なし→エンジニア準拠
  manager: { rookie: 3500, mid: 7000, ace: 14000 },
};

/** §4.3 忠誠オフセットの係数（(loyalty-10)/10 × この値）。 */
export const LOYALTY_OFFSET_K = 0.15;

/* ============================================================
 * 7. スカウト（仕様 §4.8 / 数値定義書 §3）
 * ============================================================ */

/** スカウト段階遷移のコストと基礎誤差（数値定義書 §3.1）。 */
export interface ScoutStep {
  ap: number; // 消費AP
  cash: number; // 消費CASH
  baseErrorPA: number; // PA基礎誤差
  baseErrorPersona: number; // 人格基礎誤差（1-20スケール）
}

/** index 0 = 0→1（簡易）, index 1 = 1→2（精密）。 */
export const SCOUT_STEPS: ScoutStep[] = [
  { ap: 1, cash: 2000, baseErrorPA: 30, baseErrorPersona: 5 },
  { ap: 2, cash: 8000, baseErrorPA: 10, baseErrorPersona: 2 },
];

/* ============================================================
 * 8. アクションAPコスト・マーケ投資（仕様 §2.3 / §12.4）
 * ============================================================ */

/** 各アクションの消費AP（プロトタイプ簡易値）。 */
export const AP_COST = {
  hire: 1, // 採用オファー
  assign: 1, // 役割配属
  unlockBlueprint: 1, // 青写真解放（蓄積RPを投下する決断）
  // scout は SCOUT_STEPS 側で段階別に定義
  // マーケ/研究予算の増減は設定操作のためAP消費なし（毎ターンのバーンで効く）
};

/* ============================================================
 * 9. 役割貢献（QUAL方向のみ。市場系は§11の市場モデルへ吸収）
 * ============================================================ */

/** 職種→会社リソースへの貢献先。dev系のみQUAL。marketer/salesは市場モデルの「force」で作用。 */
export const ROLE_OUTPUT: Record<
  JobCategory,
  { target: "QUAL" | "NONE"; attr: keyof import("./types").OccupationalAttributes }
> = {
  engineer: { target: "QUAL", attr: "engineering" },
  designer: { target: "QUAL", attr: "design" },
  researcher: { target: "NONE", attr: "research" }, // リサーチ役はRP_Cを産む（§12.3）
  marketer: { target: "NONE", attr: "marketing" }, // 市場モデルの marketerForce（§4.2）
  sales: { target: "NONE", attr: "sales" }, // 市場モデルの salesForce（§4.4）
  finance: { target: "NONE", attr: "finance" },
  manager: { target: "NONE", attr: "management" },
};

/** QUAL貢献の係数（主参照能力/20 × これ、毎ターン）。 */
export const QUAL_GAIN_K = 0.5;
/** QUALの自然減衰（毎ターン、製品の陳腐化の簡易表現）。 */
export const QUAL_DECAY = 0.3;

/* ============================================================
 * 11. 市場・成長モデル（市場成長モデル設計書v0.1）  ★v0.5
 *   ※旧 TRAC_DECAY / MARKETING_* / TRAC_GAIN_K は§8差分表どおり廃止。
 * ============================================================ */

/** §2.2 有限市場の基準ユニット数（US・インターネット期＝1.0基準）。
 *  v0.7.2：小市場でも給与を賄える売上規模にするため 300→480（全市場スケール）。★要PT。 */
export const M_BASE = 560;
/** §2.2 時代ごとの市場倍率（パイの大きさ）。 */
export const ERA_MARKET_MULT: Record<Era, number> = {
  dawn: 0.6, internet: 1.0, smartphone: 1.6, ai: 2.2,
};
/** §2.2 セールス直販由来シェアの単価プレミアム（高単価顧客）。 */
export const ARPU_SALES_PREMIUM = 0.5;

/** §3.4 競争力（C_p）関連。 */
export const Q_BASE = 0.4; // QUAL0での競争力の芯
export const Q_SLOPE = 0.6; // QUAL100で QUALcore=1.0
export const KCOMP_SALES = 0.15; // セールス実効頭数1あたり競争力+15%
export const KCOMP_TH = 0.6; // 顧客THxPが TH_REF で最大+60%
export const TH_REF = 300; // THxP基準（数値定義§4.4の評判均衡と同一）
export const KCOMP_REP = 0.2; // 評判100で競争力+20%

/** §3.4 ライバル競争力（ΣC_r）関連。 */
export const SCALE_STRENGTH = [0.2, 0.4, 0.7, 1.1, 1.6]; // 規模ティア別の基礎力
export const SECTOR_MATCH = { same: 1.0, adjacent: 0.5, unrelated: 0.1 };
export const C_OPEN = 0.5; // v0.7.2：開放残余（0.6→0.5）
export const REACH_AMP = 1.6; // 広告が稼ぎ天井の何倍まで一時到達できるか
/** §3.4 国別の背景競争圧（far層の統計集約）。v0.7.2：普通の人材でも空き市場で戦えるよう半減。 */
export const FAR_PRESSURE: Record<PlayableCountry, number> = {
  US: 0.45, JP: 0.3, DE: 0.25, GB: 0.25, SG: 0.15,
};

/** §4.6 4チャネルの係数。 */
export const KAD = 3.0; // 広告
export const KPR = 3.0; // PR/口コミ（v0.7.2：序盤の種火をさらに強化 2.2→3.0）
export const KREP_ORG = 0.3; // 評判で口コミ伝播+30%
export const KSALES = 4.5; // セールス直販（v0.7.2：普通の人材でもturn1から効く主力レバーに 1.2→4.5）
export const KCOMM_TH = 4.0; // コミュニティ→顧客THxP
export const KCOMM_S = 0.2; // コミュニティ→直接シェア（小）

/** §5.3 品質-広告整合・逆噴射（v0.7.2：崖を撤去。低QUALは「効かない」だけで即マイナスにしない）。 */
export const QUAL_AD_BACKFIRE = 28; // これ未満のみ逆噴射（40→28に緩和）
export const QUAL_AD_FIT_FULL = 85; // 適合度1.0到達点（以降1.2まで微増）
export const BACKFIRE_K = 0.8; // 逆噴射のsticky毀損係数（2.0→0.8に縮小）
export const BACKFIRE_TH = 2.5; // 逆噴射の顧客THxP毀損係数（6.0→2.5に縮小）

/** §6.4 減衰・軍拡競争。 */
export const DECAY_PAID = 0.35; // 広告シェアは月35%蒸発（賃借）
export const DECAY_STICKY = 0.02; // stickyは月2%（v0.7.2：序盤の積み上げが崩れにくく 0.03→0.02）
export const ERODE_STICKY = 0.15; // 天井超過分の15%/ターンをライバルが奪還
export const RIVAL_GROWTH = 0.02; // nearライバルの規模昇格速度

/** マーケ予算（広告/PR/コミュニティ）を増減させる1口（$1,000/ターン）。 */
export const MARKET_BUDGET_STEP = 1000;

/* ============================================================
 * 12. 多市場・製品品質・市場分析（市場分析製品品質モデル設計書v0.1）  ★v0.6
 * ============================================================ */

/** セクターID（§1.1・6種）。 */
export type Sector = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
export const SECTORS: Sector[] = ["S1", "S2", "S3", "S4", "S5", "S6"];
export const SECTOR_NAME: Record<Sector, string> = {
  S1: "Webサービス", S2: "モバイルアプリ", S3: "フィンテック",
  S4: "生成AI", S5: "EC／マーケット", S6: "福祉・対人",
};

/** §1.2 セクター×Eraの相対規模（0=そのEraに不在＝未解禁）。 */
export const SECTOR_ERA_WEIGHT: Record<Sector, Record<Era, number>> = {
  S1: { dawn: 0, internet: 1.0, smartphone: 0.9, ai: 0.7 },
  S2: { dawn: 0, internet: 0.2, smartphone: 1.2, ai: 1.0 },
  S3: { dawn: 0, internet: 0.4, smartphone: 0.9, ai: 1.1 },
  S4: { dawn: 0, internet: 0, smartphone: 0.2, ai: 1.6 },
  S5: { dawn: 0.3, internet: 0.9, smartphone: 1.1, ai: 1.0 },
  S6: { dawn: 0.6, internet: 0.8, smartphone: 0.9, ai: 1.0 },
};

/** §1.4 セクター隣接（sectorMatch：同=1.0 / 隣接=0.5 / 無関係=0.1）。 */
export const SECTOR_ADJACENCY: Record<Sector, Record<Sector, number>> = {
  S1: { S1: 1.0, S2: 0.5, S3: 0.5, S4: 0.5, S5: 0.5, S6: 0.1 },
  S2: { S1: 0.5, S2: 1.0, S3: 0.1, S4: 0.5, S5: 0.5, S6: 0.1 },
  S3: { S1: 0.5, S2: 0.1, S3: 1.0, S4: 0.5, S5: 0.1, S6: 0.1 },
  S4: { S1: 0.5, S2: 0.5, S3: 0.5, S4: 1.0, S5: 0.1, S6: 0.1 },
  S5: { S1: 0.5, S2: 0.5, S3: 0.1, S4: 0.1, S5: 1.0, S6: 0.1 },
  S6: { S1: 0.1, S2: 0.1, S3: 0.1, S4: 0.1, S5: 0.1, S6: 1.0 },
};

/** §1.5 市場構造の定数。 */
export const BIAS_AMP = 0.35; // 国×セクター規模の振れ幅（±35%）
export const BIAS_MIN = 0.7;
export const BIAS_MAX = 1.4;
export const APPEAL_NOISE = 0.45; // セクター配分シェアの振れ（密度のばらつき源）
export const DENS_MIN = 0.3;
export const DENS_MAX = 2.5;
export const NEAR_BASE = 5; // v0.7.2：空き市場のライバル数をさらに抑える（6→5）
export const NEAR_MIN = 3;
export const NEAR_MAX = 40;
/** 数値定義§4.9 国別ライバル総数（セクターへ配分）。 */
export const TOTAL_RIVALS: Record<PlayableCountry, number> = {
  US: 900, JP: 500, DE: 400, GB: 380, SG: 300,
};

/** §2.5 製品品質の定数。 */
export const TEAM_WEIGHTS = { ace: 0.6, second: 0.25, rest: 0.15 }; // A()のチーム合成重み
export const QUAL_POLISH_MIN = 0.85;
export const QUAL_POLISH_MAX = 1.15;
export const DEV_RAMP = 6; // devMaturity 1.0 到達に必要な開発ターン
export const ERA_OBSOLETE = 0.85; // Era1つ古いとQUAL上限×0.85

/** §3.8 市場分析の定数。 */
export interface AnalysisStep {
  ap: number; cash: number; turns: number; baseError: number; // baseErrorは比率(±)
}
export const ANALYSIS_STEPS: AnalysisStep[] = [
  { ap: 1, cash: 1500, turns: 1, baseError: 0.35 }, // 0→1 市場スキャン
  { ap: 2, cash: 6000, turns: 2, baseError: 0.12 }, // 1→2 精密市場分析
];
export const K_OPP = 100; // 機会スコアの表示正規化係数
export const STALE_TURNS = 8; // 分析情報の陳腐化までのターン

/** 品質規定式の1項（役割の能力に重み）。 */
export interface QualFormulaTerm {
  role: JobCategory; // 参照する役割
  ability: keyof import("./types").OccupationalAttributes; // その役割の主参照能力
  weight: number; // 重み（式内合計=1.0）
}

/* ============================================================
 * 13. 市場成熟・成長・参入ダイナミクス（市場成熟成長参入モデル設計書v0.1）  ★v0.7
 * ============================================================ */

/** §2.4 成熟と収益実現。 */
export const REV_FLOOR = 0.35; // 未成熟市場の収益実現率（v0.7.2：0.15→0.35。空き市場でも普通の人材が食える）
export const REV_CURVE = 0.9; // realize曲線の凸度（<1でわずかに凸）
export const DENS_MAT_MIN = 0.35; // 成熟度0の期待密度
export const DENS_MAT_MAX = 1.9; // 成熟度1の期待密度
export const MAT_BASE = 0.55; // 初期成熟度の基準
export const MAT_NOISE = 0.5; // 初期成熟度のseed振れ
export const MAT_INIT_MIN = 0.05;
export const MAT_INIT_MAX = 0.95;

/** §3.4 ヒット駆動の市場成長。 */
export const MAT_GROWTH_K = 0.08; // 成熟度成長係数
export const MAT_REGRESS = 0.01; // 放置市場の月次冷却
export const QUAL_HIT_MIN = 42; // これ未満のQUAL_pは市場を育てない（v0.7.2：50→42。創業製品でも育成に届く）
export const QUAL_HIT_FULL = 85; // qualGate=1.0 到達点
export const RIVAL_HIT_W = 0.6; // ライバルの成功が市場成熟に効く重み
export const TAM_EXPAND = 0; // 潜在パイ天井の拡張（初期0＝realizeのみ）

/** §4.3 参入ダイナミクス。 */
export const ENTRY_RATE = 0.08; // v0.7.2：序盤の参入を緩やかに（先行者の猶予窓を延長 0.15→0.08）
export const ATTR_GROWTH = 0.8; // 成長中の市場への参入加速
export const ATTR_PROFIT = 0.5; // 実効パイの大きい市場への引力
export const ATTR_SUCCESS = 0.35; // v0.7.2：自社の成功が呼ぶ参入を緩和（0.6→0.35）
export const DMAT_REF = 0.02; // Δmaturityの規格化基準
export const M_REF = 120; // 実効パイの規格化基準
export const EXIT_RATE = 0.05; // 過密/冷却時の撤退速度
export const HOT_STALE_K = 0.6; // ホット市場の分析陳腐化短縮の強さ
export const STALE_MIN = 3; // 最ホット市場の分析寿命の下限（ターン）

/** §5.5 青写真tier（特化 vs 汎用）。 */
// v0.7.2：tier1天井を55→62へ。口コミ立ち上げ帯(40+)に届き、汎用でも軌道に乗れるように。
// 深いtierとの差（強い製品ほど大パイを取り切る）は維持。
export const QUAL_TIER_CAP = [62, 75, 88, 100]; // tier1..4 別の QUAL_p 天井
export const SPEC_CP_K = 0.06; // tier深度1あたりC_p +6%
export const DEV_SPEC_K = 0.12; // tier深度1あたり展開ラグ −12%
export const RP_T1 = 120; // tier1（参入切符）の基礎RP
export const TIER_GROWTH = 1.8; // tier毎のRP逓増
/** tier別RPコスト = RP_T1 × TIER_GROWTH^(t-1)。設計書§5.4 で [120,216,389,700]。 */
export const RP_TIER = [0, RP_T1, Math.round(RP_T1 * TIER_GROWTH), Math.round(RP_T1 * TIER_GROWTH ** 2), Math.round(RP_T1 * TIER_GROWTH ** 3)];

/** §8 プロトタイプの初期成熟度オーバーライド（体感用）。
 *  S1高成熟(混雑)・S6低成熟(空き)。S5(創業EC市場)は低成熟の green field(0.22)＝
 *  ライバル薄く高シェアを取りやすい「最初の足場」にする（v0.7.2 死の谷対策）。 */
export const MATURITY_INIT_OVERRIDE: Partial<Record<Sector, number>> = {
  S1: 0.6, S5: 0.08, S6: 0.15,
};

/* ============================================================
 * 10. 研究・青写真・Era（仕様 §12.3 / §5.3 / §7.1）  ★v0.3
 * ============================================================ */

/** §12.3 社RP産出：Σ(リサーチ役 research) × RP_RESEARCH_K × 研究投資係数。 */
export const RP_RESEARCH_K = 0.3;
/** 研究投資係数：研究投資$1,000ごとに +0.1（上限2.0・下限0）。 */
export const RESEARCH_COEFF_PER_1000 = 0.1;
export const RESEARCH_COEFF_MAX = 2.0;
/** 研究予算を増減させる1口（$1,000/ターン）。 */
export const RESEARCH_BUDGET_STEP = 1000;

/** QUALの基準上限（青写真なしのときの天井）。青写真解放でこれを押し上げる。 */
export const QUAL_BASELINE_CEILING = 60;

/** Eraの並び（黎明期→インターネット期→スマホ普及期→AI革新期・§7.1）。 */
export const ERA_ORDER = ["dawn", "internet", "smartphone", "ai"] as const;
/** Eraステップ遷移の間隔（ターン）。プロトタイプ簡略：一定ターンごとに次Eraへ。
 *  調整用定数：小さいほど時代が速く進み、青写真が早く陳腐化する（§7.1）。 */
export const ERA_INTERVAL = 18;

/**
 * 陳腐化係数（§7.1）：現Eraが青写真の世代より進むほどQUAL寄与が下がる。
 * gen差 0=1.0（現役）/ 1=0.6 / 2以上=0.3。
 */
export const OBSOLESCENCE_FACTORS = [1.0, 0.6, 0.3];

/**
 * ミッションタグの衝突表（§5.3）。
 * 青写真のタグ（key）が、会社ミッションに value のいずれかを含むと衝突＝グレーアウト。
 */
export const MISSION_CONFLICTS: Record<string, string[]> = {
  高自動化: ["雇用創出"], // 生成AI(BP-450)の高自動化 vs 雇用創出ミッション（§5.3）
};

/** 会社ミッションの初期タグ（プロトタイプ既定）。 */
export const DEFAULT_MISSION_TAGS = ["雇用創出"];

/* ============================================================
 * 14. 業態アーキタイプ・労働集約型（労働集約型業態 設計提案v0.1）  ★v0.8
 * ============================================================ */

/** 業態アーキタイプ。knowledge=知識集約(現行)／labor=労働集約(新規)。 */
export type Archetype = "knowledge" | "labor";

/**
 * 労働集約型の産出係数（設計提案§3・§7・すべて★要プレイテスト）。
 *  品質はエース加重でなく「頭数×基礎資質の線形和（スループット）」で決まる。
 *  一般人材(7割の在庫)が“頭数”として戦力になる業態。
 */
// §3.3 品質は低い床に固定（v0.7.2で直した「効くレバー帯」＝口コミ40超・広告逆噴射28超に収める）
export const LABOR_QUAL_BASE = 46; // 労働集約の基礎QUAL（口コミ発動40の上）
export const LABOR_TIER_CAP = 56; // 労働集約のQUAL天井（＝低天井。知識集約の独占には届かない）
export const KLABOR_CONS = 8; // 現場の一貫性(avgConsistency/20)でQUAL微増（最大+8）
export const KLABOR_MGMT_Q = 6; // 現場管理(bestManagement/20)でQUAL微増（最大+6）

// §3.4 競争力はスループット主導（qualCoreの代替）
export const QLABOR_CORE = 1.05; // 労働集約C_pの芯（頭数6名で序盤黒字化＝初心者向け。損益分岐T4〜13）
export const KLABOR_TH = 0.5; // 頭数(laborCapacity)1あたり競争力+50%＝頭数=主レバー
// §3.2 現場管理の乗算（頭数の代替にはしない、まとめ役の底上げ）
export const KLABOR_MGMT = 0.35; // bestManagement/20 で laborCapacity を最大+35%
