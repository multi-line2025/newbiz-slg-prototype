/**
 * ======================================================================
 *  turn.ts  1ターン進行（仕様 §2.2 A〜E の最小版）
 * ----------------------------------------------------------------------
 *  (A) 収支計算・派生値更新
 *  (A) 加齢・寿命再評価
 *  (D) 成長Δ反映（在籍社員）
 *  (D') 簡易イベント（QUAL→TRAC の口コミ、稀な不祥事）
 *  (E) ターン終了・AP回復・seed前進
 *  純粋関数：同じ state・seed なら必ず同じ結果（技術設計 §2.1）。
 * ======================================================================
 */

import type { Person, Id } from "./model/types";
import type { ProtoGameState, MarketState, Product } from "./state";
import { employees, productTeam } from "./state";
import { applyFinance, computeRevenue } from "./finance";
import { applyGrowth, envFromMorale } from "./growth";
import { recomputeLifeExpectancy } from "./person";
import { stepProductMarket } from "./market";
import { computeQualP, laborCapacity } from "./product";
import { discloseValues } from "./analysis";
import { stepDynamics, staleEff } from "./dynamics";
import { rpPerTurn, eraForTurn, sectorTier, getBlueprint } from "./research";
import { checkAchievements } from "./achievements";
import { resolvePendingHires } from "./actions";
import { snapshotRivals, computeRivalNews, selfMarketIds } from "./rivals";
import { makePRNG } from "./prng";
import { clamp } from "./util";
import { POACH_BASE, POACH_VULN_MIN, ANALYSIS_STEPS, QUAL_TIER_CAP as TIER_CAP, RIVAL_NEWS_CAP } from "./model/constants";

/** advanceTurn の戻り値。log は今ターンの出来事。 */
export interface TurnResult {
  next: ProtoGameState;
  events: string[];
}

/**
 * 1ターンを進める最上位関数。
 */
