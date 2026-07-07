/**
 * ======================================================================
 *  新規事業立ち上げSLG  コアデータスキーマ定義  types.ts
 * ----------------------------------------------------------------------
 *  準拠: ゲーム基礎設計仕様書 v1.3（確定版）第13章「データ構造まとめ」
 *  目的: 仕様書 §13 の全エンティティを TypeScript の型として厳密に定義する。
 *  方針:
 *    - 数値は原則「初期採用値（バランス調整前提）」。単位はコメントで明記。
 *    - 「隠しパラメータ」など UI で伏せる値も、内部状態としては保持する。
 *    - 初学者でも構造を追えるよう、各フィールドに日本語コメントを付す。
 *  凡例:
 *    Int   … 整数 / Float … 小数 / 通貨単位は抽象単位「$」（国別係数で補正）
 *    [0-N] … 取りうる範囲 / [1-20] … FM式の個別能力値レンジ
 * ======================================================================
 */

/* ==============================================================
 * 0. 基本ユーティリティ型・列挙
 * ============================================================== */

/** ゲーム内ID（人材・会社・青写真などに付与する一意な文字列）。 */
export type Id = string;

/** 通貨額（抽象単位「$」。国別係数は別途 TaxProfile / 国データで補正）。 */
export type Money = number;

/** 0〜100 に収まる比率的な値（TRAC / QUAL / reputation など）。 */
export type Pct100 = number;

/** 性別。出産は female のみ（§9.3.1）。 */
export type Sex = "male" | "female";

/** 職業カテゴリ（§4.2 初期セット）。CA/PA は職業非依存だが役割参照に使う。 */
export type JobCategory =
  | "engineer"    // エンジニア
  | "designer"    // デザイナー
  | "marketer"    // マーケター
  | "sales"       // セールス
  | "finance"     // 財務・CFO
  | "researcher"  // リサーチャー
  | "manager";    // マネージャー（部門長）

/** 役割（配属先）。同じ人でも配属で参照能力値が変わる（§4.6.1 GK vs フィールド）。 */
export type Role = JobCategory;

/** プレイ可能国（§12.7 で確定した5か国）。人材プール・市場は国データで別途保持。 */
export type PlayableCountry = "JP" | "US" | "SG" | "DE" | "GB";

/** 国籍・居住は世界中の国を取りうるため広く string（ISO風コード）で持つ。 */
export type CountryCode = string;

/** 地域クラスタ（言語圏・経済圏・制度圏の近さ。採用距離の基準・§4.3）。 */
export type ClusterId = string;

/** 抽象Era（§7.1）。時代でGDPシェア・青写真解放が変わる。 */
export type Era = "dawn" | "internet" | "smartphone" | "ai";

/** PC との関係（§4.1 relationToPC）。 */
export type RelationToPC = "none" | "candidate" | "lover" | "spouse" | "child" | "relative";

/** 契約種別（§4.1 contract）。 */
export type ContractType = "fulltime" | "contract" | "advisor"; // 正社員 / 契約 / 顧問

/** スカウト開示度（§4.8）。0=未調査, 1=レンジ表示, 2=正確値。 */
export type ScoutLevel = 0 | 1 | 2;


/* ==============================================================
 * 1. Person（人材DB）  §4.1 / §4.5-4.9 / §9.3
 * --------------------------------------------------------------
 *  FM式 CA/PA + 個別能力値(1-20)。ゲーム内の全人物（社員・候補・
 *  一族・ライバル keyStaff）はこの型で表す。PC も PlayerCharacter が
 *  この型を内包する（§13-6）。
 * ============================================================== */

/** ① 専門技能（各1-20）。CAには全項目が等しく計上、役割ごとに参照が異なる（§4.6）。 */
export interface OccupationalAttributes {
  engineering: number; // エンジニアリング
  design: number;      // デザイン
  marketing: number;   // マーケティング
  sales: number;       // セールス
  finance: number;     // 財務
  research: number;    // リサーチ
  management: number;  // マネジメント
}

