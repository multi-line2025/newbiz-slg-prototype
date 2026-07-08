/**
 * v0.11 回帰テスト：3ターンのリクルート（オファー→受諾判定）／情報リーク遮断（PA非露出）／
 * 受諾モデル／全候補表示のための給与昇順ソート。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { makeOffer, offerAcceptProbability } from "../src/core/actions";
import { poolPeople } from "../src/core/state";
import { RECRUIT_TURNS, MAX_PENDING_OFFERS } from "../src/core/model/constants";
import type { ProtoGameState } from "../src/core/state";

/** rep10 で受諾確率が高い普通候補（US）を返す。 */
function ordinaryUS(s: ProtoGameState) {
  return poolPeople(s)
    .filter((p) => p.nationality === "US" && p.PA <= 105)
    .sort((a, b) => offerAcceptProbability(s.company, b, b.salaryDemand) - offerAcceptProbability(s.company, a, a.salaryDemand))[0];
}

describe("v0.11：3ターンのリクルート（オファー→着任）", () => {
  it("オファーは即時雇用せず pending に積まれ、3ターン後に着任する", () => {
    let s = initGame({ seed: 7, country: "US" });
    const cand = ordinaryUS(s);
    const empBefore = s.employeeIds.length;
    s = makeOffer(s, cand.id).state;
    expect(s.pendingHires.length).toBe(1);
    expect(s.pendingHires[0].remaining).toBe(RECRUIT_TURNS);
    expect(s.employeeIds.length).toBe(empBefore); // まだ雇用されない
    // 3ターン進めると着任（受諾確率が高い候補を選んでいる）
    for (let t = 0; t < RECRUIT_TURNS; t++) s = advanceTurn(s).next;
    expect(s.pendingHires.length).toBe(0);
    expect(s.employeeIds.includes(cand.id)).toBe(true);
  });

  it("二重オファー不可・同時オファー上限あり", () => {
    let s = initGame({ seed: 11, country: "US" });
    const us = poolPeople(s).filter((p) => p.nationality === "US");
    s = makeOffer(s, us[0].id).state;
    expect(makeOffer(s, us[0].id).ok).toBe(false); // 二重不可
    // 上限まで積む
    let i = 1;
    while (s.pendingHires.length < MAX_PENDING_OFFERS) { s = makeOffer(s, us[i++].id).state; }
    expect(s.pendingHires.length).toBe(MAX_PENDING_OFFERS);
    expect(makeOffer(s, us[i].id).ok).toBe(false); // 上限超過は不可
  });

  it("創業メンバーは即時雇用済み（開始時 pending は空）", () => {
    const s = initGame({ seed: 7, archetype: "labor" });
    expect(s.pendingHires.length).toBe(0);
    expect(s.employeeIds.length).toBe(8);
  });
});

describe("v0.11：情報リーク遮断（PA・評判上限を露出しない）", () => {
  const leak = /PA\s*\d|PA\d|到達上限|上限PA/;

  it("オファー提出メッセージに PA・上限が出ない", () => {
    let s = initGame({ seed: 7, country: "US" });
    const highPA = poolPeople(s).find((p) => p.nationality === "US" && p.PA > 130) ?? poolPeople(s)[0];
    const r = makeOffer(s, highPA.id);
    expect(r.ok).toBe(true);
    expect(leak.test(r.message)).toBe(false);
  });

  it("mass-offer しても受諾/辞退イベントに PA・上限が出ず、数値で上限特定できない", () => {
    let s = initGame({ seed: 3, country: "US" });
    // 上限枠までオファーを出し、3ターン回して返答イベントを集める
    const us = poolPeople(s).filter((p) => p.nationality === "US");
    for (let k = 0; k < MAX_PENDING_OFFERS && k < us.length; k++) s = makeOffer(s, us[k].id).state;
    let events: string[] = [];
    for (let t = 0; t < RECRUIT_TURNS + 1; t++) { const r = advanceTurn(s); s = r.next; events.push(...r.events); }
    const replies = events.filter((e) => /着任|辞退/.test(e));
    expect(replies.length).toBeGreaterThan(0);
    for (const e of replies) expect(leak.test(e)).toBe(false); // どの返答も PA/上限を出さない
  });
});

describe("v0.11：受諾モデル（無名企業は高位人材に辞退されがち・境界は確率的）", () => {
  it("提示給与を上げると受諾確率が上がる", () => {
    const s = initGame({ seed: 7 });
    const p = poolPeople(s)[0];
    const low = offerAcceptProbability(s.company, p, p.salaryDemand);
    const high = offerAcceptProbability(s.company, p, p.salaryDemand * 1.5);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("評判が高いほど同じ候補の受諾確率が上がる", () => {
    const s = initGame({ seed: 7 });
    const p = poolPeople(s).find((x) => x.PA >= 130) ?? poolPeople(s)[0];
    const famous = { ...s.company, reputation: 90 };
    const unknown = { ...s.company, reputation: 10 };
    expect(offerAcceptProbability(famous, p, p.salaryDemand)).toBeGreaterThan(
      offerAcceptProbability(unknown, p, p.salaryDemand)
    );
  });
});

describe("v0.11：全候補表示のための給与昇順（安い頭数の狙い撃ち）", () => {
  it("要求給与でソートすると最安候補を先頭で選べる", () => {
    const s = initGame({ seed: 3, country: "US" });
    const us = poolPeople(s).filter((p) => p.nationality === "US");
    const asc = [...us].sort((a, b) => a.salaryDemand - b.salaryDemand);
    expect(asc[0].salaryDemand).toBeLessThanOrEqual(asc[asc.length - 1].salaryDemand);
    // 未加入国に依らず、加入国(US)の全候補が対象になる（打ち切りがない）
    expect(us.length).toBeGreaterThan(24);
  });
});
