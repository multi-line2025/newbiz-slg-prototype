/**
 * ======================================================================
 *  main.ts  縦スライスUI（DOM描画・アクション接続）
 * ----------------------------------------------------------------------
 *  core を呼ぶだけ。状態は書き換えず、各アクション/advanceTurnの戻り値で差し替える。
 *  アートUIUXコンセプト（ダーク基調・CA=緑 / PA=紫）を継続。
 *  段階開示は scoutLevel で「?（不明）→ ぼやけレンジ → 鮮明な正確値」で表現。
 * ======================================================================
 */

import { initGame } from "../core/init";
import { advanceTurn } from "../core/turn";
import type { ProtoGameState, MarketState } from "../core/state";
import { employees, poolPeople, productTeam, effectiveApMax, pcWorking, gameYear } from "../core/state";
import {
  SECTORS25, FOUNDATIONS, SERVICES, techAvailable, serviceStatus, prereqTechsOf,
  sectorProfile, type Service,
} from "../core/blueprints25";
import type { PlayableCountry, JobCategory, Role } from "../core/model/types";
import {
  scoutCandidate,
  assignRole,
  assignToProduct,
  launchProduct,
  analyzeMarket,
  setResearchBudget,
  setMarketBudget,
  unlockBlueprint,
  companyScoutSkill,
  subscribeScoutCountry,
  unsubscribeScoutCountry,
  makeOffer,
  courtCandidate,
  proposeMarriage,
  educateChild,
  scoutMarriageCandidate,
  setTryForChild,
  releasePC,
  designateSuccessor,
  retire,
  hireFamily,
  raiseCapital,
  buyRivalShares,
  sellRivalShares,
  type ActionResult,
  type MarketChannel,
} from "../core/actions";
import {
  companyValuation, pcShareRatio, founderEquityValue, rivalSharePrice, rivalValuation,
  holdingMarketValue, holdingUnrealized, portfolioValue, findRival, isRivalTradeable, capitalGainsRate,
} from "../core/stock";
import { scoutedView, type ScoutView } from "../core/scout";
import { aggregateRivals, type RivalView } from "../core/rivals";
import {
  pcPerson, eligiblePartners, repMatchProbability, fertility,
  currentLover, marriageView, spouseIncome, pcSalary, lifestyleCost,
  validSuccessor, isFamilyMember,
} from "../core/family";
import { BLUEPRINTS, blueprintStatus, researchCoeff, rpPerTurn, blueprintForSector, sectorTier, breadthDepth, type LockReason } from "../core/research";
import {
  productCompetitiveness, marketRivalComp, earnedShareCap, reachShareCap, productRevenue,
} from "../core/market";
import { marketEff, marketSizeOf } from "../core/markets";
import { staleEff } from "../core/dynamics";
import { analysisSkill, fitP, opportunityScore, analyzedRange } from "../core/analysis";
import { SCOUT_STEPS, SECTOR_NAME, SECTORS, ANALYSIS_STEPS, DMAT_REF, SCOUT_SUB_COST, MAX_PENDING_OFFERS, PC_WORK_AP_PENALTY as PC_WORK_AP_PENALTY_UI } from "../core/model/constants";
import { ACHIEVEMENTS, getAchievement, checkAchievements } from "../core/achievements";
import { storage } from "../core/save";
import type { Attributes } from "../core/model/types";

const PLAYABLE: PlayableCountry[] = ["US", "JP", "DE", "GB", "SG"];

// 国コード→表示ラベル
const COUNTRY_LABEL: Record<PlayableCountry, string> = {
  JP: "日本", US: "米国", GB: "英国", DE: "独国", SG: "星国",
};

// Era→表示ラベル
const ERA_LABEL: Record<string, string> = {
  dawn: "黎明期", internet: "インターネット期", smartphone: "スマホ普及期", ai: "AI革新期",
};

// 職種→表示ラベル
const JOB_LABEL: Record<JobCategory, string> = {
  engineer: "エンジニア", designer: "デザイナー", marketer: "マーケター",
  sales: "セールス", finance: "財務", researcher: "リサーチャー", manager: "マネージャー",
};
const JOBS: JobCategory[] = ["engineer", "designer", "marketer", "sales", "finance", "researcher", "manager"];

/**
 * 起動/新規開始のseed。ブラウザ側で乱数化し、毎回違う展開にする（配布版）。
 * 同一プレイ内の再現性はコアのPRNG（このseedから決定論）で担保される。
 */
function freshSeed(): number {
  const g: any = globalThis;
  if (g.crypto?.getRandomValues) return g.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

let state: ProtoGameState = initGame({ seed: freshSeed(), country: "US" });
let toast = ""; // 直近アクションの結果メッセージ
let selectedPersonId: string | null = null; // 詳細ビュー対象（nullで閉じる）

/** FM風タブ（グローバルHUDは常時表示、内容だけ切り替え）。 */
type TabId = "overview" | "talent" | "market" | "rivals" | "products" | "research" | "techtree" | "finance" | "stock" | "career" | "family" | "achievements";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "概要" },
  { id: "talent", label: "人材" },
  { id: "market", label: "市場分析" },
  { id: "rivals", label: "他企業" },
  { id: "products", label: "製品" },
  { id: "research", label: "研究・青写真" },
  { id: "techtree", label: "技術ツリー" },
  { id: "finance", label: "財務・組織" },
  { id: "stock", label: "株式" },
  { id: "career", label: "個人" },
  { id: "family", label: "家族" },
  { id: "achievements", label: "実績" },
];
// アクティブタブはUI層のモジュール状態（ターン送り/セーブ/ロードでも保持。新規開始で概要へ）。
let activeTab: TabId = "overview";
// 新規開始時の業態選択モーダル表示フラグ（v0.8）。表示中は選択するまでゲームを始めない。
let choosingArchetype = false;
// 採用市場で選択中の国（v0.10・国別タブ）。null なら描画時に起業国へフォールバック。
let recruitCountry: PlayableCountry | null = null;
// 採用市場の並べ替え・職種フィルタ・ページ（v0.11・全候補表示）。
type RecruitSort = "stars" | "salaryAsc" | "ageAsc" | "caDesc";
let recruitSort: RecruitSort = "stars";
let recruitJob: JobCategory | "all" = "all";
let recruitPage = 0;
const RECRUIT_PAGE_SIZE = 20; // 1ページ描画数（500人でも軽い）
// 技術ツリー（v0.20）：セクター/状態フィルタ・ページ
let techSector = "all";
let techStatusFilter: "all" | "unlockable" | "locked" = "all";
let techPage = 0;
const TECH_PAGE_SIZE = 24;

/** その人物が現在“見える”か（社員/家族＝常に可視／候補＝その国のサブスク加入時のみ）。 */
function isVisible(p: { id: string; nationality: string }): boolean {
  if (state.employeeIds.includes(p.id)) return true;
  if (isFamilyMember(state, p.id)) return true; // v0.18：家族（実子・兄弟姉妹・配偶者）は常時可視
  return state.scoutSubscriptions.includes(p.nationality as PlayableCountry);
}
/** サブスク可視性を織り込んだ scoutedView。 */
function viewOf(p: Parameters<typeof scoutedView>[0]): ScoutView {
  return scoutedView(p, companyScoutSkill(state), isVisible(p));
}

const fmt = (n: number): string => Math.round(n).toLocaleString();
const runwayText = (n: number): string => (isFinite(n) ? `${n.toFixed(1)} ヶ月` : "∞");
const stars = (n: number): string => "★".repeat(n) + "☆".repeat(5 - n);

/** 実績判定を行い、新規達成があればトーストに反映する。 */
function runAchievements(): void {
  const r = checkAchievements(state);
  state = r.state;
  if (r.newly.length > 0) toast = `🏆 実績解除：${r.newly.map((a) => a.label).join(" / ")}`;
}

/** アクション結果を反映し、トーストを更新して再描画。 */
function apply(res: ActionResult): void {
  state = res.state;
  toast = res.message;
  runAchievements(); // 採用・青写真解放など アクション起因の実績を即時判定
  render();
}

/** 在籍社員の行（役割セレクト＋製品配属セレクト）。 */
function employeeRow(p: {
  id: string; name: string; age: number; nationality: string;
  CA: number; PA: number; jobCategory: JobCategory; assignedRole: Role | null;
  contract: { salary: number } | null;
}): string {
  const label = COUNTRY_LABEL[p.nationality as PlayableCountry] ?? p.nationality;
  const roleOpts = JOBS.map(
    (j) => `<option value="${j}" ${p.assignedRole === j ? "selected" : ""}>${JOB_LABEL[j]}</option>`
  ).join("");
  const cur = state.assignments[p.id] ?? "";
  const prodOpts = `<option value="">（未配属）</option>` + state.products.map(
    (pr) => `<option value="${pr.id}" ${cur === pr.id ? "selected" : ""}>${SECTOR_NAME[pr.sector]}×${COUNTRY_LABEL[pr.country]}</option>`
  ).join("");
  return `<tr>
    <td class="name"><a class="pname" data-person="${p.id}">${p.name}</a></td>
    <td>${JOB_LABEL[p.jobCategory]}</td>
    <td class="num">${p.age.toFixed(1)}</td>
    <td class="ctry">${label}</td>
    <td class="num ca">${p.CA}</td>
    <td class="num pa">${p.PA}</td>
    <td class="num">$${fmt(p.contract?.salary ?? 0)}</td>
    <td><select data-assign="${p.id}">${roleOpts}</select></td>
    <td><select data-passign="${p.id}">${prodOpts}</select></td>
  </tr>`;
}

/** スカウト段階に応じたCA表示（未スカウトは?・オーナー要望）。 */
function caCell(v: ScoutView): string {
  if (v.caKnown != null) return `<span class="ca">${v.caKnown}</span>`;
  return `<span class="unknown">?</span>`;
}
/** スカウト段階に応じたPA表示（?→レンジ→正確値）。 */
function paCell(v: ScoutView): string {
  if (v.paKnown != null) return `<span class="pa">${v.paKnown}</span>`;
  if (v.paRange) return `<span class="pa blur">${v.paRange.low}–${v.paRange.high}</span>`;
  return `<span class="unknown">?</span>`;
}
/** 忠誠の段階表示。 */
function loyCell(v: ScoutView): string {
  if (v.loyaltyKnown != null) return `<span>${v.loyaltyKnown}</span>`;
  if (v.loyaltyRange) return `<span class="blur">${v.loyaltyRange.low}–${v.loyaltyRange.high}</span>`;
  return `<span class="unknown">?</span>`;
}

/** 候補者の行（スカウト段階でゲート＋スカウト/採用ボタン）。CAも未スカウトは非表示。 */
function candidateRow(
  p: { id: string; name: string; age: number; nationality: string; jobCategory: JobCategory; salaryDemand: number; scoutLevel: number },
  view: ScoutView
): string {
  const label = COUNTRY_LABEL[p.nationality as PlayableCountry] ?? p.nationality;
  const nextStep = p.scoutLevel < 2 ? SCOUT_STEPS[p.scoutLevel] : null;
  const scoutBtn = nextStep
    ? `<button class="mini" data-scout="${p.id}">スカウトLv${p.scoutLevel + 1}<br><span class="cost">${nextStep.ap}AP/$${fmt(nextStep.cash)}</span></button>`
    : `<span class="done">調査済</span>`;
  const pending = state.pendingHires.find((o) => o.personId === p.id);
  const offerBtn = pending
    ? `<span class="negotiating">交渉中<br><span class="cost">残${pending.remaining}T</span></span>`
    : `<button class="mini offer" data-offer="${p.id}">オファー<br><span class="cost">1AP</span></button>`;
  return `<tr>
    <td class="name"><a class="pname" data-person="${p.id}">${p.name}</a></td>
    <td>${JOB_LABEL[p.jobCategory]}</td>
    <td class="num">${p.age.toFixed(1)}</td>
    <td class="ctry">${label}</td>
    <td class="stars">${stars(view.occStars)}</td>
    <td class="num">${caCell(view)}</td>
    <td class="num">${paCell(view)}</td>
    <td class="num">${loyCell(view)}</td>
    <td class="num">$${fmt(p.salaryDemand)}</td>
    <td class="acts">${scoutBtn}${offerBtn}</td>
  </tr>`;
}

