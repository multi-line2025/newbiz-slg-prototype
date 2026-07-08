/**
 * v0.10 回帰テスト：単一500人ワールドDB／国別スカウトサブスク（可視性ゲート）／★フォグ／採用可否ゲート。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { poolPeople } from "../src/core/state";
import {
  subscribeScoutCountry, unsubscribeScoutCountry, scoutCandidate, offerAcceptProbability,
} from "../src/core/actions";
import { scoutedView } from "../src/core/scout";
import { computeMonthlyBurn } from "../src/core/finance";
import { SCOUT_SUB_COST } from "../src/core/model/constants";
import type { PlayableCountry } from "../src/core/model/types";

const PLAYABLE: PlayableCountry[] = ["US", "JP", "DE", "GB", "SG"];

describe("v0.10：単一ワールド人材DB（約500人）", () => {
  it("初期DBは約500人・全5カ国が分布する", () => {
    const s = initGame({ seed: 7 });
    const all = [...s.poolIds, ...s.employeeIds];
    expect(all.length).toBeGreaterThan(480);
    expect(all.length).toBeLessThanOrEqual(500);
    const countries = new Set(all.map((id) => s.people[id].nationality));
    for (const c of PLAYABLE) expect(countries.has(c)).toBe(true); // 全5カ国が居る
  });

  it("seed再現性：同じseedなら同じDB（PA列が一致）", () => {
    const a = poolPeople(initGame({ seed: 55 })).map((p) => p.PA);
    const b = poolPeople(initGame({ seed: 55 })).map((p) => p.PA);
    expect(a).toEqual(b);
    const c = poolPeople(initGame({ seed: 56 })).map((p) => p.PA);
    expect(a).not.toEqual(c); // 別seedは別DB
  });
});

describe("v0.10：国別スカウトサブスク（可視性ゲート）", () => {
  it("起業国は開始時から加入済み、他国は未加入", () => {
    const s = initGame({ seed: 7, country: "US" });
    expect(s.scoutSubscriptions).toContain("US");
    expect(s.scoutSubscriptions).not.toContain("JP");
  });

  it("加入で★可視化／未加入は★も含め一切不明（完全フォグ）", () => {
    let s = initGame({ seed: 7, country: "US" });
    const jp = poolPeople(s).find((p) => p.nationality === "JP")!;
    // 未加入：フォグ（visible=false・★=0・素性null）
    const before = scoutedView(jp, 12, s.scoutSubscriptions.includes("JP" as PlayableCountry));
    expect(before.visible).toBe(false);
    expect(before.occStars).toBe(0);
    expect(before.caKnown).toBeNull();
    // 加入後：★が見える
    s = subscribeScoutCountry(s, "JP").state;
    const after = scoutedView(jp, 12, s.scoutSubscriptions.includes("JP" as PlayableCountry));
    expect(after.visible).toBe(true);
    expect(after.occStars).toBeGreaterThan(0);
  });

  it("月額サブスク料が monthlyBurn に加算される／解約で外れる", () => {
    let s = initGame({ seed: 7, country: "US" });
    const base = computeMonthlyBurn(s);
    s = subscribeScoutCountry(s, "JP").state;
    expect(computeMonthlyBurn(s)).toBe(base + SCOUT_SUB_COST.JP);
    s = unsubscribeScoutCountry(s, "JP").state;
    expect(computeMonthlyBurn(s)).toBe(base); // 解約で月額が外れる
  });

  it("解約で可視性が戻り（再フォグ）、新規の個別深掘りは不可になる", () => {
    let s = initGame({ seed: 7, country: "US" });
    s = subscribeScoutCountry(s, "JP").state;
    const jp = poolPeople(s).find((p) => p.nationality === "JP")!;
    // 加入中は個別スカウト可
    const ok = scoutCandidate(s, jp.id);
    expect(ok.ok).toBe(true);
    s = ok.state;
    // 解約 → 新規深掘り不可
    s = unsubscribeScoutCountry(s, "JP").state;
    const denied = scoutCandidate(s, jp.id);
    expect(denied.ok).toBe(false);
    // 可視性も戻る（フォグ）
    expect(scoutedView(jp, 12, s.scoutSubscriptions.includes("JP" as PlayableCountry)).visible).toBe(false);
  });

  it("個別スカウトは加入国の候補にのみ実行可能", () => {
    const s = initGame({ seed: 7, country: "US" });
    const us = poolPeople(s).find((p) => p.nationality === "US")!;
    const jp = poolPeople(s).find((p) => p.nationality === "JP")!;
    expect(scoutCandidate(s, us.id).ok).toBe(true);  // 加入国=OK
    expect(scoutCandidate(s, jp.id).ok).toBe(false); // 未加入国=NG
  });

  it("加入は1AP、加入中の国へは再加入できない", () => {
    let s = initGame({ seed: 7, country: "US" });
    const ap0 = s.ap;
    s = subscribeScoutCountry(s, "JP").state;
    expect(s.ap).toBe(ap0 - 1);
    expect(subscribeScoutCountry(s, "JP").ok).toBe(false); // 既に加入
  });
});

describe("v0.11：採用可否＝評判は“受諾確率”で表現（ハードゲート/数値露出は撤廃）", () => {
  it("無名企業(rep10)は高PAほど受諾確率が低く、普通PAは高い（閾値は露出しない）", () => {
    const s = initGame({ seed: 7, country: "US" });
    const highPA = poolPeople(s).find((p) => p.PA > 150);
    const ordinary = poolPeople(s).find((p) => p.PA <= 110)!;
    const pOrd = offerAcceptProbability(s.company, ordinary, ordinary.salaryDemand);
    expect(pOrd).toBeGreaterThan(0.6); // 普通人材は概ね受諾
    if (highPA) {
      const pHigh = offerAcceptProbability(s.company, highPA, highPA.salaryDemand);
      expect(pHigh).toBeLessThan(0.2);      // 高位人材は概ね辞退
      expect(pHigh).toBeGreaterThan(0);     // ただし0にはしない（上限特定を困難に）
    }
  });
});
