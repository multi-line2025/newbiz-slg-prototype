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
import { employees, poolPeople, productTeam } from "../core/state";
import type { PlayableCountry, JobCategory, Role } from "../core/model/types";
import {
  scoutCandidate,
  hireCandidate,
  assignRole,
  assignToProduct,
  launchProduct,
  analyzeMarket,
  setResearchBudget,
  setMarketBudget,
  unlockBlueprint,
  companyScoutSkill,
  type ActionResult,
  type MarketChannel,
} from "../core/actions";
import { scoutedView, type ScoutView } from "../core/scout";
import { BLUEPRINTS, blueprintStatus, researchCoeff, rpPerTurn, blueprintForSector, sectorTier, breadthDepth, type LockReason } from "../core/research";
import {
  productCompetitiveness, marketRivalComp, earnedShareCap, reachShareCap, productRevenue,
} from "../core/market";
import { marketEff, marketSizeOf } from "../core/markets";
import { staleEff } from "../core/dynamics";
import { analysisSkill, fitP, opportunityScore, analyzedRange } from "../core/analysis";
import { SCOUT_STEPS, SECTOR_NAME, SECTORS, ANALYSIS_STEPS, DMAT_REF } from "../core/model/constants";
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
type TabId = "overview" | "talent" | "market" | "products" | "research" | "finance" | "achievements";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "概要" },
  { id: "talent", label: "人材" },
  { id: "market", label: "市場分析" },
  { id: "products", label: "製品" },
  { id: "research", label: "研究・青写真" },
  { id: "finance", label: "財務・組織" },
  { id: "achievements", label: "実績" },
];
// アクティブタブはUI層のモジュール状態（ターン送り/セーブ/ロードでも保持。新規開始で概要へ）。
let activeTab: TabId = "overview";
// 新規開始時の業態選択モーダル表示フラグ（v0.8）。表示中は選択するまでゲームを始めない。
let choosingArchetype = false;

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
    <td class="acts">${scoutBtn}<button class="mini hire" data-hire="${p.id}">採用<br><span class="cost">1AP</span></button></td>
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

/** 1能力値のバー（1-20）。 */
function attrBar(label: string, val: number): string {
  const pct = (val / 20) * 100;
  return `<div class="ab"><span class="ab-l">${label}</span><span class="ab-track"><span class="ab-fill" style="width:${pct}%"></span></span><span class="ab-v">${val}</span></div>`;
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
        <span><b class="ca">CA ${p.CA}</b> / <b class="pa">PA ${p.PA}</b></span>
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
  } else {
    // 候補者：scoutLevelでゲート。未スカウトはCA/PA/人格を出さない
    const v = scoutedView(p, companyScoutSkill(state));
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
        <button class="mini hire" data-hire="${p.id}">採用<br><span class="cost">1AP</span></button>
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
        <span class="muted">QUAL_p <b class="pa">${p.QUAL_p.toFixed(0)}</b>/天井${cap}(t${tier}) / 開発${p.devTurns}T / 担当${team.length}名 / ${matTxt}</span></div>
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
          <div class="arch-desc">一般作業員を数多く雇い、頭数×コツコツ力で稼ぐ。品質の天井は低いが、序盤から黒字化しやすく安定。</div>
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
  const apDots = "●".repeat(Math.max(0, state.ap)) + "○".repeat(Math.max(0, state.apMax - state.ap));
  return `<div class="topbar">
    <div class="tb-brand">
      <div class="tb-co">${c.name}</div>
      <div class="tb-sub">${COUNTRY_LABEL[c.foundedCountry]} / ${ERA_LABEL[state.era]} / T${state.turn}</div>
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

/** 採用市場テーブル（スカウト／採用）。 */
function recruitPanel(): string {
  const skill = companyScoutSkill(state);
  const pool = poolPeople(state).slice()
    .sort((a, b) => scoutedView(b, skill).occStars - scoutedView(a, skill).occStars)
    .slice(0, 16);
  return `<section class="panel">
    <h2>採用市場（全${state.poolIds.length}名から抜粋・分析スキル ${skill.toFixed(1)}）
      <span class="legend">氏名クリックで詳細。未スカウトはCA・PAも不明 → スカウトで「星→ぼやけ→正確値」開示</span></h2>
    <table>
      <thead><tr><th>氏名</th><th>職種</th><th>年齢</th><th>国籍</th><th>技能</th><th>CA</th><th>PA</th><th>忠誠</th><th>要求給与</th><th>操作</th></tr></thead>
      <tbody>${pool.map((p) => candidateRow(p, scoutedView(p, skill))).join("")}</tbody>
    </table>
  </section>`;
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
    case "products": return productsPanel() + logPanel();
    case "research": return blueprintPanel();
    case "finance": return financeTab();
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
    selectedPersonId = null; activeTab = "overview"; render();
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
  app.querySelectorAll<HTMLButtonElement>("[data-hire]").forEach((b) =>
    b.addEventListener("click", () => apply(hireCandidate(state, b.dataset.hire!)))
  );
  app.querySelectorAll<HTMLSelectElement>("[data-assign]").forEach((sel) =>
    sel.addEventListener("change", () => apply(assignRole(state, sel.dataset.assign!, sel.value as Role)))
  );
  app.querySelectorAll<HTMLSelectElement>("[data-passign]").forEach((sel) =>
    sel.addEventListener("change", () => apply(assignToProduct(state, sel.dataset.passign!, sel.value || null)))
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