/* ============================================================
 * 人材詳細ビュー（クリックで開く。社員＝フル / 候補＝scoutゲート）
 * ============================================================ */

const CAT_LABEL: Record<keyof Attributes, string> = {
  occupational: "① 専門技能", mental: "② メンタル", condition: "③ コンディション", hidden: "④ 人格・隠し",
};
const ATTR_LABEL: Record<string, string> = {
  engineering: "エンジニアリング", design: "デザイン", marketing: "マーケティング", sales: "セールス",
  finance: "財務", research: "リサーチ", management: "マネジメント",
  composure: "冷静さ", decisions: "判断力", determination: "決断力", concentration: "集中力",
  anticipation: "先読み", creativity: "創造性", vision: "ビジョン", leadership: "統率力",
  teamwork: "協調性", ambition: "野心", bravery: "度胸",
  stamina: "体力", stressResist: "ストレス耐性", health: "健康",
  integrity: "誠実さ", professionalism: "プロ意識", adaptability: "順応性", consistency: "一貫性",
  loyalty: "忠誠", temperament: "気性", controversy: "問題行動性", durability: "頑健さ",
};

/** 1能力値のバー（1-20）。表示は整数、ホバーで独自ツールチップに実数値(小数2桁)を即表示（v0.19）。 */
function attrBar(label: string, val: number): string {
  const pct = (val / 20) * 100;
  const shown = Math.round(val);
  return `<div class="ab" data-exact="${label} ${val.toFixed(2)}"><span class="ab-l">${label}</span><span class="ab-track"><span class="ab-fill" style="width:${pct}%"></span></span><span class="ab-v">${shown}</span></div>`;
}
/** 1カテゴリのバー群。 */
function attrCategory(cat: keyof Attributes, attrs: Attributes): string {
  const group = attrs[cat] as unknown as Record<string, number>;
  const bars = Object.keys(group).map((k) => attrBar(ATTR_LABEL[k] ?? k, group[k])).join("");
  return `<div class="ab-cat"><h4>${CAT_LABEL[cat]}</h4>${bars}</div>`;
}

/** 詳細モーダルのHTML（selectedPersonIdがnullなら空）。 */
function detailModal(): string {
  if (!selectedPersonId) return "";
  const p = state.people[selectedPersonId];
  if (!p) return "";
  const label = COUNTRY_LABEL[p.nationality as PlayableCountry] ?? p.nationality;
  const isEmployee = state.employeeIds.includes(p.id);

  let body: string;
  if (isEmployee) {
    // フル開示：28（29）能力を4カテゴリのバーで
    body = `
      <div class="d-kpis">
        <span><b class="ca">CA ${Math.round(p.CA)}</b> / <b class="pa">PA ${p.PA}</b></span>
        <span>忠誠 ${p.attributes.hidden.loyalty} / 士気 ${p.morale}</span>
        <span>月給 $${fmt(p.contract?.salary ?? 0)}</span>
        <span>配属 ${p.assignedRole ? JOB_LABEL[p.assignedRole] : "未配属"}</span>
      </div>
      <div class="ab-grid">
        ${attrCategory("occupational", p.attributes)}
        ${attrCategory("mental", p.attributes)}
        ${attrCategory("condition", p.attributes)}
        ${attrCategory("hidden", p.attributes)}
      </div>`;
  } else if (!isVisible(p)) {
    // 未加入国：★も素性も一切不明（完全フォグ）。加入導線のみ。
    body = `
      <div class="d-note">${COUNTRY_LABEL[p.nationality as PlayableCountry] ?? p.nationality}は未加入です。スカウトサブスクに加入すると★が見え、個別スカウトで深掘りできます。</div>
      <div class="d-list">
        <div class="d-row"><span>専門技能（概算）</span><span class="unknown">不明（未加入）</span></div>
        <div class="d-row"><span>CA / PA / 忠誠</span><span class="unknown">不明</span></div>
      </div>
      <div class="d-acts"><button class="primary" data-sub="${p.nationality}">加入して開示（月額$${fmt(SCOUT_SUB_COST[p.nationality as PlayableCountry])}）</button></div>`;
  } else {
    // 候補者（加入国）：scoutLevelでゲート。未スカウトはCA/PA/人格を出さない
    const v = viewOf(p);
    const line = (k: string, cell: string) => `<div class="d-row"><span>${k}</span><span>${cell}</span></div>`;
    const gateNote =
      v.scoutLevel === 0 ? "未スカウト：専門技能の星のみ。CA・PA・人格はスカウトで開示されます。"
      : v.scoutLevel === 1 ? "簡易スカウト済：PA・忠誠はぼやけたレンジ。精密調査で正確値に。"
      : "精密調査済：正確値を開示。";
    body = `
      <div class="d-note">${gateNote}</div>
      <div class="d-list">
        ${line("専門技能（概算）", `<span class="stars">${stars(v.occStars)}</span>`)}
        ${line("CA（現在能力）", caCell(v))}
        ${line("PA（潜在能力）", paCell(v))}
        ${line("忠誠", loyCell(v))}
        ${line("問題行動性", v.controversyKnown != null ? `${v.controversyKnown}` : `<span class="unknown">?</span>`)}
      </div>
      <div class="d-acts">
        ${v.scoutLevel < 2 ? `<button class="mini" data-scout="${p.id}">スカウトLv${v.scoutLevel + 1}<br><span class="cost">${SCOUT_STEPS[v.scoutLevel].ap}AP/$${fmt(SCOUT_STEPS[v.scoutLevel].cash)}</span></button>` : `<span class="done">調査済</span>`}
        ${state.pendingHires.find((o) => o.personId === p.id)
          ? `<span class="negotiating">交渉中（残${state.pendingHires.find((o) => o.personId === p.id)!.remaining}ターン）</span>`
          : `<button class="mini offer" data-offer="${p.id}">オファーを出す<br><span class="cost">1AP・${3}T</span></button>`}
      </div>`;
  }

  return `<div class="modal-bg" data-close="1">
    <div class="modal">
      <div class="modal-head">
        <div><b>${p.name}</b> <span class="muted">${JOB_LABEL[p.jobCategory]} / ${p.age.toFixed(1)}歳 / ${label} / ${isEmployee ? "自社社員（フル開示）" : "採用候補"}</span></div>
        <button class="mini" data-close="1">✕</button>
      </div>
      ${body}
    </div>
  </div>`;
}

/** 青写真1ノードのミニチップ（tier連鎖の1つ）。 */
function blueprintChip(bp: typeof BLUEPRINTS[number], status: LockReason): string {
  const cls = status === "unlocked" ? "bp-done" : status === "ok" ? "bp-ok" : status === "mission" ? "bp-conflict" : "bp-lock";
  const cap = [55, 72, 88, 100][bp.tier - 1];
  const inner = status === "ok"
    ? `<button class="mini" data-unlock="${bp.id}">解放<br><span class="cost">${bp.rpCost}RP</span></button>`
    : status === "unlocked" ? `<span class="bp-state">✓済</span>`
    : status === "prereq" ? `<span class="bp-state">前提待</span>`
    : status === "era" ? `<span class="bp-state">${ERA_LABEL[bp.requiredEra]}待</span>`
    : status === "mission" ? `<span class="bp-state">衝突</span>`
    : `<span class="bp-state">RP${bp.rpCost}</span>`;
  return `<div class="bp-chip ${cls}" title="QUAL_p天井${cap}">
    <div class="bp-chip-h">t${bp.tier} ${bp.name}</div>${inner}</div>`;
}

/** 研究＆青写真ツリー・パネル（セクター別tier連鎖＝特化 vs 汎用）。 */
function blueprintPanel(): string {
  const c = state.company;
  const rpNext = rpPerTurn(employees(state), c.researchBudget);
  const coeff = researchCoeff(c.researchBudget);
  const bd = breadthDepth(c.unlockedBlueprints);
  const branches = SECTORS.map((sec) => {
    const chain = BLUEPRINTS.filter((b) => b.targetSector === sec).sort((a, b) => a.tier - b.tier);
    const tier = sectorTier(sec, c.unlockedBlueprints);
    const chips = chain.map((bp) => blueprintChip(bp, blueprintStatus(bp, c.unlockedBlueprints, state.era, c.RP_C, c.missionTags))).join("");
    const formula = chain[0].qualFormula.map((t) => `${JOB_LABEL[t.role]}`).join("+");
    return `<div class="branch">
      <div class="branch-h">${SECTOR_NAME[sec]} <span class="muted">tier${tier}到達 / 品質規定 ${formula}</span></div>
      <div class="branch-chips">${chips}</div>
    </div>`;
  }).join("");
  return `<section class="panel">
    <h2>研究＆青写真ツリー（特化 vs 汎用）
      <span class="legend">tier1=参入切符（QUAL_p天井55）→ 深掘りで天井↑・C_p↑・展開速い。広さ(切符)と深さ(特化)へ有限RPを配分（要望⑤）</span></h2>
    <div class="research-bar">
      <div class="rb-item">RP_C <b>${Math.floor(c.RP_C)}</b></div>
      <div class="rb-item">研究投資 <b>$${fmt(c.researchBudget)}</b>/ターン
        <button class="mini" data-rbudget="-1">−$1,000</button>
        <button class="mini" data-rbudget="1">＋$1,000</button></div>
      <div class="rb-item">研究投資係数 <b>${coeff.toFixed(1)}</b></div>
      <div class="rb-item">RP産出 <b>+${rpNext.toFixed(1)}</b>/T</div>
      <div class="rb-item">breadth(切符) <b>${bd.breadth}</b> / depth(最深) <b>${bd.depth}</b></div>
    </div>
    <div class="branch-grid">${branches}</div>
  </section>`;
}

/** 自社製品パネル（製品別QUAL_p・シェア・マーケ4チャネル予算）。 */
function productsPanel(): string {
  const c = state.company;
  const cards = state.products.map((p) => {
    const market = state.markets[p.marketId];
    const team = productTeam(state, p.id);
    const trac = p.sticky + p.paid;
    const tier = sectorTier(p.sector, c.unlockedBlueprints);
    const cP = market ? productCompetitiveness(p.QUAL_p, team, c, tier) : 0;
    const sumCr = market ? marketRivalComp(market, state.era, state.marketSeed) : 0;
    const sEarned = earnedShareCap(cP, sumCr) * 100;
    const sReach = reachShareCap(p.QUAL_p, sEarned / 100) * 100;
    const cap = [55, 72, 88, 100][Math.max(1, tier) - 1];
    const backfire = p.QUAL_p < 40 && p.adBudget > 0;
    const matTxt = market ? `市場成熟${(market.maturity * 100).toFixed(0)}%` : "";
    const chan = (key: MarketChannel, label: string) => `
      <span class="pch">${label} $${fmt(p[key])}
        <button class="mini xs" data-mbudget="${p.id}:${key}:-1">−</button>
        <button class="mini xs" data-mbudget="${p.id}:${key}:1">＋</button></span>`;
    return `<div class="prod-card">
      <div class="prod-head"><b>${SECTOR_NAME[p.sector]} × ${COUNTRY_LABEL[p.country]}</b>
        <span class="muted">QUAL_p <b class="pa">${p.QUAL_p.toFixed(0)}</b>/天井${cap}(t${tier}) / 開発${p.devTurns}T / 担当${team.length}名${team.some((m) => m.id === state.pc.personId) ? `<span class="mv aggr" style="margin-left:4px">社長兼務</span>` : ""} / ${matTxt}</span></div>
      <div class="share-bar">
        <div class="sb-track">
          <div class="sb-sticky" style="width:${p.sticky}%"></div>
          <div class="sb-paid" style="width:${p.paid}%"></div>
          <div class="sb-cap earned" style="left:${Math.min(100, sEarned)}%"></div>
          <div class="sb-cap reach" style="left:${Math.min(100, sReach)}%"></div>
        </div>
        <div class="sb-legend"><i class="l-sticky"></i>sticky${p.sticky.toFixed(1)} <i class="l-paid"></i>paid${p.paid.toFixed(1)} ＝シェア${trac.toFixed(1)}% / 上限 s*${sEarned.toFixed(0)}%（到達${sReach.toFixed(0)}%）</div>
      </div>
      ${backfire ? `<div class="d-note" style="color:var(--warn)">⚠ QUAL_p&lt;40への広告は逆噴射。先に品質(担当能力)を。</div>` : ""}
      <div class="pch-row">${chan("adBudget", "📣広告")}${chan("prBudget", "🗣PR")}${chan("commBudget", "🌱ｺﾐｭﾆﾃｨ")}
        <span class="pch">🤝セールス ${team.some((e) => e.assignedRole === "sales") ? "稼働" : "無"}</span></div>
    </div>`;
  }).join("");
  return `<section class="panel">
    <h2>自社製品（${state.products.length}）<span class="legend">製品QUAL_p＝担当チームの能力で決まる（青写真の品質規定式）。市場ごとにシェアを争う</span></h2>
    <div class="prod-grid">${cards || "<div class='muted'>製品なし。青写真を解放し分析ページから市場へ投入しよう。</div>"}</div>
    <div class="muted" style="margin-top:8px">顧客THxP（全製品共有）：<b>${c.THxP_customer.toFixed(0)}</b></div>
  </section>`;
}

