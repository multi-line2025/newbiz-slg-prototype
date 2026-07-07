/**
 * ======================================================================
 *  state.ts  プロトタイプのゲーム状態（GameState の最小サブセット）
 * ----------------------------------------------------------------------
 *  正典 types.ts の GameState は全エンティティを含む大きな型だが、
 *  最小プロトタイプでは「動いて検証できる」範囲に絞ったサブセットを用いる。
 *  Person 型は types.ts の正典をそのまま使用する。
 * ======================================================================
 */

import type { Person, Id, Era, PlayableCountry } from "./model/types";
import type { Sector } from "./model/constants";

/**
 * プロトタイプ用の会社リソース。
 * v0.6で単一QUAL/TRAC/マーケ予算を廃止し、製品(Product)へ移譲。
 * 会社レベルに残すのは横断的資産（THxP・評判・研究）のみ。
 */
export interface ProtoCompany {
  name: string;
  foundedCountry: PlayableCountry; // 設立国（市場規模・人件費の基準）
  CASH: number; // 会社キャッシュ
  reputation: number; // 会社評判 0-100（人材到達ティア・競争力に軽く寄与）
  monthlyBurn: number; // 月次バーンレート（派生値）
  runwayTurns: number; // ランウェイ = CASH / burn（派生値）
  // --- 研究・青写真（v0.3）---
  RP_C: number; // 社研究ポイント（青写真解放の通貨・§12.3）
  researchBudget: number; // 毎ターンの研究投資額（バーンに加算・研究投資係数を決める）
  unlockedBlueprints: Id[]; // 解放済み青写真ID
  missionTags: string[]; // 会社ミッションのタグ（青写真のミッション整合判定・§5.3）
  // --- 横断的な市場資産（会社共有・§2.4）---
  THxP_customer: number; // 顧客THxP（全製品の競争力C_pに横断的に効く）
}

/** 近接（near層）ライバル（§4.12接続の簡易版・市場成長モデル§3.2/§6.2）。 */
export interface NearRival {
  id: Id;
  name: string;
  sector: "same" | "adjacent" | "unrelated"; // 市場セクターとの近さ（sectorMatch）
  scaleTier: number; // 規模ティア 0-4（SCALE_STRENGTH参照。内生成長で上がる）
  reputationTier: number; // 評判ティア 0-4
  aggression: number; // 攻撃性 0-1
  ambitionFocus: "expand" | "tech" | "share"; // shareは市場で特に攻撃的
  share: number; // 現在シェア 0-1（毎ターン再評価）
  growthProgress: number; // scaleTier昇格の進捗アキュムレータ（RIVAL_GROWTH）
}

/** 分析で開示された（誤差込みの）市場値。 */
export interface AnalyzedValues {
  M: number; // 開示された市場規模（誤差込み中央値）
  densityIndex: number; // 開示された競合密度
  errorPct: number; // その分析の実誤差（±比率。レンジ表示に使う）
}

/** 進行中の市場分析。 */
export interface AnalysisInProgress {
  targetLevel: 1 | 2; // 目指す分析レベル
  turnsLeft: number; // 完了までの残りターン
  analystSkill: number; // 着手時の分析スキル（research合成）＝精度確定用
}

/** 市場状態（セクター×国の1マス・§6＋動的市場§2/§4）。 */
export interface MarketState {
  id: string; // `${sector}:${country}`
  sector: Sector;
  country: PlayableCountry;
  biasFactor: number; // seed由来の国×セクター規模偏り（潜在パイ M_pot に乗算・§1.2）
  nearRivals: NearRival[]; // この市場の近接ライバル（sectorMatch=1.0）
  analysisLevel: 0 | 1 | 2; // 分析レベル（0=霧）
  analyzed: AnalyzedValues | null; // 開示済みの値（level>=1）
  lastAnalyzedTurn: number | null; // 最終分析ターン（陳腐化判定）
  analysisInProgress: AnalysisInProgress | null; // 進行中の分析
  // --- 動的市場（v0.7・市場成熟成長参入モデル）---
  maturity: number; // 市場成熟度 0-1（0=未成熟・空き・小 / 1=成熟・混雑・大）
  entryAccrual: number; // 参入アキュムレータ（1超で近接ライバル+1・§4.1）
  nearCountTarget: number; // 成熟度が示す近接ライバル目標数（現数がここへ向かう・§4.1）
  lastDeltaMaturity: number; // 直近の成熟度変化（成長ポテンシャル/ホットさ表示用）
}

/** 製品（青写真インスタンス・§6）。1製品＝1青写真×1市場（セクター×国）。 */
export interface Product {
  id: Id;
  blueprintId: Id;
  sector: Sector;
  country: PlayableCountry; // 投入先の国
  marketId: string; // 投入先の市場（sector:country）
  devTurns: number; // 開発ターン蓄積（devMaturity）
  QUAL_p: number; // 製品QUAL 0-100（毎ターン再計算）
  // --- 市場シェア成分（市場成長モデル・製品×市場ごと）---
  sticky: number;
  paid: number;
  stickySales: number;
  // --- マーケ4チャネル予算（製品ごと）---
  adBudget: number;
  prBudget: number;
  commBudget: number;
}

/** プロトタイプの全体状態。 */
export interface ProtoGameState {
  turn: number; // 現在ターン（1ターン=1ヶ月）
  era: Era; // 現在Era（turnとstartEraから毎ターン更新・§7.1）
  startEra: Era; // 開始Era（Era進行の基準）
  company: ProtoCompany;
  ap: number; // 行動ポイント（毎ターン回復）
  apMax: number;
  people: Record<Id, Person>; // 人材DB（社員＋候補プール）
  employeeIds: Id[]; // 在籍社員
  poolIds: Id[]; // 採用候補プール
  markets: Record<string, MarketState>; // 多市場グリッド（セクター×国・§1）
  products: Product[]; // 自社製品（青写真×市場）
  assignments: Record<Id, Id>; // 社員ID → 配属先製品ID（QUAL_p・force算出に使用）
  rngSeed: number; // 乱数シード（再現性・セーブに含める。advanceTurn以外はrng不使用）
  marketSeed: number; // 市場グリッド生成のseed（densityIndex等の決定論）
  log: string[]; // ターンごとの出来事ログ（UI表示用）
  // --- v0.4：終了条件・実績 ---
  gameOver: boolean; // 資金ショート（CASH<0）でtrue。以降ターンを進めない
  endTurn: number | null; // ゲームオーバー到達ターン
  profitStreak: number; // 連続黒字ターン数（黒字化実績の判定用）
  achievements: Id[]; // 達成済み実績ID
}

/** ある製品に配属された社員を返す。 */
export function productTeam(s: ProtoGameState, productId: Id): Person[] {
  return s.employeeIds
    .filter((id) => s.assignments[id] === productId)
    .map((id) => s.people[id])
    .filter(Boolean);
}

/** 在籍社員の Person 配列を取り出す。 */
export function employees(s: ProtoGameState): Person[] {
  return s.employeeIds.map((id) => s.people[id]).filter(Boolean);
}

/** 候補プールの Person 配列を取り出す。 */
export function poolPeople(s: ProtoGameState): Person[] {
  return s.poolIds.map((id) => s.people[id]).filter(Boolean);
}