/** ② メンタル（各1-20。汎用で最重要。ゆっくり成長し定年間近ピーク・§4.7.1）。 */
export interface MentalAttributes {
  composure: number;     // 冷静さ：危機・交渉での失点防止
  decisions: number;     // 判断力：委任時の実行成功率に寄与（§6.2）
  determination: number; // 決断力：成長速度・逆境での粘り（育成係数）
  concentration: number; // 集中力：実務の安定・ケアレスミス減
  anticipation: number;  // 先読み：市場/法律イベントへの先手
  creativity: number;    // 創造性：青写真研究・QUAL上振れ
  vision: number;        // ビジョン：戦略・ピボット判断
  leadership: number;    // 統率力：直接統率上限・士気（§6.1）
  teamwork: number;      // 協調性：生産性・離職抑制
  ambition: number;      // 野心：成長意欲／高すぎると造反リスク
  bravery: number;       // 度胸：大勝負・大型調達での物怖じ回避
}

/** ③ コンディション（各1-20。40歳ピークで以降低下＝最も落ちる・§4.7.1）。 */
export interface ConditionAttributes {
  stamina: number;      // 体力：消化できる業務量
  stressResist: number; // ストレス耐性：高負荷ターンでのパフォーマンス維持
  health: number;       // 健康：病気・寿命イベント確率。寿命を決める（§4.4）
}

/** ④ 人格・隠し（各1-20。CAに計上しない“無料の修正子”。ほぼ固定・§4.8で段階開示）。 */
export interface HiddenAttributes {
  integrity: number;       // 誠実さ：不正・裏切りの起こしにくさ
  professionalism: number; // プロ意識：育成係数の中核（速くPAに近づく）
  adaptability: number;    // 順応性：海外・異文化・ピボット適応
  consistency: number;     // 一貫性：パフォーマンスのブレの小ささ
  loyalty: number;         // 忠誠：引き抜き耐性・要求給与・味方/敵対の傾き
  temperament: number;     // 気性：対人トラブルの起こしにくさ
  controversy: number;     // 問題行動性：炎上・スキャンダルリスク
  durability: number;      // 頑健さ：病欠・故障のしにくさ（低いと稼働率↓）
}

/** 4カテゴリを束ねた個別能力値（§4.6）。 */
export interface Attributes {
  occupational: OccupationalAttributes; // ① 専門技能
  mental: MentalAttributes;             // ② メンタル
  condition: ConditionAttributes;       // ③ コンディション
  hidden: HiddenAttributes;             // ④ 人格・隠し（スカウトで段階開示）
}

/** 雇用契約（§4.1）。 */
export interface Contract {
  type: ContractType;    // 正社員 / 契約 / 顧問
  remainingTurns: number; // 残存ターン数（契約満了で更新交渉）
  equity: number;        // 付与株式比率 0.0-1.0（造反リスク・株主化に影響）
  salary: Money;         // 実効月額給与（§4.3 の実効要求給与で妥結した額）
}

/**
 * 人材（Person）。§4.1 のスキーマを厳密に型化。
 * - 可視能力値（①②③）から CA を算出（§4.5）、PA は生成時決定・原則不変。
 * - health が lifeExpectancy を決める（§4.4）。
 * - sex / fertility / bloodlineId は出産・血統・血族婚に使う（§9.3）。
 */
export interface Person {
  id: Id;
  name: string;
  sex: Sex;                       // 出産は female のみ（§9.3.1）
  bloodlineId: Id | null;         // 血統ID。同一なら血族婚不可（§9.3.3）。外部人材は null

  // --- 年齢・寿命 ---
  age: number;                    // 実年齢（Float。毎ターン +1/12）
  retirementAge: number;          // 定年（Int）。到達で自動離脱
  lifeExpectancy: number;         // 寿命。毎ターン再評価: 72+(health-10)*1.3（§4.4）
  fertility: number;              // 妊孕性 0.0-1.0（年齢で変動・§9.3.1）

  // --- 所在・職種 ---
  nationality: CountryCode;       // 国籍（採用クラスタ距離に影響・§4.3）
  residence: CountryCode;         // 居住地
  cluster: ClusterId;             // 所属クラスタ（採用距離計算の基準）
  jobCategory: JobCategory;       // 職業カテゴリ
  assignedRole: Role | null;      // 現在の配属役割（未配属は null）

  // --- 能力値（FM式） ---
  CA: number;                     // 現在能力 0-200（可視能力値の平均×10・§4.5）
  PA: number;                     // 潜在能力 0-200（CAの上限。生成時決定・原則不変）
  attributes: Attributes;         // 個別能力値（4カテゴリ）

  // --- 状態値（能力値とは別）---
  salaryDemand: Money;            // 要求給与（基準×忠誠オフセット×国係数・§4.3）
  morale: number;                 // 士気 0-100（動的）
  reputation: number;             // 業界知名度 0-100（能力値とは別）
  scoutLevel: ScoutLevel;         // PA・人格の開示度 0-2（§4.8）