/** 1市場マスの分析行。 */
function marketRow(m: MarketState): string {
  const c = state.company;
  const team = employees(state);
  const bp = blueprintForSector(m.sector);
  const owns = !!bp && c.unlockedBlueprints.includes(bp.id);
  const existing = state.products.find((p) => p.marketId === m.id) ?? null;
  const trueM = marketEff({ sector: m.sector, country: m.country, biasFactor: m.biasFactor, maturity: m.maturity }, state.era);
  const dormant = marketSizeOf({ sector: m.sector, country: m.country, biasFactor: m.biasFactor }, state.era) <= 0;
  const scouted = m.analysisLevel >= 1;

  // 実効パイ M_eff の開示マスク（Lv0=霧 / Lv1=ぼやけ / Lv2=正確）
  let mCell = `<span class="unknown">？</span>`;
  let dCell = `<span class="unknown">？</span>`;
  let matCell = `<span class="unknown">？</span>`;
  if (m.analysisLevel >= 2 && m.analyzed) {
    mCell = `${m.analyzed.M.toFixed(0)}`;
    dCell = densityLabel(m.analyzed.densityIndex);
    matCell = maturityLabel(m.maturity);
  } else if (m.analysisLevel === 1 && m.analyzed) {
    const r = analyzedRange(m.analyzed.M, m.analyzed.errorPct);
    mCell = `<span class="blur">${r.low.toFixed(0)}–${r.high.toFixed(0)}</span>`;
    dCell = `<span class="blur">${densityLabel(m.analyzed.densityIndex)}</span>`;
    matCell = `<span class="blur">${maturityLabel(m.maturity)}</span>`;
  }

  // 成長ポテンシャル・参入圧トレンド・戦略ラベル（Lv2で開示）
  let growthCell = "—", labelCell = "—";
  const sumCr = marketRivalComp(m, state.era, state.marketSeed);
  const fit = scouted && owns ? fitP(m, c, team, state.era, state.marketSeed, existing) : null;
  let fitCell = "—", oppCell = "—";
  if (m.analysisLevel >= 2 && !dormant) {
    // 成長ポテンシャル（伸び代 (1−maturity)）と参入圧（target−現near）
    const potential = 1 - m.maturity;
    growthCell = potentialLabel(potential, m.lastDeltaMaturity);
    if (fit != null) {
      fitCell = `${(fit * 100).toFixed(0)}%`;
      oppCell = `<b>${opportunityScore(trueM, sumCr, fit).toFixed(0)}</b>`;
    } else {
      fitCell = `<span class="muted">要${bp?.id ?? "BP"}</span>`;
    }
    labelCell = strategyLabel(m, fit, dormant);
  }

  // 分析アクション・投入
  let action = "";
  if (m.analysisInProgress) {
    action = `<span class="muted">分析中(残${m.analysisInProgress.turnsLeft}T)</span>`;
  } else if (m.analysisLevel < 2) {
    const step = ANALYSIS_STEPS[m.analysisLevel];
    action = `<button class="mini" data-analyze="${m.id}">分析Lv${m.analysisLevel + 1}<br><span class="cost">${step.ap}AP/$${fmt(step.cash)}</span></button>`;
  }
  let launch = "";
  if (existing) launch = `<span class="done">投入済</span>`;
  else if (dormant) launch = `<span class="muted">未成立</span>`;
  else if (owns) launch = `<button class="mini hire" data-launch="${bp!.id}:${m.country}">投入<br><span class="cost">1AP/$2k</span></button>`;
  else launch = `<span class="muted">要${bp?.id ?? "BP"}取得</span>`;

  // ホット市場の分析陳腐化短縮バッジ（⚡）
  let stale = "";
  if (m.analysisLevel > 0 && m.lastAnalyzedTurn != null) {
    const remain = staleEff(m) - (state.turn - m.lastAnalyzedTurn);
    if (staleEff(m) < 8) stale = ` <span class="hot" title="ホット市場：分析が早く古びる">⚡${Math.max(0, remain)}</span>`;
    else if (remain <= 2) stale = " ⏳";
  }
  return `<tr class="${dormant ? "mkt-dormant" : ""}">
    <td>${SECTOR_NAME[m.sector]}</td>
    <td class="ctry">${COUNTRY_LABEL[m.country]}</td>
    <td>Lv${m.analysisLevel}${stale}</td>
    <td>${matCell}</td>
    <td class="num">${mCell}</td>
    <td>${dCell}</td>
    <td>${growthCell}</td>
    <td class="num">${fitCell}</td>
    <td class="num">${oppCell}</td>
    <td>${labelCell}</td>
    <td class="acts">${action}</td>
    <td class="acts">${launch}</td>
  </tr>`;
}

/** 競合密度の定性ラベル。 */
function densityLabel(d: number): string {
  if (d < 0.6) return `空き(${d.toFixed(1)})`;
  if (d < 1.2) return `平均(${d.toFixed(1)})`;
  if (d < 1.8) return `混雑(${d.toFixed(1)})`;
  return `激戦(${d.toFixed(1)})`;
}
/** 成熟度の定性ラベル（§6.1）。 */
function maturityLabel(mat: number): string {
  const pct = (mat * 100).toFixed(0);
  if (mat < 0.25) return `未成熟(${pct}%)`;
  if (mat < 0.55) return `成長期(${pct}%)`;
  if (mat < 0.8) return `成熟(${pct}%)`;
  return `飽和(${pct}%)`;
}
/** 成長ポテンシャル（伸び代＋直近成長）。 */
function potentialLabel(potential: number, delta: number): string {
  const growing = delta > DMAT_REF * 0.5 ? " 📈" : "";
  if (potential > 0.6) return `大${growing}`;
  if (potential > 0.3) return `中${growing}`;
  return `小${growing}`;
}
/** 戦略ラベル（§6.2）：🌱先取り/⏳もうすぐ混む/🏔️激戦/💤罠。 */
function strategyLabel(m: MarketState, fit: number | null, dormant: boolean): string {
  if (dormant) return "—";
  const potential = 1 - m.maturity;
  const density = m.analyzed?.densityIndex ?? 1;
  const hot = m.lastDeltaMaturity > DMAT_REF;
  if (m.maturity < 0.35 && potential > 0.5 && density < 1.0) {
    return fit == null ? `🌱<span class="muted">要切符</span>` : `🌱先取り`;
  }
  if (hot || (m.nearCountTarget - m.nearRivals.length) > 3) return `⏳もうすぐ混む`;
  if (m.maturity > 0.6 && density > 1.3) return `🏔️激戦`;
  if (m.maturity < 0.35 && potential <= 0.5) return `💤伸びない`;
  return "・";
}

/* ============================================================
 * 個人キャリア / 家族タブ（v0.13）
 * ============================================================ */

/** ① 個人キャリアタブ：PCプロフィール＋経歴要約。 */
function careerTab(): string {
  const pc = pcPerson(state);
  const info = state.pc;
  const gotAch = state.achievements.map((id) => getAchievement(id)?.label).filter(Boolean);
  const milestones = [
    `第${info.generation}世代の起業家として創業`,
    `現在：ターン${state.turn}（${(pc.age).toFixed(1)}歳）・会社CASH $${fmt(state.company.CASH)}`,
    `解放青写真 ${state.company.unlockedBlueprints.length} / 製品 ${state.products.length}`,
    info.spouseId ? `既婚（配偶者：${state.people[info.spouseId]?.name ?? "?"}）` : "独身",
    info.childrenIds.length ? `子 ${info.childrenIds.length} 人（後継者候補）` : "後継者候補なし",
  ];
  return `
    <section class="panel">
      <h2>個人プロフィール<span class="legend">経営とは別軸の“個人”の格。評判が上がるほど良い伴侶と結ばれる。</span></h2>
      <div class="kpis">
        <div class="kpi"><div class="k">氏名</div><div class="v" style="font-size:15px">${pc.name}</div></div>
        <div class="kpi"><div class="k">性別/年齢</div><div class="v" style="font-size:15px">${pc.sex === "female" ? "女" : "男"} / ${pc.age.toFixed(1)}歳</div></div>
        <div class="kpi"><div class="k">寿命(推定)</div><div class="v">${pc.lifeExpectancy.toFixed(0)}</div></div>
        <div class="kpi"><div class="k">個人評判</div><div class="v">${pc.reputation.toFixed(0)}</div></div>
        <div class="kpi"><div class="k">個人資産</div><div class="v">$${fmt(info.wealth)}</div></div>
        <div class="kpi"><div class="k">個人RP</div><div class="v">${info.rpPersonal}</div></div>
        <div class="kpi"><div class="k">生活水準</div><div class="v">${info.lifestyleFactor.toFixed(1)}</div></div>
        <div class="kpi"><div class="k">世代</div><div class="v">${info.generation}代目</div></div>
      </div>
    </section>
    <section class="panel">
      <h2>あなたの能力値<span class="legend">社長自身の能力（実務兼務で会社の戦力にも）。バーは整数表示・ホバーで実数値。</span></h2>
      <div class="d-kpis">
        <span><b class="ca">CA ${Math.round(pc.CA)}</b> / <b class="pa">PA ${pc.PA}</b></span>
        <span>配属 ${pc.assignedRole ? JOB_LABEL[pc.assignedRole] : "経営専念（未配属）"}</span>
      </div>
      <div class="ab-grid">
        ${attrCategory("occupational", pc.attributes)}
        ${attrCategory("mental", pc.attributes)}
        ${attrCategory("condition", pc.attributes)}
        ${attrCategory("hidden", pc.attributes)}
      </div>
    </section>
    ${pcWorkPanel()}
    <section class="panel">
      <h2>これまでの経歴</h2>
      <div class="loglines">${milestones.map((m) => `<div class="line">・${m}</div>`).join("")}
        ${gotAch.length ? `<div class="line">🏆 実績：${gotAch.join(" / ")}</div>` : ""}</div>
    </section>`;
}