export function advanceTurn(state: ProtoGameState): TurnResult {
  // ゲームオーバー後はターンを進めない（新規開始/ロード待ち）
  if (state.gameOver) return { next: state, events: [] };

  const rng = makePRNG(state.rngSeed);
  const events: string[] = [];
  let s = state;
  // ターン開始時のライバル状態を控える（このターンの動き＝終端との差分・v0.12）
  const prevRivalSnap = snapshotRivals(state.markets);

  // ---- 加齢・寿命再評価（全人材）＋ 成長（在籍社員のみ）----
  const nextPeople: Record<Id, Person> = { ...s.people };
  const env = envFromMorale(60); // プロトタイプでは会社共通の士気60を仮定
  for (const id of Object.keys(nextPeople)) {
    const p = nextPeople[id];
    const aged: Person = { ...p, age: p.age + 1 / 12 };
    aged.lifeExpectancy = recomputeLifeExpectancy(aged);
    nextPeople[id] = aged;
  }
  for (const id of s.employeeIds) {
    const p = nextPeople[id];
    if (p) nextPeople[id] = applyGrowth(p, env);
  }
  s = { ...s, people: nextPeople };

  // ---- Era進行（§7.1）：ターン閾値でステップ遷移。旧技術は青写真上限で陳腐化 ----
  const nextEra = eraForTurn(s.startEra, s.turn);
  if (nextEra !== s.era) {
    events.push(`時代が進行：${s.era} → ${nextEra}。新青写真が解放条件を満たし、旧技術は陳腐化。`);
  }
  s = { ...s, era: nextEra };

  // ---- 研究：社RP産出（§12.3）----
  const emps = employees(s);
  const rpGain = rpPerTurn(emps, s.company.researchBudget);
  const nextRP = s.company.RP_C + rpGain;

  // 不祥事（評判ショック・§4.11.2a 簡易版）
  let nextRep = s.company.reputation;
  for (const e of emps) {
    const risk = 0.003 * (e.attributes.hidden.controversy / 20);
    if (rng.chance(risk)) {
      const shock = 25 * rng.float(0.5, 1.5) * 0.4;
      nextRep = clamp(nextRep - shock, 0, 100);
      events.push(`不祥事発生：${e.name} が問題行動。評判 −${Math.round(shock)}。`);
    }
  }
  s = { ...s, company: { ...s.company, reputation: nextRep, RP_C: nextRP } };

  // ---- A. 市場分析の進行＋情報陳腐化（§3・§5-A）----
  s = stepAnalysis(s, events);

  // ---- 動的市場（§7前段）：成熟度成長→実効パイ→密度→参入。自社製品のある市場を先に更新 ----
  {
    const markets = { ...s.markets };
    const selfByMarket: Record<string, Product> = {};
    for (const p of s.products) selfByMarket[p.marketId] = p;
    for (const id of Object.keys(markets)) {
      const before = markets[id];
      const dyn = stepDynamics(before, selfByMarket[id] ?? null, s.company, s.era, s.marketSeed);
      markets[id] = dyn.market;
      if (Math.floor(dyn.market.maturity * 4) > Math.floor(before.maturity * 4)) {
        events.push(`市場成長：${id} が成熟（${(dyn.market.maturity * 100).toFixed(0)}%）。実効パイ拡大・ライバル流入増。`);
      }
    }
    s = { ...s, markets };
  }

  // ---- B. 製品QUAL_p の更新（§2.3・§5.2）：担当チーム×開発成熟×時代適合＋tier天井 ----
  let products: Product[] = s.products.map((p) => {
    const team = productTeam(s, p.id);
    const devTurns = p.devTurns + (team.length > 0 ? 1 : 0); // 担当が居れば開発が進む
    const tier = sectorTier(p.sector, s.company.unlockedBlueprints);
    // 創業製品は qualFloor（創業者のMVP寄与）を下限に。ただしtier天井は超えない（v0.7.2）。
    const cap = TIER_CAP[Math.max(1, tier) - 1];
    const QUAL_p = Math.min(Math.max(computeQualP(p.blueprintId, team, devTurns, s.era, tier), p.qualFloor ?? 0), cap);
    return { ...p, devTurns, QUAL_p };
  });

  // ---- C. 各市場のシェア更新（§5-C）：製品ごとに stepProductMarket（tier特化ボーナス込み）----
  const markets = { ...s.markets };
  let thxpDelta = 0;
  products = products.map((p) => {
    const market = markets[p.marketId];
    if (!market) return p;
    const team = productTeam(s, p.id);
    const tier = sectorTier(p.sector, s.company.unlockedBlueprints);
    // v0.8：労働集約は頭数スループット(laborCapacity)で競争力が決まる。知識集約は現行。
    const archetype = getBlueprint(p.blueprintId)?.archetype ?? "knowledge";
    const laborCap = archetype === "labor" ? laborCapacity(team) : 0;
    const r = stepProductMarket(p, team, market, s.company, s.era, s.marketSeed, tier, archetype, laborCap);
    markets[p.marketId] = { ...market, nearRivals: r.nearRivals };
    thxpDelta += r.dTHxP;
    events.push(...r.events);
    return r.product;
  });
  const nextTHxP = Math.max(0, s.company.THxP_customer + thxpDelta);
  s = { ...s, products, markets, company: { ...s.company, THxP_customer: nextTHxP } };

  // ---- 他企業（ライバル）の動向：前ターン差分から動きニュースを生成（可視市場のみ・v0.12）----
  {
    const selfIds = selfMarketIds(s);
    const news = computeRivalNews(prevRivalSnap, s.markets, selfIds);
    for (const n of news) events.push(n);
    s = {
      ...s,
      rivalPrev: prevRivalSnap, // 前ターン基準を保存（他企業タブの“動き”表示に使用）
      rivalNews: [...s.rivalNews, ...news].slice(-RIVAL_NEWS_CAP),
    };
  }

  // ---- D. 収支：市場ごと売上を合算 − バーン → CASH・派生値（§5-D）----
  const cashBefore = s.company.CASH;
  s = applyFinance(s);
  const netProfit = s.company.CASH - cashBefore;
  if (s.company.CASH < 0) {
    events.push(`資金がマイナスに転落（CASH=${Math.round(s.company.CASH)}）。資金ショート危機。`);
  }

  // ---- ライバル引き抜き（§4.12.3 簡易版）----
  s = applyPoaching(s, rng, events);

  // ---- 採用オファーの進行・受諾判定（v0.11・3ターンのリクルート）----
  s = resolvePendingHires(s, rng, events);

  // ---- ターン終了：連続黒字・AP回復・turn前進・seed前進 ----
  const profitStreak = netProfit >= 0 ? s.profitStreak + 1 : 0;
  s = {
    ...s,
    ap: s.apMax,
    turn: s.turn + 1,
    rngSeed: rng.nextSeed(),
    profitStreak,
  };

  const revenue = Math.round(computeRevenue(s));
  events.unshift(
    `ターン${s.turn}：売上+${revenue} / バーン-${Math.round(s.company.monthlyBurn)} → CASH ${Math.round(
      s.company.CASH
    )}`
  );

  // ---- 終了条件：資金ショート（CASH<0）でゲームオーバー ----
  if (s.company.CASH < 0 && !s.gameOver) {
    s = { ...s, gameOver: true, endTurn: s.turn };
    events.push(`【ゲームオーバー】資金ショート。ターン${s.turn}で事業は幕を閉じた。`);
  }

  // ---- 実績判定（達成でイベント追記。ゲームは終わらない）----
  const ach = checkAchievements(s);
  s = ach.state;
  for (const a of ach.newly) events.push(`🏆 実績解除：${a.label}（${a.desc}）`);

  s = { ...s, log: [...s.log, ...events] };
  return { next: s, events };
}