  // --- 語学・契約・特性 ---
  languages: CountryCode[];       // 語学（留学で拡張）→採用距離に影響
  contract: Contract | null;      // 雇用契約（未雇用の候補者は null）
  traits: string[];               // 特性タグ（統率補正など）

  // --- 一族・後継 ---
  relationToPC: RelationToPC;     // PCとの関係
  isSuccessorCandidate: boolean;  // 実子のみ true（§10.2）
}


/* ==============================================================
 * 2. Blueprint（青写真スキルツリー）  §5
 * ============================================================== */

/** 青写真ノード。4軸解放条件＋RPコスト＋ミッションタグ（§5）。 */
export interface Blueprint {
  id: Id;
  name: string;
  prerequisites: Id[];        // 前提青写真ID（全て解放済で条件充足）
  requiredEra: Era;           // 到達Era条件
  requiredLaws: string[];     // 必要な法律/ライセンス（例: 金融ライセンス）
  allowedCountries: PlayableCountry[]; // 起業国が許可リストに含まれること
  missionTags: string[];      // ミッションタグ（違反タグを持つとグレーアウト）
  rpCost: number;             // 解放に必要なRP
  isCompany: boolean;         // true=社ノード(RP_C), false=個人ノード(RP_P)
  qualCeiling: Pct100;        // このBPが与えるQUAL上限（陳腐化で低下・§7.1）
  unlocked: boolean;          // 解放済みか
}


/* ==============================================================
 * 3. CapTable / Holder（株式ガバナンス）  §8
 * ============================================================== */

/** 株主（§8）。 */
export interface Holder {
  holderId: Id;               // PC / 投資家 / 社員 / ライバル など
  kind: "pc" | "vc" | "employee" | "rival" | "founderFamily";
  shares: number;             // 保有株数
  votingRight: number;        // 議決権比率 0.0-1.0（種類株で shares と乖離可）
  hostile: boolean;           // 敵対的か（追放を仕掛ける側）
  cooperative: boolean;       // PC影響下（協力的）か
}

/** キャップテーブル（§8）。増資で希薄化、追放閾値50%（§8）。 */
export interface CapTable {
  totalShares: number;        // 総発行株式数
  holders: Holder[];          // 全株主
  pcShareRatio: number;       // PC個人の持株比率（希薄化で低下）
  pcInfluenceRatio: number;   // PC影響下比率（協力holder合計）
  hostileVotingRatio: number; // 敵対議決権合計（>50%で追放可決・§8）
  valuation: Money;           // 直近ラウンド評価額（希薄化計算に使用）
}


/* ==============================================================
 * 4. WorldEvent（時代・法律・技術イベント）  §7
 * ============================================================== */

/** 世界イベント。チャンスと制約の両面を持つ（§7.2）。 */
export interface WorldEvent {
  id: Id;
  category: "era" | "law" | "tech" | "market"; // 種別
  name: string;
  triggerEra: Era | null;       // 発火Era（null=Era非依存）
  affectedCountries: PlayableCountry[]; // 影響国（支社国も個別に晒される・§7.2）
  effects: {
    unlockBlueprints?: Id[];    // 解放される青写真
    marketMultiplierDelta?: number; // 市場規模係数の増減
    requiresLicense?: string;   // 要ライセンス化（違反でTRAC暴落）
    complianceCost?: Money;     // 遵守コスト（毎ターン）
    tracPenaltyOnViolation?: number; // 違反時のTRAC毀損
  };
}


/* ==============================================================
 * 5. Company（会社）  §3 / §4.11 / §5 / §12.7
 * ============================================================== */

/** THxP（サンクスポイント）3ストリーム（§4.11.1）。金では買えず sticky。 */
export interface THxP {
  customer: number; // 顧客THxP：高QUAL・良サービス → 市場評判/売上
  regional: number; // 地域/教育THxP：教育・地域投資 → 採用力・人材プールの質
  employee: number; // 社員THxP：高morale・公正報酬 → 定着・造反抑制
}

/** 会社ミッション（青写真のミッション整合判定に使用・§5）。 */
export interface Mission {
  tags: string[];             // ミッションタグ（例: 雇用創出）。違反BPは選択不能
  changedThisTurn: boolean;   // ピボット時のみ変更可
}