/** 社長の実務兼務パネル（v0.16）：役割・製品へ配属/解除。現場に立つとAP上限が下がる。 */
function pcWorkPanel(): string {
  const pc = pcPerson(state);
  const pcId = state.pc.personId;
  const role = pc.assignedRole;
  const assignedProdId = state.assignments[pcId] ?? "";
  const roleOpts = [`<option value="">—役割なし—</option>`]
    .concat(JOBS.map((j) => `<option value="${j}"${role === j ? " selected" : ""}>${JOB_LABEL[j]}</option>`)).join("");
  const prodOpts = [`<option value="">—製品なし—</option>`]
    .concat(state.products.map((p) => `<option value="${p.id}"${assignedProdId === p.id ? " selected" : ""}>${SECTOR_NAME[p.sector]}×${COUNTRY_LABEL[p.country]}</option>`)).join("");
  const status = pcWorking(state)
    ? `<div class="mv aggr">🛠 社長（兼務）：${role ? JOB_LABEL[role] : "?"}${assignedProdId ? ` ＠ ${state.products.find((p) => p.id === assignedProdId) ? SECTOR_NAME[state.products.find((p) => p.id === assignedProdId)!.sector] + "×" + COUNTRY_LABEL[state.products.find((p) => p.id === assignedProdId)!.country] : ""}` : "（製品未配属）"} ／ AP上限 ${state.apMax}→<b>${effectiveApMax(state)}</b></div>`
    : `<div class="muted">社長は経営に専念中（AP上限 ${state.apMax}）。役割に就くと現場戦力になりますが、AP上限が ${PC_WORK_AP_PENALTY_UI} 下がります。</div>`;
  return `<section class="panel">
    <h2>社長の実務兼務<span class="legend">創業者が穴を埋める＝現場戦力に。ただし経営judgeが手薄に（AP上限−${PC_WORK_AP_PENALTY_UI}）。給与は役員報酬のみ（社員給与は発生しない）。</span></h2>
    ${status}
    <div class="recruit-ctl">
      <label>役割 <select data-pcrole>${roleOpts}</select></label>
      <label>製品 <select data-pcproduct>${prodOpts}</select></label>
      ${pcWorking(state) ? `<button class="mini ghost" data-pcrelease>実務を離れる</button>` : ""}
      <span class="muted">CA ${pc.CA} の戦力として通常社員と同じ式で貢献します。</span>
    </div>
  </section>`;
}

/** 評判釣り合いの実現可能性ラベル。 */
function matchLabel(pcRep: number, partnerRep: number): string {
  const p = repMatchProbability(pcRep, partnerRep);
  if (p <= 0) return `<span class="mv down">格が違いすぎ（不可）</span>`;
  if (p >= 0.7) return `<span class="mv up">釣り合う（${Math.round(p * 100)}%）</span>`;
  if (p >= 0.35) return `<span class="mv aggr">やや格差（${Math.round(p * 100)}%）</span>`;
  return `<span class="mv down">格差大（${Math.round(p * 100)}%）</span>`;
}

/** 結婚候補の評判・釣り合い行（fog：未調査は評判バンド＋推定、調査済みは正確値＋CA/PA）。 */
function marriageInfoLine(p: { reputation: number; scoutLevel: number; CA: number; PA: number }): string {
  const pcRep = pcPerson(state).reputation;
  const v = marriageView(p as unknown as Parameters<typeof marriageView>[0]);
  if (v.scouted) {
    return `<span>評判 ${v.repExact} / CA ${v.ca} / PA ${v.pa}</span>${matchLabel(pcRep, v.repExact!)}`;
  }
  const mid = (v.repBandLow + v.repBandHigh) / 2;
  const est = repMatchProbability(pcRep, mid);
  const estLabel = est <= 0 ? `<span class="mv down">格が違いそう（要調査）</span>`
    : est >= 0.5 ? `<span class="mv aggr">釣り合いそう（未調査）</span>`
    : `<span class="mv aggr">やや格差か（未調査）</span>`;
  return `<span class="blur">評判 ${v.repBandLow}〜${v.repBandHigh}（未調査）</span>${estLabel}`;
}

/** ② 家族タブ：配偶者・子・妊娠＋恋愛/結婚/教育コマンド（v0.14：結婚市場fog・両者妊孕性・子作りトグル・家計）。 */
function familyTab(): string {
  const pc = pcPerson(state);
  const info = state.pc;

  // --- 個人資産の家計（v0.14）---
  const salary = pcSalary(state), income = spouseIncome(state), living = lifestyleCost(state);
  const net = salary + income - living;
  const budgetHtml = `<div class="sub-bar">
      <span>💰 個人資産 <b>$${fmt(info.wealth)}</b></span>
      <span class="muted">毎月：役員報酬 +$${fmt(salary)}${info.spouseId ? ` / 配偶者インカム +$${fmt(income)}` : ""} / 生活費 −$${fmt(living)} → <b class="${net >= 0 ? "good" : "danger"}">${net >= 0 ? "+" : ""}$${fmt(net)}</b></span>
    </div>`;

  // --- 配偶者・妊娠（両者の妊孕性を表示）＋子作りトグル ---
  let spouseHtml = `<div class="muted">配偶者はいません。下の「結婚市場」から求愛しましょう。</div>`;
  if (info.spouseId) {
    const sp = state.people[info.spouseId];
    if (sp) {
      const pcFert = fertility(pc.age, pc.sex);
      const spFert = fertility(sp.age, sp.sex);
      const preg = state.pregnancy
        ? `<div class="mv new">🤰 妊娠中：あと ${Math.max(0, state.pregnancy.dueTurn - state.turn)} ターンで出産</div>`
        : `<label class="trychild"><input type="checkbox" data-trychild ${state.tryForChild ? "checked" : ""}> 子作りする（ONのターンのみ妊娠判定）</label>`;
      const bothNote = (pcFert <= 0 || spFert <= 0)
        ? `<div class="mv down">どちらかの妊孕性が0のため、現在は子を授かれません（男女双方の妊孕性が必要）。</div>` : "";
      spouseHtml = `<div class="rcard">
        <div class="rc-head"><b>💍 ${sp.name}</b> <span class="muted">${sp.sex === "female" ? "女" : "男"} / ${sp.age.toFixed(1)}歳</span></div>
        <div class="rc-tiers">
          <span>あなたの妊孕性：${(pcFert * 100).toFixed(0)}%（${pc.sex === "female" ? "女" : "男"}・${pc.age.toFixed(0)}歳）</span>
          <span>配偶者の妊孕性：${(spFert * 100).toFixed(0)}%（${sp.sex === "female" ? "女" : "男"}・${sp.age.toFixed(0)}歳）</span>
        </div>
        ${bothNote}
        ${preg}
      </div>`;
    }
  }

  // --- 子の一覧（能力常時可視・後継者指定/自社雇用・現後継者を明示・§10） ---
  const childrenHtml = info.childrenIds.length
    ? info.childrenIds.map((cid) => {
        const c = state.people[cid];
        if (!c) return "";
        const edu = state.childEducation[cid] ?? 0;
        const adult = c.age >= 18;
        const isSucc = info.successorId === cid;
        const employed = state.employeeIds.includes(cid);
        const succBtn = adult
          ? `<button class="mini ${isSucc ? "offer" : ""}" data-designate="${cid}">${isSucc ? "★後継者（解除）" : "後継者に指定"}</button>`
          : `<span class="muted" style="font-size:10px">18歳で後継指定可</span>`;
        const hireBtn = adult && !employed ? `<button class="mini" data-hirefam="${cid}">自社で雇用<br><span class="cost">1AP</span></button>` : (employed ? `<span class="mv up">自社勤務</span>` : "");
        return `<div class="rcard ${isSucc ? "succ-card" : ""}">
          <div class="rc-head"><b>${adult ? "🧑" : "👶"} ${c.name}${isSucc ? " ★後継者" : ""}</b> <span class="muted">${c.sex === "female" ? "女" : "男"} / ${c.age.toFixed(1)}歳</span></div>
          <div class="rc-tiers"><span>CA ${c.CA} / PA ${c.PA}（後継者候補）</span><span>教育Lv ${edu}</span></div>
          <div class="rc-mv">${c.age < 25 ? `<button class="mini offer" data-educate="${cid}">教育<br><span class="cost">1AP/$${fmt(3000)}</span></button>` : ""}${succBtn}${hireBtn}</div>
        </div>`;
      }).join("")
    : `<div class="muted">子はまだいません。</div>`;

  // --- 兄弟姉妹（世代交代後・§10）：動向＋直接雇用 ---
  const siblingsHtml = (info.siblingIds ?? []).map((sid) => {
    const b = state.people[sid];
    if (!b) return "";
    const employed = state.employeeIds.includes(sid);
    const adult = b.age >= 18;
    return `<div class="rcard">
      <div class="rc-head"><b>👨‍👩‍👧 ${b.name}</b> <span class="muted">${b.sex === "female" ? "女" : "男"} / ${b.age.toFixed(1)}歳・${JOB_LABEL[b.jobCategory]}</span></div>
      <div class="rc-tiers"><span>CA ${b.CA} / PA ${b.PA}</span></div>
      <div class="rc-mv">${employed ? `<span class="mv up">自社勤務</span>` : (adult ? `<button class="mini" data-hirefam="${sid}">自社で雇用<br><span class="cost">1AP</span></button>` : `<span class="muted">未成年</span>`)}</div>
    </div>`;
  }).join("");

  // --- 引退（後継者の有無で結果を明示） ---
  const succ = validSuccessor(state);
  const retireHtml = `<div class="sub-bar">
      ${succ
        ? `<span class="mv up">後継者：<b>${succ.name}</b>（第${info.generation + 1}世代へ交代できます）</span>`
        : `<span class="mv down">有効な後継者がいません（引退＝事業終了になります）</span>`}
      <button class="${succ ? "primary" : "mini ghost"}" data-retire>引退する</button>
    </div>`;

  // --- 交際中（lover：結婚市場側）＝求婚導線 ---
  const lover = currentLover(state);
  const loversHtml = lover && !info.spouseId
    ? `<div class="rcard">
        <div class="rc-head"><b>💘 ${lover.name}</b> <span class="muted">${lover.sex === "female" ? "女" : "男"} / ${lover.age.toFixed(1)}歳・交際中</span></div>
        <div class="rc-tiers">${marriageInfoLine(lover)}</div>
        <div class="rc-mv">${lover.scoutLevel < 1 ? `<button class="mini" data-mscout="${lover.id}">身辺調査<br><span class="cost">1AP/$${fmt(2000)}</span></button>` : ""}<button class="mini offer" data-propose="${lover.id}">求婚する<br><span class="cost">3AP / $${fmt(10000)}</span></button></div>
      </div>` : "";

  // --- 結婚市場（fog付き・評判バンド、スカウトで開示）。評判が近い順。 ---
  const eligible = info.spouseId ? [] : eligiblePartners(state)
    .slice()
    .sort((a, b) => {
      const va = marriageView(a), vb = marriageView(b);
      const ca = a.scoutLevel >= 1 ? Math.abs(a.reputation - pc.reputation) : Math.abs((va.repBandLow + va.repBandHigh) / 2 - pc.reputation);
      const cb = b.scoutLevel >= 1 ? Math.abs(b.reputation - pc.reputation) : Math.abs((vb.repBandLow + vb.repBandHigh) / 2 - pc.reputation);
      return ca - cb;
    })
    .slice(0, 24);
  const partnersHtml = eligible.length
    ? `<div class="rgrid">${eligible.map((p) => `<div class="rcard">
        <div class="rc-head"><b>${p.name}</b> <span class="muted">${p.sex === "female" ? "女" : "男"} / ${p.age.toFixed(1)}歳</span></div>
        <div class="rc-tiers">${marriageInfoLine(p)}</div>
        <div class="rc-mv">${p.scoutLevel < 1 ? `<button class="mini" data-mscout="${p.id}">身辺調査<br><span class="cost">1AP/$${fmt(2000)}</span></button>` : ""}<button class="mini offer" data-court="${p.id}">求愛する<br><span class="cost">1AP</span></button></div>
      </div>`).join("")}</div>`
    : (info.spouseId ? "" : `<div class="muted">条件に合う独身の相手がいません。</div>`);

  return `
    <section class="panel">
      <h2>家族<span class="legend">恋愛・結婚は双方の評判の釣り合いが必要。結婚後、男女双方の妊孕性がある間に「子作りON」で子を授かる（§9.3）。</span></h2>
      ${budgetHtml}
      ${spouseHtml}
    </section>
    <section class="panel">
      <h2>子供（後継者候補）<span class="legend">能力は常時可視。18歳以上は後継者に指定・自社で直接雇用（評判ゲート/リクルート不要）。姓はあなたを継ぐ。</span></h2>
      <div class="rgrid">${childrenHtml}</div>
      ${retireHtml}
    </section>
    ${siblingsHtml ? `<section class="panel"><h2>兄弟姉妹<span class="legend">世代交代で一族に。18歳以上は評判ゲート不要で直接雇用できる。</span></h2><div class="rgrid">${siblingsHtml}</div></section>` : ""}
    ${loversHtml ? `<section class="panel"><h2>交際中</h2><div class="rgrid">${loversHtml}</div></section>` : ""}
    ${info.spouseId ? "" : `<section class="panel">
      <h2>結婚市場（独身の候補・評判が近い順）<span class="legend">評判は未調査だと概略のみ。身辺調査で正確な評判・能力(CA/PA)を開示（見合い＝DD）。血族は対象外（§9.3.3）。</span></h2>
      ${partnersHtml}
    </section>`}`;
}

