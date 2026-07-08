/**
 * v0.13 回帰テスト：個人キャリア＆家族（評判釣り合いゲート／妊娠→出産・PA継承／教育／非回帰）。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { courtCandidate, proposeMarriage, educateChild } from "../src/core/actions";
import {
  fertility, repMatchProbability, eligiblePartners, inheritPA, isBloodRelated, pcPerson, buildChild,
} from "../src/core/family";
import { makePRNG } from "../src/core/prng";
import { GESTATION_TURNS } from "../src/core/model/constants";
import type { ProtoGameState } from "../src/core/state";
import type { Person } from "../src/core/model/types";

const advanceN = (s: ProtoGameState, n: number) => { for (let i = 0; i < n; i++) s = advanceTurn(s).next; return s; };

/** PCを、若い異性NPCと即結婚させた状態を作る（birth検証用）。 */
function forceMarry(s: ProtoGameState, targetAge = 26): ProtoGameState {
  const cand = eligiblePartners(s).find((p) => p.age >= 20 && p.age <= 35)!;
  const partner: Person = { ...cand, age: targetAge, relationToPC: "spouse" };
  return {
    ...s,
    people: { ...s.people, [partner.id]: partner },
    pc: { ...s.pc, spouseId: partner.id },
  };
}

describe("v0.13：妊孕性 fertility(age, sex)（§9.3.1）", () => {
  it("ピーク25歳・女性40歳/男性60歳でゼロ・加齢で低下", () => {
    expect(fertility(25, "female")).toBeCloseTo(1, 5);
    expect(fertility(15, "female")).toBe(0);
    expect(fertility(40, "female")).toBe(0);
    expect(fertility(60, "male")).toBe(0);
    // 高齢ほど低下（妊娠率の年齢依存）
    expect(fertility(30, "female")).toBeGreaterThan(fertility(38, "female"));
    expect(fertility(30, "male")).toBeGreaterThan(fertility(55, "male"));
    // 男性は女性より窓が広い（同年齢35で男性>女性）
    expect(fertility(35, "male")).toBeGreaterThan(fertility(35, "female"));
  });
});

describe("v0.13：★評判の釣り合いゲート（§C）", () => {
  it("評判差が小さいほど成立確率が高く、閾値超で不可(0)", () => {
    expect(repMatchProbability(50, 50)).toBeCloseTo(1, 5);
    expect(repMatchProbability(50, 30)).toBeGreaterThan(0);
    expect(repMatchProbability(50, 30)).toBeLessThan(1);
    expect(repMatchProbability(50, 10)).toBe(0); // 差40 > 35 → 不可
    expect(repMatchProbability(90, 20)).toBe(0);
  });

  it("PC評判が上がると高評判の相手が“釣り合う”（進行報酬）", () => {
    const partnerRep = 60;
    expect(repMatchProbability(20, partnerRep)).toBe(0);      // 無名PCには高評判は不可
    expect(repMatchProbability(45, partnerRep)).toBeGreaterThan(0); // 評判が上がれば射程内
  });

  it("評判が離れすぎた相手には求愛が不可（ok:false・PA等は露出しない）", () => {
    let s = initGame({ seed: 7 });
    // PC(rep10)から遠い高評判の独身者を用意
    const far = eligiblePartners(s)[0];
    s = { ...s, people: { ...s.people, [far.id]: { ...far, reputation: 90 } } };
    const r = courtCandidate(s, far.id);
    expect(r.ok).toBe(false);
    expect(/PA\d|PA \d|到達上限/.test(r.message)).toBe(false);
  });

  it("血族婚は不可（§9.3.3）：同一bloodlineの相手には求愛できない", () => {
    let s = initGame({ seed: 7 });
    const cand = eligiblePartners(s)[0];
    // 相手をPCと同一血統に（＝血族）
    const rel: Person = { ...cand, bloodlineId: s.pc.bloodlineId };
    s = { ...s, people: { ...s.people, [rel.id]: rel } };
    expect(isBloodRelated(s.pc.bloodlineId, rel)).toBe(true);
    expect(eligiblePartners(s).some((p) => p.id === rel.id)).toBe(false); // 相手プールから除外
    expect(courtCandidate(s, rel.id).ok).toBe(false); // 求愛不可
  });

  it("求愛→交際→求婚→結婚（釣り合う相手なら成立する）", () => {
    let s = initGame({ seed: 7 });
    const pc = pcPerson(s);
    // 釣り合う（評判が近い）独身者を選ぶ
    const cand = eligiblePartners(s).find((p) => repMatchProbability(pc.reputation, p.reputation) > 0.5)!;
    let becameLover = false;
    for (let i = 0; i < 40 && !becameLover; i++) {
      const r = courtCandidate(s, cand.id); s = r.state;
      becameLover = s.people[cand.id].relationToPC === "lover";
      s = { ...s, ap: 10 };
    }
    expect(becameLover).toBe(true);
    let married = false;
    for (let i = 0; i < 40 && !married; i++) {
      const r = proposeMarriage(s, cand.id); if (r.ok) s = r.state;
      married = s.pc.spouseId === cand.id;
      s = { ...s, ap: 10, pc: { ...s.pc, wealth: 30000 } };
    }
    expect(married).toBe(true);
  });
});