/**
 * 会社（Company）。§13-5。
 * リソース（CASH/QUAL/TRAC/THxP/reputation）と組織・時代・税制を保持。
 */
export interface Company {
  id: Id;
  name: string;
  foundedCountry: PlayableCountry; // 設立国（税制・人材プールの基準・§12.7）
  cluster: ClusterId;

  // --- 主要リソース（§3）---
  CASH: Money;                // 会社キャッシュ
  QUAL: Pct100;               // プロダクト品質 0-100
  TRAC: Pct100;               // トラクション 0-100
  THxP: THxP;                 // サンクスポイント（3ストリーム）
  reputation: Pct100;         // 会社評判 0-100（人材到達ティアを規定・§4.10.4）

  // --- 組織・戦略 ---
  mission: Mission;           // 会社ミッション
  divisions: Id[];            // 部門ID群（§6）
  branches: Id[];             // 海外支社ID群（§6.4）
  era: Era;                   // 現在の時代
  phase: BusinessPhase;       // 事業フェーズ（§2.1）
  taxProfileCountry: PlayableCountry; // 適用税制（設立国。支社は別途）
  unlockedBlueprints: Id[];   // 解放済み青写真

  // --- 派生・キャッシュ値（毎ターン再計算）---
  monthlyBurn: Money;         // 月次バーンレート（§6.3）
  runwayTurns: number;        // ランウェイ = CASH / burn（§6.3）
}

/** 事業フェーズ（§2.1。会社状態で自動遷移）。 */
export type BusinessPhase =
  | "ideation"   // ①アイデア検証
  | "funding"    // ②資金調達
  | "mvp"        // ③MVP開発
  | "launch"     // ④市場投入
  | "growth"     // ⑤成長／ピボット
  | "exit";      // ⑥イグジット（任意）


/* ==============================================================
 * 6. PlayerCharacter（PC）  §1.4 / §9 / §13-6
 * --------------------------------------------------------------
 *  操作対象は常にPC一人（§1.4）。Person を内包し、AP・WEALTH・
 *  一族関係など PC 固有の状態を追加する。
 * ============================================================== */

export interface PlayerCharacter {
  person: Person;             // 能力値・年齢・寿命は Person と同一体系（§13-6）
  ap: number;                 // 行動ポイント（毎ターン10回復・§2.3）
  apMax: number;              // AP上限（初期10）
  wealth: Money;              // 個人資産（CASHとは分離管理・§9.2）
  rpPersonal: number;         // 個人研究ポイント RP_P
  spouseId: Id | null;        // 配偶者（Person.id）
  childrenIds: Id[];          // 実子（後継者候補）
  lifestyleFactor: number;    // ライフスタイル係数 0.7(質素)〜3.0(贅沢)・§12.5
  generation: number;         // 何代目か（世代交代でインクリメント・§10）
}


/* ==============================================================
 * 7. RoleReferenceMap（役割→参照能力値マップ）  §4.6.1
 * --------------------------------------------------------------
 *  CAは職業非依存。役割パフォーマンスは参照能力値だけで決まる。
 *  「主」能力に重みを掛け、副次能力を加える。
 * ============================================================== */

/** ある役割が参照する能力値と重み（§4.6.1）。 */
export interface RoleReference {
  role: Role;
  primary: keyof (OccupationalAttributes & MentalAttributes); // 主参照（×主）
  primaryWeight: number;      // 主能力の重み（例: 2.0）
  secondary: (keyof (OccupationalAttributes & MentalAttributes))[]; // 副参照
}

/** 役割別マップ全体（§4.6.1 の表を実装したもの）。 */
export type RoleReferenceMap = Record<Role, RoleReference>;


/* ==============================================================
 * 8. TalentPoolConfig / GDPByEraTable（人材生成）  §4.10
 * ============================================================== */

/** PA希少性分布の1帯（§4.10.2）。 */
export interface PaTier {
  min: number;                // PA下限
  max: number;                // PA上限
  ratio: number;              // 出現比率 0.0-1.0
  label: string;              // 一般 / 優秀 / 一流 / 超一流 / 世代の逸材
}

/** 会社評判→到達可能上限PA帯（§4.10.4 評判ゲート）。 */
export interface ReputationGate {
  reputationMin: number;      // 評判下限
  reputationMax: number;      // 評判上限
  reachablePaMax: number;     // 到達可能な上限PA
}