/* ============================================================
 * 技術ツリータブ（v0.20 PhaseA）：基盤技術9→技術87→サービス124の依存と解禁状態
 *   ※ 表示＋可否判定のみ（経済非干渉）。25セクター経済化はPhaseB。
 * ============================================================ */
function techTreeTab(): string {
  const year = gameYear(state);

  // 基盤技術9（根）：波及先(spread)で「どの基盤がどのサービス群を開くか」を直感表示
  const rootsHtml = FOUNDATIONS.map((f) => `<div class="rcard">
      <div class="rc-head"><b>🌱 ${f.name}</b></div>
      <div class="rc-tiers"><span>波及先：${f.spread}</span></div>
      <div class="muted" style="font-size:11px">${f.note}</div>
    </div>`).join("");

  // サービス青写真：フィルタ→状態評価→ページング
  let list = SERVICES.slice();
  if (techSector !== "all") list = list.filter((s) => s.sectorName === techSector);
  if (techStatusFilter !== "all") {
    list = list.filter((s) => serviceStatus(s, year).unlockable === (techStatusFilter === "unlockable"));
  }
  list.sort((a, b) => a.gateYear - b.gateYear || a.no - b.no);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / TECH_PAGE_SIZE));
  const page = Math.min(techPage, pages - 1);
  const view = list.slice(page * TECH_PAGE_SIZE, page * TECH_PAGE_SIZE + TECH_PAGE_SIZE);

  const cards = view.map((s) => serviceCard(s, year)).join("");

  const sectorOpts = [`<option value="all"${techSector === "all" ? " selected" : ""}>全セクター(25)</option>`]
    .concat(SECTORS25.map((sec) => `<option value="${sec.name}"${techSector === sec.name ? " selected" : ""}>${sec.no}. ${sec.name}（${sec.category}）</option>`)).join("");
  const statusOpts = ([["all", "全状態"], ["unlockable", "着手可能のみ"], ["locked", "未解禁のみ"]] as [string, string][])
    .map(([v, l]) => `<option value="${v}"${techStatusFilter === v ? " selected" : ""}>${l}</option>`).join("");

  const unlockableCount = SERVICES.filter((s) => serviceStatus(s, year).unlockable).length;

  return `
    <section class="panel">
      <h2>技術ツリー（${year}年）<span class="legend">Excel v0.4 準拠・25セクター/9基盤/87技術/124サービス。年が進むと技術が解禁され、サービス青写真の着手条件が満たされる（PhaseA＝表示・可否のみ）。</span></h2>
      <div class="sub-bar"><span>現在 <b>${year}年</b></span><span class="muted">着手可能サービス <b>${unlockableCount}</b> / ${SERVICES.length}（年進行で増加）</span></div>
    </section>
    <section class="panel">
      <h2>基盤技術（9・ツリーの根）<span class="legend">各基盤が波及して多数のサービスを開く。半導体・電池・通信・クラウド・AI 等。</span></h2>
      <div class="rgrid">${rootsHtml}</div>
    </section>
    <section class="panel">
      <h2>サービス青写真（124）<span class="legend">前提技術が全て解禁 かつ 解禁年に到達で「着手可能」。4専門(eng/des/res/mgt)コストは開発投入目標。</span></h2>
      <div class="recruit-ctl">
        <label>セクター <select data-techsector>${sectorOpts}</select></label>
        <label>状態 <select data-techstatus>${statusOpts}</select></label>
        <div class="pager">
          <button class="mini" data-techpage="prev" ${page <= 0 ? "disabled" : ""}>‹ 前</button>
          <span class="muted">${total ? page * TECH_PAGE_SIZE + 1 : 0}–${Math.min(total, (page + 1) * TECH_PAGE_SIZE)} / 全${total}（${page + 1}/${pages}）</span>
          <button class="mini" data-techpage="next" ${page >= pages - 1 ? "disabled" : ""}>次 ›</button>
        </div>
      </div>
      <div class="rgrid">${cards || `<div class="muted">条件に合うサービスがありません。</div>`}</div>
    </section>`;
}

/** サービス青写真1枚のカード（解禁状態＋前提技術＋4専門コスト）。 */
function serviceCard(s: Service, year: number): string {
  const st = serviceStatus(s, year);
  const badge = st.unlockable
    ? `<span class="mv up">✅ 着手可能</span>`
    : !st.yearReached
      ? `<span class="mv aggr">⏳ ${s.gateYear}年解禁（あと${s.gateYear - year}年）</span>`
      : `<span class="mv down">🔒 前提技術 ${st.missingTechs.length}件 不足</span>`;
  const prereqs = prereqTechsOf(s).map((t) => {
    const ok = techAvailable(t, year);
    return `<span class="${ok ? "mv up" : "blur"}" style="font-size:10px">${t.name}${ok ? "" : `(${t.year})`}</span>`;
  }).join(" ");
  const prof = sectorProfile(s.sectorName);
  return `<div class="rcard ${st.unlockable ? "succ-card" : ""}">
    <div class="rc-head"><b>${s.service.length > 22 ? s.service.slice(0, 22) + "…" : s.service}</b></div>
    <div class="rc-tiers">
      <span class="muted">${s.sectorName}${prof ? `（${prof.tendency.slice(0, 10)}）` : ""}</span>
      ${badge}
    </div>
    <div class="rc-tiers"><span style="font-size:10px">前提技術：${prereqs || "なし"}</span></div>
    <div class="rc-tiers"><span style="font-size:10px">コスト eng${s.cost.eng}/des${s.cost.des}/res${s.cost.res}/mgt${s.cost.mgt}（計${s.cost.total}）</span></div>
  </div>`;
}

/* ============================================================
 * 株式タブ（v0.19）：自社キャップテーブル＋増資／他社株ポートフォリオ・売買
 * ============================================================ */
function stockTab(): string {
  const c = state.company;
  const val = companyValuation(state);
  const ratio = pcShareRatio(c);
  const founderEq = founderEquityValue(state);
  const ct = c.capTable;
  const holdersRows = ct.holders.length
    ? ct.holders.map((h) => `<tr><td>${h.name}</td><td>${h.kind === "vc" ? "投資家" : h.kind === "employee" ? "社員" : "他社"}</td><td class="num">${(h.shares / ct.totalShares * 100).toFixed(1)}%</td></tr>`).join("")
    : "";
  const majorityWarn = ratio < 0.5 ? `<div class="mv down">⚠ 持株比率が過半数割れ（${(ratio * 100).toFixed(1)}%）。経営権に注意。</div>` : "";
  const capPanel = `<section class="panel">
    <h2>自社キャップテーブル<span class="legend">評価額は財務指標から毎ターン算出（年換算売上×4＋CASH＋THxP＋評判）。増資でCASH調達＝持株希薄化。</span></h2>
    <div class="kpis">
      <div class="kpi"><div class="k">会社評価額</div><div class="v">$${fmt(val)}</div></div>
      <div class="kpi"><div class="k">PC持株比率</div><div class="v ${ratio < 0.5 ? "danger" : ""}">${(ratio * 100).toFixed(1)}<small class="sub2">%</small></div></div>
      <div class="kpi"><div class="k">創業者持分価値</div><div class="v">$${fmt(founderEq)}</div></div>
      <div class="kpi"><div class="k">総発行株式</div><div class="v" style="font-size:14px">${fmt(ct.totalShares)}</div></div>
    </div>
    ${majorityWarn}
    ${holdersRows ? `<table><thead><tr><th>株主</th><th>種別</th><th>比率</th></tr></thead><tbody><tr><td>あなた（創業者）</td><td>PC</td><td class="num">${(ratio * 100).toFixed(1)}%</td></tr>${holdersRows}</tbody></table>` : `<div class="muted">株主はあなた（創業者）のみ（100%）。</div>`}
    <div class="recruit-ctl">
      <span class="muted">増資（新株発行で資金調達）：</span>
      ${[50000, 100000, 250000].map((a) => `<button class="mini" data-raise="${a}">$${fmt(a)} 調達<br><span class="cost">1AP・希薄化</span></button>`).join("")}
    </div>
  </section>`;

  // --- ポートフォリオ（保有他社株） ---
  const heldIds = Object.keys(state.stockHoldings);
  const portRows = heldIds.map((id) => {
    const h = state.stockHoldings[id];
    const r = findRival(state, id);
    const mv = holdingMarketValue(state, id);
    const ur = holdingUnrealized(state, id);
    const name = r ? r.name : "（上場廃止）";
    return `<tr>
      <td>${name}</td><td class="num">${fmt(h.shares)}</td>
      <td class="num">$${fmt(h.costBasis)}</td><td class="num">$${fmt(mv)}</td>
      <td class="num ${ur >= 0 ? "good" : "danger"}">${ur >= 0 ? "+" : ""}$${fmt(ur)}</td>
      <td class="acts"><button class="mini" data-sellstock="${id}:${h.shares}">全売却<br><span class="cost">1AP</span></button></td>
    </tr>`;
  }).join("");
  const portPanel = `<section class="panel">
    <h2>他社株ポートフォリオ<span class="legend">個人資産で売買（会社CASHには非干渉）。価値は各社の成長/衰退に連動。売却益に譲渡益税（${(capitalGainsRate(state) * 100).toFixed(1)}%）。</span></h2>
    <div class="sub-bar"><span>💰 個人資産 <b>$${fmt(state.pc.wealth)}</b></span><span class="muted">保有株 時価総額 <b>$${fmt(portfolioValue(state))}</b></span></div>
    ${heldIds.length ? `<table><thead><tr><th>会社</th><th>株数</th><th>取得原価</th><th>時価</th><th>含み損益</th><th>操作</th></tr></thead><tbody>${portRows}</tbody></table>` : `<div class="muted">保有中の他社株はありません。下の一覧から投資できます。</div>`}
  </section>`;

  // --- 売買可能なライバル（分析済み/参入済み市場のみ・フォグ整合） ---
  const tradeable: { id: string; name: string; price: number; val: number; market: string }[] = [];
  for (const m of Object.values(state.markets)) {
    for (const r of m.nearRivals) {
      if (isRivalTradeable(state, r.id)) tradeable.push({ id: r.id, name: r.name, price: rivalSharePrice(r), val: rivalValuation(r), market: `${SECTOR_NAME[m.sector]}×${m.country}` });
    }
  }
  tradeable.sort((a, b) => b.val - a.val);
  const buyRows = tradeable.slice(0, 30).map((t) => `<tr>
    <td>${t.name} <span class="muted">${t.market}</span></td>
    <td class="num">$${fmt(t.val)}</td><td class="num">$${t.price.toFixed(1)}</td>
    <td class="acts"><button class="mini" data-buystock="${t.id}:100">100株<br><span class="cost">1AP</span></button><button class="mini" data-buystock="${t.id}:500">500株<br><span class="cost">1AP</span></button></td>
  </tr>`).join("");
  const buyPanel = `<section class="panel">
    <h2>他社株マーケット<span class="legend">分析済み/参入済み市場のライバルのみ売買可（業績を評価できる＝DD済み）。未分析市場は他企業タブで分析すると開示。</span></h2>
    ${tradeable.length ? `<table><thead><tr><th>会社（市場）</th><th>時価総額</th><th>株価</th><th>購入</th></tr></thead><tbody>${buyRows}</tbody></table>` : `<div class="muted">売買可能なライバルがいません。市場を分析するか製品を投入すると開示されます。</div>`}
  </section>`;

  return capPanel + portPanel + buyPanel;
}