describe("v0.13：妊娠→出産・PA継承（§9.3）", () => {
  it("子PA＝両親PAの平均±突然変異（1-200）", () => {
    const rng = makePRNG(1);
    for (let i = 0; i < 50; i++) {
      const pa = inheritPA(150, 90, rng);
      expect(pa).toBeGreaterThanOrEqual(120 - 12 - 1);
      expect(pa).toBeLessThanOrEqual(120 + 12 + 1);
    }
  });

  it("結婚後、約12ターンで0歳児が誕生し bloodline継承・childrenIds登録・後継者候補", () => {
    let s = forceMarry(initGame({ seed: 7 }), 26);
    let born = false;
    for (let t = 0; t < 40 && !born; t++) { s = advanceTurn(s).next; born = s.pc.childrenIds.length > 0; }
    expect(born).toBe(true);
    const child = s.people[s.pc.childrenIds[0]];
    expect(child.age).toBeLessThan(1);                 // 生まれたばかり（0歳児）
    expect(child.bloodlineId).toBe(s.pc.bloodlineId);  // 血統継承
    expect(child.isSuccessorCandidate).toBe(true);     // 後継者候補
    expect(child.relationToPC).toBe("child");
  });

  it("妊娠から出産まで概ね GESTATION_TURNS（約1年）", () => {
    let s = forceMarry(initGame({ seed: 3 }), 26);
    let conceivedTurn: number | null = null;
    let bornTurn: number | null = null;
    for (let t = 0; t < 50; t++) {
      const before = s.pregnancy; s = advanceTurn(s).next;
      if (!before && s.pregnancy) conceivedTurn = s.turn;
      if (bornTurn === null && s.pc.childrenIds.length > 0) { bornTurn = s.turn; break; }
    }
    expect(conceivedTurn).not.toBeNull();
    expect(bornTurn).not.toBeNull();
    expect(bornTurn! - conceivedTurn!).toBeGreaterThanOrEqual(GESTATION_TURNS - 1);
    expect(bornTurn! - conceivedTurn!).toBeLessThanOrEqual(GESTATION_TURNS + 1);
  });
});

describe("v0.13：教育で子の成長が加速（§9.4）", () => {
  it("教育した子は未教育の同PA児より速く成長する", () => {
    let s = initGame({ seed: 5 });
    const c1 = buildChild(s, 150, 150, makePRNG(42));
    const c2: Person = { ...buildChild(s, 150, 150, makePRNG(42)), id: "child-B" };
    s = { ...s, people: { ...s.people, [c1.id]: c1, [c2.id]: c2 }, pc: { ...s.pc, childrenIds: [c1.id, c2.id], wealth: 999999 } };
    for (let i = 0; i < 3; i++) { const r = educateChild(s, c1.id); expect(r.ok).toBe(true); s = { ...r.state, ap: 10 }; }
    s = advanceN(s, 8);
    expect(s.people[c1.id].CA).toBeGreaterThan(s.people[c2.id].CA); // 教育児が上
    expect(s.childEducation[c1.id]).toBe(3);
  });
});

describe("v0.13：非回帰（家族は独立サブシステム）", () => {
  it("パッシブ進行は決定論一致（家族未使用でCASHは同一）", () => {
    const a = advanceN(initGame({ seed: 5, archetype: "labor" }), 15);
    const b = advanceN(initGame({ seed: 5, archetype: "labor" }), 15);
    expect(a.company.CASH).toBe(b.company.CASH);
  });

  it("labor/knowledge とも20ターン生存（v0.12 envelope維持）", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const s = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(s.gameOver).toBe(false);
      expect(s.company.CASH).toBeGreaterThan(0);
    }
  });

  it("PCは people に居るが employeeIds/poolIds に含まれない（経営に非干渉）", () => {
    const s = initGame({ seed: 7 });
    expect(s.people[s.pc.personId]).toBeTruthy();
    expect(s.employeeIds.includes(s.pc.personId)).toBe(false);
    expect(s.poolIds.includes(s.pc.personId)).toBe(false);
  });
});