/** 人材プール生成設定（§4.10.5）。 */
export interface TalentPoolConfig {
  initialPoolSize: number;    // 初期候補プール数（80〜150）
  refreshInterval: number;    // 何ターンごとに一部入替か
  paTiers: PaTier[];          // PA希少性分布
  reputationGates: ReputationGate[]; // 評判ティア
  gdpAlpha: number;           // GDP偏り強度 α（初期1.2・§4.10.5）
  jobMixByCountry: Partial<Record<CountryCode, Partial<Record<JobCategory, number>>>>; // 職種構成偏り
}

/** 抽象Era×国のGDPシェア表（§4.10.6。高PA湧き重み）。 */
export type GDPByEraTable = Record<Era, Partial<Record<CountryCode, number>>>;


/* ==============================================================
 * 9. RivalCompany（ライバル社）  §4.12
 * --------------------------------------------------------------
 *  各国最低300社。LODで階層化（近接=中詳細/遠方=統計的抽象）。
 * ============================================================== */

/** LOD層（§4.12.1）。 */
export type LodLayer = "near" | "far"; // 近接（詳細）/ 遠方（抽象）

/** 狙う人材像（§4.12.2 targetProfile）。 */
export interface TargetProfile {
  jobCategories: JobCategory[]; // 狙う職種
  caMin: number;                // 狙うCA下限
  paMin: number;                // 狙うPA下限
}

/** ライバル社（軽量スキーマ・§4.12.2）。一族の深いシミュは持たない。 */
export interface RivalCompany {
  id: Id;
  name: string;
  country: CountryCode;
  sector: string;
  reputationTier: number;     // 評判ティア（0-4程度に量子化）
  scaleTier: number;          // 規模ティア（現金/従業員）
  aggression: number;         // 攻撃性 0-1（採用/引き抜き/買収の積極度）
  targetProfile: TargetProfile; // 狙う人材像
  keyStaff: Id[];             // 主要人材（引き抜き対象にもなる）
  ambitionFocus: "expand" | "tech" | "share"; // 志向
  lod: LodLayer;              // 現在のLOD層（進出で near 昇格）
}


/* ==============================================================
 * 10. Division / Branch（組織・海外支社）  §6 / §6.4
 * ============================================================== */

/** 委任ポリシー（部門の自動運転方針・§2.5.1）。 */
export interface DivisionPolicy {
  budgetCap: Money;           // 予算上限
  riskAppetite: "low" | "mid" | "high"; // リスク許容度
  hiringEnabled: boolean;     // 自動採用の可否
}

/** 部門（§6.2）。管理者・メンバー・階層深さ・ポリシー・委任フラグ。 */
export interface Division {
  id: Id;
  name: string;
  jobCategory: JobCategory;   // 部門の職能
  managerId: Id | null;       // 管理者（部門長）
  memberIds: Id[];            // メンバー
  hierarchyDepth: number;     // 本社からの階層深さ（実行成功率に影響・§6.2）
  delegated: boolean;         // 委任中か（true=AP消費なし自動実行）
  policy: DivisionPolicy;     // 委任ポリシー
}

/** 海外支社（§6.4）。Division の一種＋現地採用/市場解放。 */
export interface Branch {
  id: Id;
  country: PlayableCountry;   // 設立国
  cluster: ClusterId;         // その国のクラスタ
  managerId: Id;              // 支社長（必須）
  setupCost: Money;           // 設立一時金（CASH）
  upkeep: Money;              // 毎ターン維持費（現地固定費＋法規制遵守）
  localHiringUnlocked: boolean; // 現地クラスタの人材プール解放
  hierarchyDepth: number;     // 本社からの階層深さ（+1〜・実行確率に影響）
}


/* ==============================================================
 * 11. EducationPlan（子の教育・留学）  §9.4
 * ============================================================== */

export interface EducationPlan {
  childId: Id;                // 対象の実子
  stage: "primary" | "secondary" | "higher" | "abroad" | "vocational"; // 初等/中等/高等/留学/専門
  costPerTurn: Money;         // WEALTHから毎ターン
  abroadCountry: CountryCode | null; // 留学先（国内なら null）
  focus: JobCategory | "general"; // 育成focus
  durationTurns: number;      // 期間
}


/* ==============================================================
 * 12. AutoRunConfig（オートラン・割り込み条件）  §2.5
 * ============================================================== */