/* ============================================================
 * 他企業（ライバル）タブ（v0.12）：各社カード＋動きログ。フォグ整合。
 * ============================================================ */
const SCALE_LABEL = ["零細", "小規模", "中堅", "大手", "最大手"];
const REP_LABEL = ["無名", "新興", "中堅", "有名", "著名"];
const FOCUS_LABEL: Record<RivalView["ambitionFocus"], string> = {
  share: "攻勢型（シェア重視）", tech: "技術志向", expand: "拡大志向",
};

/** 動きバッジ（前ターン差分）。 */
function movementBadges(m: RivalView["movement"]): string {
  const b: string[] = [];
  if (m.isNew) b.push(`<span class="mv new">🆕新規参入</span>`);
  if (m.scaleUp) b.push(`<span class="mv up">📈規模拡大</span>`);
  if (m.shareUp) b.push(`<span class="mv up">🔺シェア拡大</span>`);
  if (m.shareDown) b.push(`<span class="mv down">🔻シェア縮小</span>`);
  if (m.aggressive) b.push(`<span class="mv aggr">⚔攻勢的</span>`);
  return b.join("");
}

/** 1社カード。 */
function rivalCard(r: RivalView): string {
  const cl = clamp0(r.scaleTier);
  return `<div class="rcard">
    <div class="rc-head"><b>${r.name}</b> <span class="muted">${r.marketLabel}</span></div>
    <div class="rc-share"><span class="rc-pct">${(r.estShare * 100).toFixed(0)}%</span> <span class="muted">推定シェア</span></div>
    <div class="rc-tiers">
      <span title="規模">🏭 ${SCALE_LABEL[cl]}</span>
      <span title="評判">⭐ ${REP_LABEL[clamp0(r.reputationTier)]}</span>
      <span title="志向">🎯 ${FOCUS_LABEL[r.ambitionFocus]}</span>
    </div>
    <div class="rc-mv">${movementBadges(r.movement) || `<span class="muted">動きなし</span>`}</div>
  </div>`;
}
function clamp0(n: number): number { return Math.max(0, Math.min(4, Math.round(n))); }

/** 他企業タブ本体。 */
function rivalsTab(): string {
  const { cards, hiddenMarkets, visibleMarkets } = aggregateRivals(state);
  const grid = cards.length
    ? `<div class="rgrid">${cards.map(rivalCard).join("")}</div>`
    : `<div class="muted">可視な市場にライバルがいません。市場を分析するか製品を投入すると各社が見えます。</div>`;
  const fog = hiddenMarkets > 0
    ? `<div class="rfog">🔒 他 ${hiddenMarkets} 市場は未分析／未参入のため各社の詳細は不明です。市場分析タブで分析すると開示されます。</div>`
    : "";
  const news = state.rivalNews.length
    ? state.rivalNews.slice(-16).reverse().map((n) => `<div class="line">${n}</div>`).join("")
    : `<div class="muted">まだ目立った動きはありません。</div>`;
  return `
    <section class="panel">
      <h2>他企業（ライバル各社）<span class="legend">分析済み／参入済み市場の各社を追跡。★フォグと同様、未分析市場は非開示。推定シェアは各社間の相対競争力の目安。</span></h2>
      <div class="muted" style="margin-bottom:8px">開示中 ${visibleMarkets} 市場 / ${cards.length} 社${hiddenMarkets ? `（未分析 ${hiddenMarkets} 市場は非開示）` : ""}</div>
      ${grid}
      ${fog}
    </section>
    <section class="panel">
      <h2>各社の動き（動向ログ）<span class="legend">ターン差分から自動生成：参入・規模拡大・シェア変動</span></h2>
      <div class="loglines">${news}</div>
    </section>`;
}

/** 分析ページ（市場グリッド＋動的市場の見通し）。 */
function analysisPanel(): string {
  const skill = analysisSkill(employees(state));
  const rows = Object.values(state.markets)
    .filter((m) => marketSizeOf({ sector: m.sector, country: m.country, biasFactor: m.biasFactor }, state.era) > 0)
    .sort((a, b) => (SECTORS.indexOf(a.sector) - SECTORS.indexOf(b.sector)) || (PLAYABLE.indexOf(a.country) - PLAYABLE.indexOf(b.country)))
    .map(marketRow).join("");
  return `<section class="panel">
    <h2>市場分析ページ（セクター×国・動的市場）
      <span class="legend">未分析＝霧＝博打。分析で成熟度・実効パイ・成長・参入圧・戦略ラベルを開示。分析スキル(research) <b>${skill.toFixed(1)}</b></span></h2>
    <div class="muted" style="margin-bottom:6px">🌱=今は小さいが伸びる（先取り推奨）／⏳=もうすぐ混む（地固め急げ）／🏔️=大きいが激戦（特化向き）／💤=伸びない罠。⚡=ホット市場で分析がすぐ古びる。規模Mは実効パイ（M_eff）。</div>
    <table>
      <thead><tr><th>セクター</th><th>国</th><th>分析</th><th>成熟度</th><th>実効パイ</th><th>競合密度</th><th>成長</th><th>自社fit</th><th>機会</th><th>戦略</th><th>分析実行</th><th>製品投入</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

/** 実績一覧パネル。 */
function achievementsPanel(): string {
  const done = state.achievements.length;
  const items = ACHIEVEMENTS.map((a) => {
    const got = state.achievements.includes(a.id);
    return `<div class="ach ${got ? "got" : ""}"><span class="ach-i">${got ? "🏆" : "🔒"}</span>
      <span class="ach-t"><b>${a.label}</b><small>${a.desc}</small></span></div>`;
  }).join("");
  return `<section class="panel">
    <h2>実績（自己目標）<span class="legend">${done}/${ACHIEVEMENTS.length} 達成 ── サンドボックス：勝利条件はなく自己目標を追う</span></h2>
    <div class="ach-grid">${items}</div>
  </section>`;
}

/** ゲームオーバー・オーバーレイ。 */
function gameOverOverlay(): string {
  if (!state.gameOver) return "";
  const c = state.company;
  const gotAch = state.achievements.map((id) => getAchievement(id)?.label).filter(Boolean);
  return `<div class="modal-bg">
    <div class="modal over">
      <h2>ゲームオーバー — 資金ショート</h2>
      <p class="muted">ターン ${state.endTurn} で会社の資金が尽きました（サンドボックス：勝敗なし）。</p>
      <div class="over-stats">
        <div>到達ターン <b>${state.endTurn}</b></div>
        <div>製品数 <b>${state.products.length}</b> / 最高QUAL_p <b>${Math.max(0, ...state.products.map((p) => p.QUAL_p)).toFixed(0)}</b></div>
        <div>解放青写真 <b>${c.unlockedBlueprints.length}/${BLUEPRINTS.length}</b></div>
        <div>獲得実績 <b>${gotAch.length}/${ACHIEVEMENTS.length}</b></div>
      </div>
      <div class="over-ach">${gotAch.length ? "🏆 " + gotAch.join(" / ") : "（実績なし）"}</div>
      <button id="newgameOver">新規開始</button>
    </div>
  </div>`;
}

/** 新規開始：業態（archetype）選択モーダル（v0.8）。初心者は労働集約がデフォルト。 */
function archetypeModal(): string {
  if (!choosingArchetype) return "";
  return `<div class="modal-bg">
    <div class="modal">
      <div class="modal-head"><h3>どの業態で起業しますか？</h3></div>
      <p class="muted">はじめてなら「労働集約」がおすすめ。人を集めて回すほど売上が立ちます。</p>
      <div class="arch-choices">
        <button class="arch-card" data-arch="labor">
          <div class="arch-title">🏭 受託フルフィルメント</div>
          <div class="arch-sub"><b>労働集約・初心者向け（推奨）</b></div>
          <div class="arch-desc">安い未熟練の作業員を大勢（8名〜）雇い、頭数×コツコツ力で「さばける量」を売る。人を増やすほど売上が伸びる。品質の天井は低いが、序盤から黒字化しやすく安定。</div>
        </button>
        <button class="arch-card" data-arch="knowledge">
          <div class="arch-title">💻 ソフトウェア / EC</div>
          <div class="arch-sub"><b>知識集約・上級者向け</b></div>
          <div class="arch-desc">少数精鋭のエースで高品質プロダクトを磨く。育成・研究・特化で品質100・市場独占も狙えるが、軌道に乗せるのが難しい。</div>
        </button>
      </div>
    </div>
  </div>`;
}

/* ============================================================
 * FM風 トップバー（グローバルHUD）＋タブバー
 * ============================================================ */

/** 常時表示のトップバー（重要指標＋進行/セーブ操作は全タブで固定）。 */
function topBar(): string {
  const c = state.company;
  const runwayWarn = isFinite(c.runwayTurns) && c.runwayTurns <= 6 ? "danger" : "";
  const apCap = effectiveApMax(state);
  const apDots = "●".repeat(Math.max(0, state.ap)) + "○".repeat(Math.max(0, apCap - state.ap))
    + (pcWorking(state) ? ` <span class="muted" title="社長が実務中でAP上限−${state.apMax - apCap}">🛠${apCap}</span>` : "");
  return `<div class="topbar">
    <div class="tb-brand">
      <div class="tb-co">${c.name}</div>
      <div class="tb-sub">${COUNTRY_LABEL[c.foundedCountry]} / <b>${gameYear(state)}年</b> / ${ERA_LABEL[state.era]} / T${state.turn}</div>
    </div>
    <div class="tb-stats">
      <div class="tb-stat"><span class="k">CASH</span><span class="v">$${fmt(c.CASH)}</span></div>
      <div class="tb-stat ${runwayWarn}"><span class="k">ランウェイ</span><span class="v">${runwayText(c.runwayTurns)}</span></div>
      <div class="tb-stat"><span class="k">バーン</span><span class="v">$${fmt(c.monthlyBurn)}</span></div>
      <div class="tb-stat"><span class="k">AP</span><span class="v ap-dots">${apDots}</span></div>
      <div class="tb-stat"><span class="k">評判</span><span class="v">${c.reputation.toFixed(0)}</span></div>
      <div class="tb-stat"><span class="k">THxP</span><span class="v thxp">${c.THxP_customer.toFixed(0)}</span></div>
    </div>
    <div class="tb-actions">
      <button id="nextTurn" class="primary" ${state.gameOver ? "disabled" : ""}>▶ 次のターン</button>
      <button id="next6" class="secondary" ${state.gameOver ? "disabled" : ""}>▶▶6</button>
      <button id="save" class="ghost" title="セーブ">💾</button>
      <button id="load" class="ghost" ${storage.has() ? "" : "disabled"} title="ロード">📂</button>
      <button id="newgame" class="ghost" title="新規開始">🆕</button>
    </div>
  </div>
  <div class="tabbar">
    ${TABS.map((t) => `<button class="tab ${activeTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}${tabBadge(t.id)}</button>`).join("")}
    <span class="toast">${toast}</span>
  </div>`;
}

/** タブに危機バッジ（赤丸）を付ける（FM流の「ここに注意」）。 */
function tabBadge(id: TabId): string {
  if (id === "overview") {
    const danger = isFinite(state.company.runwayTurns) && state.company.runwayTurns <= 6;
    return danger ? ` <span class="badge">!</span>` : "";
  }
  if (id === "talent" && state.ap > 0 && state.employeeIds.some((eid) => !state.assignments[eid])) {
    return ` <span class="badge dot"></span>`; // 未配属社員あり
  }
  return "";
}

/* ============================================================
 * タブ内容パネル
 * ============================================================ */

/** 在籍社員テーブル（役割＋製品配属セレクト）。 */
function rosterPanel(): string {
  const emps = employees(state);
  return `<section class="panel">
    <h2>在籍社員（${emps.length}名）<span class="legend"><i class="ca"></i>CA <i class="pa"></i>PA　役割＝能力の種類 / 製品配属＝どの製品のQUAL_pに効くか　氏名クリックで詳細</span></h2>
    <table>
      <thead><tr><th>氏名</th><th>職種</th><th>年齢</th><th>国籍</th><th>CA</th><th>PA</th><th>月給</th><th>役割</th><th>製品配属</th></tr></thead>
      <tbody>${emps.map(employeeRow).join("")}</tbody>
    </table>
  </section>`;
}

/** 採用市場（v0.10：約500人の単一DBを国別タブ＋スカウトサブスクで捌く）。 */
function recruitPanel(): string {
  const skill = companyScoutSkill(state);
  const home = state.company.foundedCountry;
  const sel = recruitCountry ?? home;
  const subscribed = state.scoutSubscriptions.includes(sel);
  const selIsHome = sel === home;

  // 国別タブ（加入状況バッジ付き）。件数は加入国のみ開示（未加入は「不明」）。
  const tabs = PLAYABLE.map((c) => {
    const on = state.scoutSubscriptions.includes(c);
    const active = c === sel ? "active" : "";
    const badge = c === home ? `<span class="sub-on">本拠地</span>`
      : on ? `<span class="sub-on">加入中</span>` : `<span class="sub-off">未加入</span>`;
    return `<button class="ctab ${active}" data-rctry="${c}">${COUNTRY_LABEL[c]} ${badge}</button>`;
  }).join("");

  let body: string;
  if (!subscribed) {
    // 未加入国：★も素性も一切出さない（完全フォグ）。加入導線のみ。
    body = `<div class="sub-locked">
      <div class="lock-ic">🔒</div>
      <div><b>${COUNTRY_LABEL[sel]}の人材は未加入のため不明です。</b>
        <div class="muted">スカウトサブスクに加入すると、この国の候補者の★（技能概要）が見え、個別スカウトで深掘りできます。</div></div>
      <button class="primary" data-sub="${sel}">加入して開示（月額$${fmt(SCOUT_SUB_COST[sel])} / ${1}AP）</button>
    </div>`;
  } else {
    // 加入国：その国の“全候補”を職種フィルタ→並べ替え→ページングで表示（v0.11）。
    let list = poolPeople(state).filter((p) => p.nationality === sel);
    if (recruitJob !== "all") list = list.filter((p) => p.jobCategory === recruitJob);
    const total = list.length;
    list = sortCandidates(list, recruitSort);
    const pages = Math.max(1, Math.ceil(total / RECRUIT_PAGE_SIZE));
    const page = Math.min(recruitPage, pages - 1);
    const view = list.slice(page * RECRUIT_PAGE_SIZE, page * RECRUIT_PAGE_SIZE + RECRUIT_PAGE_SIZE);
    const rows = view.length
      ? view.map((p) => candidateRow(p, viewOf(p))).join("")
      : `<tr><td colspan="10" class="muted">条件に合う候補がいません。</td></tr>`;

    const subInfo = selIsHome
      ? `<span class="sub-on">本拠地</span> 無料（地元の採用網）`
      : `<span class="sub-on">加入中</span> 月額$${fmt(SCOUT_SUB_COST[sel])}／月 <button class="mini ghost" data-unsub="${sel}">解約</button>`;
    const jobOpts = [`<option value="all"${recruitJob === "all" ? " selected" : ""}>全職種</option>`]
      .concat(JOBS.map((j) => `<option value="${j}"${recruitJob === j ? " selected" : ""}>${JOB_LABEL[j]}</option>`)).join("");
    const sortOpts = ([["stars", "技能★（高い順）"], ["salaryAsc", "要求給与（安い順）"], ["ageAsc", "年齢（若い順）"], ["caDesc", "CA（高い順・スカウト済）"]] as [RecruitSort, string][])
      .map(([v, l]) => `<option value="${v}"${recruitSort === v ? " selected" : ""}>${l}</option>`).join("");
    const pager = `<div class="pager">
        <button class="mini" data-rpage="prev" ${page <= 0 ? "disabled" : ""}>‹ 前</button>
        <span class="muted">${total ? page * RECRUIT_PAGE_SIZE + 1 : 0}–${Math.min(total, (page + 1) * RECRUIT_PAGE_SIZE)} / 全${total}名（${page + 1}/${pages}）</span>
        <button class="mini" data-rpage="next" ${page >= pages - 1 ? "disabled" : ""}>次 ›</button>
      </div>`;

    body = `<div class="sub-bar">${subInfo}</div>
      <div class="recruit-ctl">
        <label>職種 <select data-rjob>${jobOpts}</select></label>
        <label>並べ替え <select data-rsort>${sortOpts}</select></label>
        ${pager}
      </div>
      <table>
        <thead><tr><th>氏名</th><th>職種</th><th>年齢</th><th>国籍</th><th>技能</th><th>CA</th><th>PA</th><th>忠誠</th><th>要求給与</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const pendingBar = state.pendingHires.length
    ? `<div class="pending-bar">交渉中のオファー ${state.pendingHires.length}/${MAX_PENDING_OFFERS}：${
        state.pendingHires.map((o) => `${state.people[o.personId]?.name ?? "?"}（残${o.remaining}T）`).join(" / ")
      }</div>`
    : "";

  return `<section class="panel">
    <h2>採用市場（ワールドDB ${state.poolIds.length}名・分析スキル ${skill.toFixed(1)}）
      <span class="legend">国別サブスク＝可視性ゲート。採用は「オファー」を出し3ターン後に返答（無名企業は上位人材に辞退されがち）。</span></h2>
    <div class="ctabs">${tabs}</div>
    ${pendingBar}
    ${body}
  </section>`;
}

