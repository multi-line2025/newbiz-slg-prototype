/**
 * v0.18 回帰テスト：世代交代（後継者指定・引退・PC死亡・succeed相続/関係再マップ・家族雇用・非回帰）。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { designateSuccessor, retire, hireFamily } from "../src/core/actions";
import { buildChild, validSuccessor, isHireableFamily, isFamilyMember } from "../src/core/family";
import { makePRNG } from "../src/core/prng";
import type { ProtoGameState } from "../src/core/state";
import type { Person } from "../src/core/model/types";

const advanceN = (s: ProtoGameState, n: number) => { for (let i = 0; i < n; i++) s = advanceTurn(s).next; return s; };

/** 成人2名＋未成年1名の実子を持つ状態を作る。 */
function withChildren(s: ProtoGameState): ProtoGameState {
  const c1: Person = { ...buildChild(s, 160, 120, makePRNG(1)), id: "kid-1", age: 22, CA: 90 };
  const c2: Person = { ...buildChild(s, 140, 110, makePRNG(2)), id: "kid-2", age: 19, CA: 70 };
  const c3: Person = { ...buildChild(s, 120, 100, makePRNG(3)), id: "kid-3", age: 12, CA: 20 };
  return {
    ...s,
    people: { ...s.people, [c1.id]: c1, [c2.id]: c2, [c3.id]: c3 },
    pc: { ...s.pc, childrenIds: [c1.id, c2.id, c3.id] },
  };
}

describe("v0.18：後継者指定", () => {
  it("18歳以上の実子のみ指定可・未満は不可・トグル解除", () => {
    let s = withChildren(initGame({ seed: 7 }));
    expect(designateSuccessor(s, "kid-3").ok).toBe(false); // 12歳 → 不可
    const r = designateSuccessor(s, "kid-1"); // 22歳 → 可
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.pc.successorId).toBe("kid-1");
    expect(validSuccessor(s)?.id).toBe("kid-1");
    // 同じ子を再指定 → 解除
    s = designateSuccessor(s, "kid-1").state;
    expect(s.pc.successorId).toBeNull();
  });

  it("実子でない相手は指定不可", () => {
    const s = withChildren(initGame({ seed: 7 }));
    const emp = s.employeeIds[0];
    expect(designateSuccessor(s, emp).ok).toBe(false);
  });
});

describe("v0.18：引退→世代交代 or 終了", () => {
  it("後継者あり→世代交代（新PC=その子・gen++・wealth相続・会社継続・兄弟姉妹化・独身）", () => {
    let s = withChildren(initGame({ seed: 7, archetype: "knowledge" }));
    s = designateSuccessor(s, "kid-1").state;
    const gen0 = s.pc.generation, cash0 = s.company.CASH, wealth0 = s.pc.wealth, oldPc = s.pc.personId;
    const r = retire(s);
    expect(r.ok).toBe(true);
    const n = r.state;
    expect(n.gameOver).toBe(false);
    expect(n.pc.personId).toBe("kid-1");              // 新PC=後継
    expect(n.pc.generation).toBe(gen0 + 1);           // 世代++
    expect(n.pc.wealth).toBe(wealth0);                // 家督相続
    expect(n.company.CASH).toBe(cash0);               // 会社は継続
    expect(n.people[oldPc]).toBeUndefined();          // 前PCは故人
    expect(n.pc.siblingIds).toContain("kid-2");       // 他の子＝兄弟姉妹
    expect(n.people["kid-2"].relationToPC).toBe("relative");
    expect(n.pc.spouseId).toBeNull();                 // 独身スタート
    expect(n.pc.childrenIds.length).toBe(0);
    expect(n.pc.successorId).toBeNull();
    expect(n.people["kid-1"].relationToPC).toBe("none"); // 主人公化
  });

  it("後継者なし→ゲーム終了（gameOver）", () => {
    const s = initGame({ seed: 7 });
    const r = retire(s);
    expect(r.state.gameOver).toBe(true);
    expect(r.state.endTurn).toBe(s.turn);
  });

  it("世代交代後、新PCが社員だった場合は employeeIds から外れる", () => {
    let s = withChildren(initGame({ seed: 7 }));
    s = hireFamily(s, "kid-1").state;           // 後継候補を先に社員化
    expect(s.employeeIds).toContain("kid-1");
    s = designateSuccessor(s, "kid-1").state;
    const r = retire(s);
    expect(r.state.employeeIds).not.toContain("kid-1"); // 主人公化で社員から外れる
  });
});

describe("v0.18：PC死亡（寿命）→世代交代 or 終了", () => {
  it("age>=lifeExpectancy で死亡→後継者ありは世代交代", () => {
    let s = withChildren(initGame({ seed: 7 }));
    s = designateSuccessor(s, "kid-1").state;
    const pcId = s.pc.personId;
    s = { ...s, people: { ...s.people, [pcId]: { ...s.people[pcId], age: s.people[pcId].lifeExpectancy + 1 } } };
    const r = advanceTurn(s);
    expect(r.events.some((e) => e.includes("天寿"))).toBe(true);
    expect(r.next.pc.generation).toBe(2);
    expect(r.next.gameOver).toBe(false);
  });

  it("age>=lifeExpectancy で死亡→後継者なしはゲーム終了", () => {
    let s = initGame({ seed: 7 });
    const pcId = s.pc.personId;
    s = { ...s, people: { ...s.people, [pcId]: { ...s.people[pcId], age: s.people[pcId].lifeExpectancy + 1 } } };
    const r = advanceTurn(s);
    expect(r.next.gameOver).toBe(true);
  });
});

describe("v0.18：家族の即雇用・常時可視", () => {
  it("18歳以上の実子/兄弟姉妹を評判ゲート・3ターン不要で即入社", () => {
    let s = withChildren(initGame({ seed: 7 }));
    expect(isHireableFamily(s, "kid-2")).toBe(true);  // 19歳
    expect(isHireableFamily(s, "kid-3")).toBe(false); // 12歳
    const r = hireFamily(s, "kid-2");
    expect(r.ok).toBe(true);
    expect(r.state.employeeIds).toContain("kid-2"); // 即入社（pendingHires経由でない）
    expect(r.state.pendingHires.length).toBe(0);
    expect(r.state.people["kid-2"].contract?.type).toBe("fulltime");
  });

  it("兄弟姉妹（世代交代後）も直接雇用できる", () => {
    let s = withChildren(initGame({ seed: 7 }));
    s = designateSuccessor(s, "kid-1").state;
    s = retire(s).state; // kid-1が新PC、kid-2/kid-3が兄弟姉妹
    expect(s.pc.siblingIds).toContain("kid-2");
    const r = hireFamily(s, "kid-2");
    expect(r.ok).toBe(true);
    expect(r.state.employeeIds).toContain("kid-2");
  });

  it("家族メンバーは常時可視の対象（isFamilyMember）", () => {
    const s = withChildren(initGame({ seed: 7 }));
    expect(isFamilyMember(s, "kid-1")).toBe(true);
    expect(isFamilyMember(s, s.employeeIds[0])).toBe(false);
  });
});

describe("v0.18：非回帰（世代交代未使用＝baseline一致）", () => {
  it("20ターンでは死亡が発火せず、両archetypeが生存・決定論一致", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const a = advanceN(initGame({ seed: 3, archetype }), 20);
      const b = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(a.company.CASH).toBe(b.company.CASH);
      expect(a.gameOver).toBe(false);
      expect(a.pc.generation).toBe(1); // 世代交代は起きない
    }
  });
});