/** 割り込みカテゴリ（§2.5.2 の表）。 */
export type InterruptCategory =
  | "cashCrisis"     // 資金危機（ランウェイ閾値割れ）
  | "governance"     // ガバナンス危機（敵対議決権接近）
  | "opportunity"    // 好機（新BP・有力FA・好条件調達）
  | "lifeEvent"      // 人生イベント（恋愛/結婚/出産/健康/後継進路）
  | "milestone"      // 節目（フェーズ遷移・イグジット条件成立）
  | "delegationFail" // 委任の失敗
  | "branchTrouble"; // 海外支社トラブル

/** オートラン設定（§2.5.2。停止条件はプレイヤー設定可能）。 */
export interface AutoRunConfig {
  enabled: boolean;
  runwayThreshold: number;    // ランウェイ閾値（既定6ヶ月・§6.3）
  hostileVotingThreshold: number; // 敵対議決権の停止閾値（例0.45）
  activeInterrupts: InterruptCategory[]; // 有効な停止条件
  maxTurnsPerRun: number;     // 1回のオートランで進める最大ターン
}


/* ==============================================================
 * 13. TaxProfile（国別2026税制）  §9.2 / §12.7
 * ============================================================== */

/** 国別税制プロファイル（§12.7 の確定採用値。税率は最高値・小数=率）。 */
export interface TaxProfile {
  country: PlayableCountry;
  corporate: number;    // 法人税（実効）例: JP 0.30
  dividend: number;     // 配当課税  例: JP 0.20315
  capitalGains: number; // 株式譲渡益 例: JP 0.20315
  incomeTaxTop: number; // 所得税 最高 例: JP 0.55
  inheritanceTop: number; // 相続税 最高 例: JP 0.55
  inheritanceDeduction: Money; // 相続基礎控除（US ~$15M, SG 0 など）
}


/* ==============================================================
 * 14. FamilyTree（一族の血縁グラフ）  §9.3.3 / §10
 * --------------------------------------------------------------
 *  血族婚判定・相続に使用。血縁の有無で婚姻可否を判定（§9.3.3）。
 * ============================================================== */

/** 家系図のノード（1人の一族員）。 */
export interface FamilyNode {
  personId: Id;
  parentIds: Id[];            // 親（血縁）。婚姻で加わった配偶者は血縁エッジを持たない
  spouseId: Id | null;        // 配偶者（血縁ではない）
  childrenIds: Id[];          // 実子
  generation: number;         // 世代番号
  alive: boolean;             // 生存フラグ
}

/** 一族の血縁グラフ全体（§9.3.3）。 */
export interface FamilyTree {
  bloodlineId: Id;            // この一族の血統ID
  nodes: Record<Id, FamilyNode>; // personId → ノード
  founderId: Id;              // 初代
  currentPcId: Id;            // 現当主（＝操作対象PC）
}


/* ==============================================================
 * 15. GameState（全体ルート状態）  §13 全体を束ねる
 * --------------------------------------------------------------
 *  セーブ/ロードのルート。人材DBは Map で保持（数千件規模・§5参照）。
 * ============================================================== */

export interface GameState {
  version: string;            // スキーマバージョン（マイグレーション用）
  turn: number;               // 現在ターン（1ターン=1ヶ月・§0）
  era: Era;                   // 現在の時代

  pc: PlayerCharacter;        // 操作対象PC（常に一人・§1.4）
  company: Company;           // 自社
  familyTree: FamilyTree;     // 一族の血縁グラフ

  // --- DB群（大規模。id→エンティティの辞書で保持）---
  people: Record<Id, Person>;        // 全人材DB（社員・候補・一族・keyStaff）
  divisions: Record<Id, Division>;   // 部門
  branches: Record<Id, Branch>;      // 海外支社
  blueprints: Record<Id, Blueprint>; // 青写真ツリー
  capTable: CapTable;                // 自社の株式
  rivals: Record<Id, RivalCompany>;  // ライバル社（各国300+）
  educationPlans: Record<Id, EducationPlan>; // 進行中の教育計画
  worldEventLog: WorldEvent[];       // 発生済みイベント履歴

  // --- 設定・静的参照テーブル（生成/計算に使用）---
  autoRun: AutoRunConfig;
  taxProfiles: Record<PlayableCountry, TaxProfile>;
  roleReferenceMap: RoleReferenceMap;
  talentPoolConfig: TalentPoolConfig;
  gdpByEra: GDPByEraTable;

  rngSeed: number;            // 乱数シード（再現性・セーブに含める）
}