/** 候補一覧の並べ替え（★／要求給与昇順／年齢昇順／CA降順〈スカウト済のみ上位〉）。 */
function sortCandidates<T extends { id: string; salaryDemand: number; age: number }>(list: T[], sort: RecruitSort): T[] {
  const arr = [...list];
  switch (sort) {
    case "salaryAsc": return arr.sort((a, b) => a.salaryDemand - b.salaryDemand);
    case "ageAsc": return arr.sort((a, b) => a.age - b.age);
    case "caDesc": return arr.sort((a, b) => (viewOf(b as any).caKnown ?? -1) - (viewOf(a as any).caKnown ?? -1));
    case "stars":
    default: return arr.sort((a, b) => occStarsOf(b as any) - occStarsOf(a as any));
  }
}

/** 可視性を織り込んだ★（未加入国は0＝非表示）。 */
function occStarsOf(p: Parameters<typeof scoutedView>[0]): number {
  return viewOf(p).occStars;
}

/** ログパネル（概要タブ等で使用）。 */
function logPanel(): string {
  return `<section class="panel log">
    <h2>ログ</h2>
    <div class="loglines">${state.log.slice(-14).reverse().map((l) => `<div class="line">${l}</div>`).join("")}</div>
  </section>`;
}

/** ① 概要タブ：KPIサマリ・警告・実績抜粋・ログ。 */
function overviewTab(): string {
  const c = state.company;
  const runwayWarn = isFinite(c.runwayTurns) && c.runwayTurns <= 6 ? "warn" : "";
  const totalShare = state.products.reduce((s, p) => s + p.sticky + p.paid, 0);
  const bestQual = state.products.length ? Math.max(...state.products.map((p) => p.QUAL_p)) : 0;
  // 警告収集
  const warnings: string[] = [];
  if (runwayWarn) warnings.push(`🔴 ランウェイ ${runwayText(c.runwayTurns)}：資金ショート接近。売上を上げるか支出を絞る。`);
  for (const p of state.products) if (p.QUAL_p < 40 && p.adBudget > 0) warnings.push(`🟠 ${SECTOR_NAME[p.sector]}×${COUNTRY_LABEL[p.country]}：低QUAL_pへの広告が逆噴射中。`);
  if (state.ap > 0) warnings.push(`🔵 AP ${state.ap} 残：スカウト・分析・製品投入に使えます。`);
  const gotAch = state.achievements.slice(-4).map((id) => getAchievement(id)?.label).filter(Boolean);

  return `
    <section class="kpis">
      <div class="kpi"><div class="k">ターン</div><div class="v">${state.turn}</div></div>
      <div class="kpi"><div class="k">業態</div><div class="v" style="font-size:15px">${state.archetype === "labor" ? "🏭 労働集約" : "💻 知識集約"}</div></div>
      <div class="kpi"><div class="k">CASH</div><div class="v">$${fmt(c.CASH)}</div></div>
      <div class="kpi ${runwayWarn}"><div class="k">ランウェイ</div><div class="v">${runwayText(c.runwayTurns)}</div></div>
      <div class="kpi"><div class="k">月次バーン</div><div class="v">$${fmt(c.monthlyBurn)}</div></div>
      <div class="kpi"><div class="k">製品数</div><div class="v">${state.products.length}</div></div>
      <div class="kpi"><div class="k">総シェア</div><div class="v">${totalShare.toFixed(0)}<small class="sub2">%</small></div></div>
      <div class="kpi"><div class="k">最高QUAL_p</div><div class="v">${bestQual.toFixed(0)}</div></div>
      <div class="kpi"><div class="k">RP_C</div><div class="v">${Math.floor(c.RP_C)}</div></div>
      <div class="kpi"><div class="k">顧客THxP</div><div class="v thxp">${c.THxP_customer.toFixed(0)}</div></div>
      <div class="kpi"><div class="k">評判</div><div class="v">${c.reputation.toFixed(0)}</div></div>
      <div class="kpi"><div class="k">連続黒字</div><div class="v">${state.profitStreak}</div></div>
      <div class="kpi"><div class="k">実績</div><div class="v">${state.achievements.length}/${ACHIEVEMENTS.length}</div></div>
    </section>
    <section class="panel">
      <h2>アラート <span class="legend">「今なにをすべきか」</span></h2>
      <div class="alerts">${warnings.length ? warnings.map((w) => `<div class="alert">${w}</div>`).join("") : `<div class="muted">重大な警告はありません。分析→市場選択→製品投入を進めましょう。</div>`}</div>
      ${gotAch.length ? `<div class="muted" style="margin-top:8px">最近の実績：🏆 ${gotAch.join(" / ")}</div>` : ""}
    </section>
    ${logPanel()}`;
}

/** ⑥ 財務・組織タブ：収支内訳＋全製品マーケ予算＋研究予算＋配属サマリ。 */
function financeTab(): string {
  const c = state.company;
  const salaries = employees(state).reduce((s, e) => s + (e.contract?.salary ?? 0), 0);
  const marketBudgets = state.products.reduce((s, p) => s + p.adBudget + p.prBudget + p.commBudget, 0);
  const revenue = state.products.reduce((s, p) => {
    const m = state.markets[p.marketId];
    return s + (m ? productRevenue(p, m, state.era) : 0);
  }, 0);
  const fixed = c.monthlyBurn - salaries - c.researchBudget - marketBudgets;
  const net = revenue - c.monthlyBurn;
  const revRows = state.products.map((p) => {
    const m = state.markets[p.marketId];
    const rev = m ? productRevenue(p, m, state.era) : 0;
    return `<tr><td>${SECTOR_NAME[p.sector]}×${COUNTRY_LABEL[p.country]}</td><td class="num">${(p.sticky + p.paid).toFixed(1)}%</td><td class="num good">+$${fmt(rev)}</td></tr>`;
  }).join("");
  // 全製品のマーケ予算を一覧で±
  const budgetRows = state.products.map((p) => `
    <tr>
      <td>${SECTOR_NAME[p.sector]}×${COUNTRY_LABEL[p.country]}</td>
      ${(["adBudget", "prBudget", "commBudget"] as MarketChannel[]).map((ch) => `
        <td class="num">$${fmt(p[ch])}
          <button class="mini xs" data-mbudget="${p.id}:${ch}:-1">−</button>
          <button class="mini xs" data-mbudget="${p.id}:${ch}:1">＋</button></td>`).join("")}
    </tr>`).join("");
  return `
    <section class="panel">
      <h2>収支内訳（月次）<span class="legend">売上＝Σ製品売上 − バーン＝Σ給与＋固定費＋研究＋マーケ</span></h2>
      <div class="fin-grid">
        <div class="fin-col">
          <h4>売上（製品別）</h4>
          <table><tbody>${revRows || `<tr><td class="muted">製品なし</td></tr>`}
            <tr class="fin-total"><td>売上合計</td><td></td><td class="num good">+$${fmt(revenue)}</td></tr></tbody></table>
        </div>
        <div class="fin-col">
          <h4>支出内訳</h4>
          <table><tbody>
            <tr><td>給与合計</td><td class="num">−$${fmt(salaries)}</td></tr>
            <tr><td>固定費</td><td class="num">−$${fmt(fixed)}</td></tr>
            <tr><td>研究投資 <button class="mini xs" data-rbudget="-1">−</button><button class="mini xs" data-rbudget="1">＋</button></td><td class="num">−$${fmt(c.researchBudget)}</td></tr>
            <tr><td>マーケ予算合計</td><td class="num">−$${fmt(marketBudgets)}</td></tr>
            <tr class="fin-total"><td>バーン合計</td><td class="num">−$${fmt(c.monthlyBurn)}</td></tr>
            <tr class="fin-total ${net >= 0 ? "good" : "danger"}"><td>純損益</td><td class="num">${net >= 0 ? "+" : "−"}$${fmt(Math.abs(net))}</td></tr>
          </tbody></table>
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>製品別マーケ予算（広告 / PR / コミュニティ）<span class="legend">毎ターンのバーンに加算。チャネルの使い分け＝戦略</span></h2>
      <table>
        <thead><tr><th>製品（市場）</th><th>📣広告(paid)</th><th>🗣PR(sticky)</th><th>🌱コミュニティ(THxP)</th></tr></thead>
        <tbody>${budgetRows || `<tr><td class="muted">製品なし</td></tr>`}</tbody>
      </table>
    </section>
    ${rosterPanel()}`;
}

