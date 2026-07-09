/**
 * v0.16 回帰テスト：社長（PC）の実務兼務。
 *  配属可・出力寄与（QUAL/analysisSkill）・employeeIds非会員（給与/poaching対象外）・
 *  apMaxトレードオフ・未配属baseline非回帰。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { assignRole, assignToProduct, releasePC } from "../src/core/actions";
import {
  workforce, employees, effectiveApMax, pcWorking, productTeam,
} from "../src/core/state";
import { computeQualP } from "../src/core/product";
import { analysisSkill } from "../src/core/analysis";
import { sumSalaries } from "../src/core/finance";
import { PC_WORK_AP_PENALTY } from "../src/core/model/constants";
import type { ProtoGameState } from "../src/core/state";

const advanceN = (s: ProtoGameState, n: number) => { for (let i = 0; i < n; i++) s = advanceTurn(s).next; return s; };

describe("v0.16：PCを実務に配属できる（employeeIds非会員のまま）", () => {
  it("assignRole / assignToProduct が PC を特例で受け付ける", () => {
    let s = initGame({ seed: 3, archetype: "knowledge" });
    const pcId = s.pc.personId;
    const r1 = assignRole(s, pcId, "engineer");
    expect(r1.ok).toBe(true);
    s = r1.state;
    expect(s.people[pcId].assignedRole).toBe("engineer");
    const r2 = assignToProduct(s, pcId, s.products[0].id);
    expect(r2.ok).toBe(true);
    s = r2.state;
    expect(s.assignments[pcId]).toBe(s.products[0].id);
    // PCは employeeIds には入らない
    expect(s.employeeIds.includes(pcId)).toBe(false);
  });

  it("PCを製品に配属すると productTeam に含まれ QUAL_p が上がる", () => {
    let s = initGame({ seed: 3, archetype: "knowledge" });
    const prod = s.products[0];
    const before = computeQualP(prod.blueprintId, productTeam(s, prod.id), prod.devTurns, s.era, 1);
    const n0 = productTeam(s, prod.id).length;
    s = assignRole(s, s.pc.personId, "engineer").state;
    s = assignToProduct(s, s.pc.personId, prod.id).state;
    const after = computeQualP(prod.blueprintId, productTeam(s, prod.id), prod.devTurns, s.era, 1);
    expect(productTeam(s, prod.id).length).toBe(n0 + 1); // PCが加わる
    expect(after).toBeGreaterThan(before);              // 出力（QUAL）が上がる
  });

  it("analysisSkill は実務PC（researcher）を含めて上がる", () => {
    const s0 = initGame({ seed: 3 });
    const s = assignRole(s0, s0.pc.personId, "researcher").state;
    expect(analysisSkill(workforce(s))).toBeGreaterThan(analysisSkill(employees(s)));
  });
});

describe("v0.16：給与二重計上・poaching の回避", () => {
  it("実務中のPCは給与ループ（sumSalaries）に含まれない＝役員報酬のみ（二重計上なし）", () => {
    let s = initGame({ seed: 3, archetype: "knowledge" });
    const base = sumSalaries(s);
    s = assignRole(s, s.pc.personId, "engineer").state;
    expect(sumSalaries(s)).toBe(base); // PCを配属しても社員給与合計は不変
    expect(s.employeeIds.includes(s.pc.personId)).toBe(false);
  });

  it("workforce は実務PCを含み、employees は含まない", () => {
    let s = initGame({ seed: 3 });
    expect(workforce(s).length).toBe(employees(s).length); // 未配属は一致
    s = assignRole(s, s.pc.personId, "engineer").state;
    expect(workforce(s).length).toBe(employees(s).length + 1); // 配属で+1
    expect(employees(s).some((e) => e.id === s.pc.personId)).toBe(false);
  });
});

describe("v0.16：APトレードオフ", () => {
  it("実務中は apMax が PC_WORK_AP_PENALTY 分下がり、解除で回復する", () => {
    let s = initGame({ seed: 3 });
    expect(effectiveApMax(s)).toBe(s.apMax);
    s = assignRole(s, s.pc.personId, "engineer").state;
    expect(pcWorking(s)).toBe(true);
    expect(effectiveApMax(s)).toBe(s.apMax - PC_WORK_AP_PENALTY);
    // ターン開始時のAPも下限に回復
    s = advanceTurn(s).next;
    expect(s.ap).toBe(s.apMax - PC_WORK_AP_PENALTY);
    // 解除で回復
    s = releasePC(s).state;
    expect(pcWorking(s)).toBe(false);
    expect(effectiveApMax(s)).toBe(s.apMax);
    s = advanceTurn(s).next;
    expect(s.ap).toBe(s.apMax);
  });

  it("releasePC は製品配属も解除する", () => {
    let s = initGame({ seed: 3 });
    s = assignRole(s, s.pc.personId, "engineer").state;
    s = assignToProduct(s, s.pc.personId, s.products[0].id).state;
    s = releasePC(s).state;
    expect(s.people[s.pc.personId].assignedRole).toBeNull();
    expect(s.assignments[s.pc.personId]).toBeUndefined();
  });
});

describe("v0.16：非回帰（未配属＝baseline完全一致）", () => {
  it("PC未配属なら apMax/workforce/productTeam は現状通り", () => {
    const s = initGame({ seed: 3, archetype: "labor" });
    expect(effectiveApMax(s)).toBe(s.apMax);
    expect(workforce(s).length).toBe(employees(s).length);
    // 全製品の team に PC が混ざらない
    for (const p of s.products) {
      expect(productTeam(s, p.id).some((m) => m.id === s.pc.personId)).toBe(false);
    }
  });

  it("PC未配属のパッシブ進行は決定論一致（両archetype生存）", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const a = advanceN(initGame({ seed: 3, archetype }), 20);
      const b = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(a.company.CASH).toBe(b.company.CASH);
      expect(a.gameOver).toBe(false);
      expect(a.company.CASH).toBeGreaterThan(0);
    }
  });
});