/**
 * 市場分析の進行と情報陳腐化（§3.7 / §5-A）。純粋関数。
 * 進行中の分析はターンを消化し、完了で開示値を確定。古い分析はレベルダウン。
 */
function stepAnalysis(state: ProtoGameState, events: string[]): ProtoGameState {
  const markets: Record<string, MarketState> = { ...state.markets };
  for (const id of Object.keys(markets)) {
    let m = markets[id];

    // 進行中の分析を1ターン消化
    if (m.analysisInProgress) {
      const prog = m.analysisInProgress;
      const turnsLeft = prog.turnsLeft - 1;
      if (turnsLeft <= 0) {
        const step = ANALYSIS_STEPS[prog.targetLevel - 1];
        const disclosed = discloseValues(m, state.era, state.marketSeed, step.baseError, prog.analystSkill);
        m = {
          ...m,
          analysisLevel: prog.targetLevel,
          analyzed: disclosed,
          lastAnalyzedTurn: state.turn,
          analysisInProgress: null,
        };
        events.push(`市場分析 完了：${id} → Lv${prog.targetLevel}（規模・競合密度を開示）`);
      } else {
        m = { ...m, analysisInProgress: { ...prog, turnsLeft } };
      }
    }

    // 情報の陳腐化：最終分析から STALE_eff（ホット市場ほど短い・§4.2）経過ごとに1段階ダウン
    if (m.analysisLevel > 0 && m.lastAnalyzedTurn != null && !m.analysisInProgress) {
      const elapsed = state.turn - m.lastAnalyzedTurn;
      if (elapsed >= staleEff(m)) {
        const level = (m.analysisLevel - 1) as 0 | 1 | 2;
        m = {
          ...m,
          analysisLevel: level,
          analyzed: level === 0 ? null : m.analyzed,
          lastAnalyzedTurn: level === 0 ? null : state.turn,
        };
        events.push(`市場情報が陳腐化：${id} → Lv${level}（再分析が必要）`);
      }
    }

    markets[id] = m;
  }
  return { ...state, markets };
}

/** 引き抜かれやすさ vuln（§4.12.3）。0-1。 */
export function poachVulnerability(e: Person, rivalAggression: number): number {
  const loyalty = e.attributes.hidden.loyalty;
  const ambition = e.attributes.mental.ambition;
  const salary = e.contract?.salary ?? e.salaryDemand;
  // 薄給係数：実給与が要求給与を下回るほど大（clamp[0.5,2.0]）
  const underpaid = clamp((e.salaryDemand - salary) / Math.max(1, e.salaryDemand) + 1, 0.5, 2.0);
  return (
    ((20 - loyalty) / 20) *
    (ambition / 20) *
    underpaid *
    ((100 - e.morale) / 100) *
    rivalAggression
  );
}

/**
 * ライバルによる引き抜きを1ターン分適用する（§4.12.3 簡易版）。
 * 低忠誠×高野心×薄給×低士気の社員が、稀にライバルへ流出する。
 */
function applyPoaching(state: ProtoGameState, rng: makePRNGReturn, events: string[]): ProtoGameState {
  let s = state;
  const rivalAggression = 0.7; // プロトタイプ固定のライバル攻撃性
  for (const id of [...s.employeeIds]) {
    const e = s.people[id];
    if (!e) continue;
    const vuln = poachVulnerability(e, rivalAggression);
    if (vuln < POACH_VULN_MIN) continue; // 満足・忠誠の高い社員は狙われない
    if (rng.chance(vuln * POACH_BASE)) {
      // 離職：会社から外し、候補プールにも戻さない（ライバルへ移籍した扱い）
      const detached: Person = { ...e, contract: null, assignedRole: null };
      s = {
        ...s,
        people: { ...s.people, [id]: detached },
        employeeIds: s.employeeIds.filter((x) => x !== id),
      };
      events.push(`引き抜き：${e.name}（忠誠${e.attributes.hidden.loyalty}）がライバルへ移籍。`);
    }
  }
  return s;
}

/** makePRNG の戻り値型（型注釈用）。 */
type makePRNGReturn = ReturnType<typeof makePRNG>;
