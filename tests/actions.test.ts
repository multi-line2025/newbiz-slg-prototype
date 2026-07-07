/**
 * アクション（AP消費）とスカウト開示のテスト。
 * スカウト(§4.8)・採用(§4.3)・配属(§4.6)・マーケ投資(§12.4)・引き抜き(§4.12.3)。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import {
  scoutCandidate, hireCandidate, assignRole, setMarketBudget, companyScoutSkill,
} from "../src/core/actions";
import { scoutedView } from "../src/core/scout";
import { poachVulnerability } from "../src/core/turn";
import { poolPeople, employees } from "../src/core/state";

describe("scoutCandidate（段階開示・AP/CASH消費）", () => {
  it("0→1でAP1・$2,000消費し scoutLevel が上がる", () => {
    const s = initGame({ seed: 5 });
    const cand = poolPeople(s)[0];
    const r = scoutCandidate(s, cand.id);
    expect(r.ok).toBe(true);
    expect(r.state.people[cand.id].scoutLevel).toBe(1);
    expect(r.state.ap).toBe(s.ap - 1);
    expect(r.state.company.CASH).toBe(s.company.CASH - 2000);
  });

  it("level0では PA・忠誠は不明（?）、level2で正確値が見える", () => {
    let s = initGame({ seed: 5 });
    const cand = poolPeople(s)[0];
    const skill = companyScoutSkill(s);

    const v0 = scoutedView(s.people[cand.id], skill);
    expect(v0.paKnown).toBeNull();
    expect(v0.paRange).toBeNull();
    expect(v0.caKnown).toBeNull(); // ★未スカウトはCAも不明（オーナー要望）
    expect(v0.occStars).toBeGreaterThanOrEqual(1); // 技能の星は常に見える

    s = scoutCandidate(s, cand.id).state; // →1
    const v1 = scoutedView(s.people[cand.id], skill);
    expect(v1.paRange).not.toBeNull(); // レンジ表示
    // 真値はレンジ内に含まれる
    expect(s.people[cand.id].PA).toBeGreaterThanOrEqual(v1.paRange!.low);
    expect(s.people[cand.id].PA).toBeLessThanOrEqual(v1.paRange!.high);

    expect(v1.caKnown).toBe(s.people[cand.id].CA); // level1でCAは開示

    s = scoutCandidate(s, cand.id).state; // →2
    const v2 = scoutedView(s.people[cand.id], skill);
    expect(v2.paKnown).toBe(s.people[cand.id].PA); // 正確値
  });

  it("誤差は担当スキルが高いほど狭い（レンジ幅が縮む）", () => {
    let s = initGame({ seed: 5 });
    const cand = poolPeople(s)[0];
    s = scoutCandidate(s, cand.id).state;
    const wide = scoutedView(s.people[cand.id], 1); // 無能担当
    const narrow = scoutedView(s.people[cand.id], 20); // 一流担当
    const wWide = wide.paRange!.high - wide.paRange!.low;
    const wNarrow = narrow.paRange!.high - narrow.paRange!.low;
    expect(wNarrow).toBeLessThan(wWide);
  });
});

describe("hireCandidate（採用）", () => {
  it("候補者を雇用し、社員に加わり契約給与が付く", () => {
    const s = initGame({ seed: 7 });
    const cand = poolPeople(s)[0];
    const r = hireCandidate(s, cand.id);
    expect(r.ok).toBe(true);
    expect(r.state.employeeIds).toContain(cand.id);
    expect(r.state.poolIds).not.toContain(cand.id);
    expect(r.state.people[cand.id].contract?.salary).toBe(cand.salaryDemand);
  });
});

describe("assignRole（配属）", () => {
  it("社員のassignedRoleが変わりAPを消費", () => {
    const s = initGame({ seed: 7 });
    const emp = employees(s)[0];
    const r = assignRole(s, emp.id, "marketer");
    expect(r.ok).toBe(true);
    expect(r.state.people[emp.id].assignedRole).toBe("marketer");
    expect(r.state.ap).toBe(s.ap - 1);
  });
  it("社員でない相手には失敗", () => {
    const s = initGame({ seed: 7 });
    const cand = poolPeople(s)[0];
    expect(assignRole(s, cand.id, "engineer").ok).toBe(false);
  });
});

describe("setMarketBudget（製品別チャネル予算・市場§4）", () => {
  it("創業製品の広告予算を$1,000に設定でき、バーンに乗る（AP不要）", () => {
    const s = initGame({ seed: 7 });
    const pid = s.products[0].id;
    const before = s.company.monthlyBurn;
    const r = setMarketBudget(s, pid, "adBudget", 1);
    expect(r.ok).toBe(true);
    expect(r.state.products[0].adBudget).toBe(1000);
    expect(r.state.company.monthlyBurn).toBeGreaterThanOrEqual(before + 1000);
    expect(r.state.ap).toBe(s.ap); // AP消費なし
  });
  it("0未満には下げられない", () => {
    const s = initGame({ seed: 7 });
    expect(setMarketBudget(s, s.products[0].id, "prBudget", -1).ok).toBe(false);
  });
  it("3チャネルは独立に設定できる", () => {
    let s = initGame({ seed: 7 });
    const pid = s.products[0].id;
    s = setMarketBudget(s, pid, "adBudget", 1).state;
    s = setMarketBudget(s, pid, "commBudget", 1).state;
    const p = s.products[0];
    expect(p.adBudget).toBe(1000);
    expect(p.commBudget).toBe(1000);
    expect(p.prBudget).toBe(0);
  });
});

describe("poachVulnerability（引き抜き・§4.12.3）", () => {
  it("低忠誠・高野心・低士気ほど狙われやすい", () => {
    const s = initGame({ seed: 7 });
    const emp = { ...employees(s)[0] };
    // 悪条件を人為的に作る
    const bad = {
      ...emp, morale: 5,
      attributes: {
        ...emp.attributes,
        hidden: { ...emp.attributes.hidden, loyalty: 2 },
        mental: { ...emp.attributes.mental, ambition: 19 },
      },
    };
    const vulnBad = poachVulnerability(bad, 1.0);
    const vulnGood = poachVulnerability(
      { ...bad, morale: 90, attributes: { ...bad.attributes, hidden: { ...bad.attributes.hidden, loyalty: 19 } } },
      1.0
    );
    expect(vulnBad).toBeGreaterThan(vulnGood);
    expect(vulnBad).toBeGreaterThan(0.15); // 発火閾値を超える
  });
});

describe("AP不足で失敗", () => {
  it("APが0だとスカウトできない", () => {
    const s0 = initGame({ seed: 5 });
    const s = { ...s0, ap: 0 };
    const cand = poolPeople(s)[0];
    const r = scoutCandidate(s, cand.id);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s); // 状態は変わらない
  });
});