/** アクティブタブの内容HTMLを返す。 */
function tabContent(): string {
  switch (activeTab) {
    case "overview": return overviewTab();
    case "talent": return recruitPanel() + rosterPanel();
    case "market": return analysisPanel();
    case "rivals": return rivalsTab();
    case "products": return productsPanel() + logPanel();
    case "research": return blueprintPanel();
    case "techtree": return techTreeTab();
    case "finance": return financeTab();
    case "stock": return stockTab();
    case "career": return careerTab();
    case "family": return familyTab();
    case "achievements": return achievementsPanel();
    default: return overviewTab();
  }
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    ${topBar()}
    <main class="tabview">${tabContent()}</main>
    ${detailModal()}
    ${gameOverOverlay()}
    ${archetypeModal()}
  `;

  // --- タブ切替（アクティブタブはUI状態として保持）---
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => { activeTab = b.dataset.tab as TabId; render(); })
  );

  // --- グローバルボタン ---
  document.getElementById("nextTurn")?.addEventListener("click", () => {
    state = advanceTurn(state).next; toast = ""; render();
  });
  document.getElementById("next6")?.addEventListener("click", () => {
    for (let i = 0; i < 6; i++) state = advanceTurn(state).next; toast = ""; render();
  });

  // --- セーブ / ロード / 新規開始 ---
  // 新規開始はまず業態選択モーダルを開く（v0.8）。選択後に initGame。
  const newGame = () => { choosingArchetype = true; render(); };
  const startWith = (archetype: "labor" | "knowledge") => {
    state = initGame({ seed: freshSeed(), country: "US", archetype });
    choosingArchetype = false;
    toast = archetype === "labor" ? "労働集約で新規開始しました。" : "知識集約で新規開始しました。";
    selectedPersonId = null; recruitCountry = null; recruitPage = 0; recruitJob = "all"; recruitSort = "stars"; activeTab = "overview"; render();
  };
  app.querySelectorAll<HTMLElement>("[data-arch]").forEach((el) =>
    el.addEventListener("click", () => startWith(el.dataset.arch as "labor" | "knowledge"))
  );
  document.getElementById("save")?.addEventListener("click", () => {
    toast = storage.save(state) ? "セーブしました。" : "セーブに失敗しました。"; render();
  });
  document.getElementById("load")?.addEventListener("click", () => {
    const loaded = storage.load();
    if (loaded) { state = loaded; toast = "ロードしました。"; selectedPersonId = null; } else { toast = "セーブが見つかりません。"; }
    render();
  });
  document.getElementById("newgame")?.addEventListener("click", newGame);
  document.getElementById("newgameOver")?.addEventListener("click", newGame);

  // --- 人材詳細モーダル：氏名クリックで開く／背景・✕で閉じる ---
  app.querySelectorAll<HTMLElement>("[data-person]").forEach((el) =>
    el.addEventListener("click", () => { selectedPersonId = el.dataset.person!; render(); })
  );
  app.querySelectorAll<HTMLElement>("[data-close]").forEach((el) =>
    el.addEventListener("click", (e) => { if (e.target === el) { selectedPersonId = null; render(); } })
  );

  // --- 表内の動的ボタン（イベント委譲）---
  app.querySelectorAll<HTMLButtonElement>("[data-scout]").forEach((b) =>
    b.addEventListener("click", () => apply(scoutCandidate(state, b.dataset.scout!)))
  );
  // 採用オファー（v0.11・3ターン後に受諾判定）
  app.querySelectorAll<HTMLButtonElement>("[data-offer]").forEach((b) =>
    b.addEventListener("click", () => apply(makeOffer(state, b.dataset.offer!)))
  );
  // 家族（v0.13）：求愛・求婚・教育
  app.querySelectorAll<HTMLButtonElement>("[data-court]").forEach((b) =>
    b.addEventListener("click", () => apply(courtCandidate(state, b.dataset.court!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-propose]").forEach((b) =>
    b.addEventListener("click", () => apply(proposeMarriage(state, b.dataset.propose!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-educate]").forEach((b) =>
    b.addEventListener("click", () => apply(educateChild(state, b.dataset.educate!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-mscout]").forEach((b) =>
    b.addEventListener("click", () => apply(scoutMarriageCandidate(state, b.dataset.mscout!)))
  );
  app.querySelectorAll<HTMLInputElement>("[data-trychild]").forEach((el) =>
    el.addEventListener("change", () => apply(setTryForChild(state, el.checked)))
  );
  // 世代交代（v0.18）：後継者指定・家族雇用・引退
  app.querySelectorAll<HTMLButtonElement>("[data-designate]").forEach((b) =>
    b.addEventListener("click", () => apply(designateSuccessor(state, b.dataset.designate!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-hirefam]").forEach((b) =>
    b.addEventListener("click", () => apply(hireFamily(state, b.dataset.hirefam!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-retire]").forEach((b) =>
    b.addEventListener("click", () => {
      const succ = validSuccessor(state);
      const msg = succ
        ? `${succ.name} へ世代交代して引退します。よろしいですか？`
        : `有効な後継者がいません。引退すると事業は終了（ゲームオーバー）します。よろしいですか？`;
      if (window.confirm(msg)) apply(retire(state));
    })
  );
  // 株式（v0.19）：増資・他社株の売買
  app.querySelectorAll<HTMLButtonElement>("[data-raise]").forEach((b) =>
    b.addEventListener("click", () => apply(raiseCapital(state, Number(b.dataset.raise))))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-buystock]").forEach((b) =>
    b.addEventListener("click", () => { const d = b.dataset.buystock!; const i = d.lastIndexOf(":"); apply(buyRivalShares(state, d.slice(0, i), Number(d.slice(i + 1)))); })
  );
  app.querySelectorAll<HTMLButtonElement>("[data-sellstock]").forEach((b) =>
    b.addEventListener("click", () => { const d = b.dataset.sellstock!; const i = d.lastIndexOf(":"); apply(sellRivalShares(state, d.slice(0, i), Number(d.slice(i + 1)))); })
  );
  // 採用市場：職種フィルタ・並べ替え・ページング（v0.11）
  app.querySelectorAll<HTMLSelectElement>("[data-rjob]").forEach((sel) =>
    sel.addEventListener("change", () => { recruitJob = sel.value as JobCategory | "all"; recruitPage = 0; render(); })
  );
  app.querySelectorAll<HTMLSelectElement>("[data-rsort]").forEach((sel) =>
    sel.addEventListener("change", () => { recruitSort = sel.value as RecruitSort; recruitPage = 0; render(); })
  );
  app.querySelectorAll<HTMLButtonElement>("[data-rpage]").forEach((b) =>
    b.addEventListener("click", () => { recruitPage += b.dataset.rpage === "next" ? 1 : -1; if (recruitPage < 0) recruitPage = 0; render(); })
  );
  // 技術ツリー（v0.20）：セクター/状態フィルタ・ページング
  app.querySelectorAll<HTMLSelectElement>("[data-techsector]").forEach((sel) =>
    sel.addEventListener("change", () => { techSector = sel.value; techPage = 0; render(); })
  );
  app.querySelectorAll<HTMLSelectElement>("[data-techstatus]").forEach((sel) =>
    sel.addEventListener("change", () => { techStatusFilter = sel.value as typeof techStatusFilter; techPage = 0; render(); })
  );
  app.querySelectorAll<HTMLButtonElement>("[data-techpage]").forEach((b) =>
    b.addEventListener("click", () => { techPage += b.dataset.techpage === "next" ? 1 : -1; if (techPage < 0) techPage = 0; render(); })
  );
  // --- 国別スカウトサブスク（v0.10）：タブ切替・加入・解約 ---
  app.querySelectorAll<HTMLButtonElement>("[data-rctry]").forEach((b) =>
    b.addEventListener("click", () => { recruitCountry = b.dataset.rctry as PlayableCountry; recruitPage = 0; render(); })
  );
  app.querySelectorAll<HTMLButtonElement>("[data-sub]").forEach((b) =>
    b.addEventListener("click", () => { recruitCountry = b.dataset.sub as PlayableCountry; apply(subscribeScoutCountry(state, b.dataset.sub as PlayableCountry)); })
  );
  app.querySelectorAll<HTMLButtonElement>("[data-unsub]").forEach((b) =>
    b.addEventListener("click", () => apply(unsubscribeScoutCountry(state, b.dataset.unsub as PlayableCountry)))
  );
  app.querySelectorAll<HTMLSelectElement>("[data-assign]").forEach((sel) =>
    sel.addEventListener("change", () => apply(assignRole(state, sel.dataset.assign!, sel.value as Role)))
  );
  app.querySelectorAll<HTMLSelectElement>("[data-passign]").forEach((sel) =>
    sel.addEventListener("change", () => apply(assignToProduct(state, sel.dataset.passign!, sel.value || null)))
  );
  // 社長の実務兼務（v0.16）：役割/製品の割当・解除
  app.querySelectorAll<HTMLSelectElement>("[data-pcrole]").forEach((sel) =>
    sel.addEventListener("change", () => apply(sel.value ? assignRole(state, state.pc.personId, sel.value as Role) : releasePC(state)))
  );
  app.querySelectorAll<HTMLSelectElement>("[data-pcproduct]").forEach((sel) =>
    sel.addEventListener("change", () => apply(assignToProduct(state, state.pc.personId, sel.value || null)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-pcrelease]").forEach((b) =>
    b.addEventListener("click", () => apply(releasePC(state)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-unlock]").forEach((b) =>
    b.addEventListener("click", () => apply(unlockBlueprint(state, b.dataset.unlock!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-rbudget]").forEach((b) =>
    b.addEventListener("click", () => apply(setResearchBudget(state, Number(b.dataset.rbudget) as 1 | -1)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-mbudget]").forEach((b) =>
    b.addEventListener("click", () => {
      const [pid, ch, dir] = b.dataset.mbudget!.split(":");
      apply(setMarketBudget(state, pid, ch as MarketChannel, Number(dir) as 1 | -1));
    })
  );
  app.querySelectorAll<HTMLButtonElement>("[data-analyze]").forEach((b) =>
    b.addEventListener("click", () => apply(analyzeMarket(state, b.dataset.analyze!)))
  );
  app.querySelectorAll<HTMLButtonElement>("[data-launch]").forEach((b) =>
    b.addEventListener("click", () => {
      const [bpId, country] = b.dataset.launch!.split(":");
      apply(launchProduct(state, bpId, country as PlayableCountry));
    })
  );
}

render();
