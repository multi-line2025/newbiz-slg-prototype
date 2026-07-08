/**
 * 研究アクション＆ターン統合のテスト（v0.3）。
 * 「研究投資→RP_C蓄積→青写真解放→QUAL上昇」のループを検証。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { setResearchBudget, unlockBlueprint, assignRole, hireCandidate } from "../src/core/actions";
import { poolPeople } from "../src/core/state";
import type { ProtoGameState } from "../src/core/state";

/** リサーチャーを1名雇い researcher に配属した状態を作る。
 *  v0.10：採用は評判ゲート（無名企業 rep10 → PA<=120 のみ採用可）なので、雇える候補を選ぶ。 */
function withResearcher(s: ProtoGameState): ProtoGameState {
  const hireable = poolPeople(s).filter((p) => p.PA <= 120);
  const cand = hireable.find((p) => p.jobCategory === "researcher") ?? hireable[0];
  s = hireCandidate(s, cand.id).state;
  s = assignRole(s, cand.id, "researcher").state;
  return s;
}

describe("setResearchBudget", () => {
  it("研究予算を増減でき、バーンに乗る", () => {
    const s = initGame({ seed: 3 });
    const before = s.company.monthlyBurn;
    const r = setResearchBudget(s, 1);
    expect(r.ok).toBe(true);
    expect(r.state.company.researchBudget).toBe(1000);
    // 次ターンでバーンに反映
    const adv = advanceTurn(r.state).next;
    expect(adv.company.monthlyBurn).toBeGreaterThanOrEqual(before + 1000);
  });
  it("0未満には下げられない", () => {
    const s = initGame({ seed: 3 });
    expect(setResearchBudget(s, -1).ok).toBe(false);
  });
});

describe("RP_C蓄積（ターン進行）", () => {
  it("リサーチャー配属＋研究投資ありでRP_Cが増える", () => {
    let s = initGame({ seed: 3 });
    s = withResearcher(s);
    s = setResearchBudget(s, 1).state; // $1,000
    s = setResearchBudget(s, 1).state; // $2,000
    const rp0 = s.company.RP_C;
    for (let i = 0; i < 5; i++) s = advanceTurn(s).next;
    expect(s.company.RP_C).toBeGreaterThan(rp0);
  });
  it("研究投資0ならRP_Cは増えない", () => {
    let s = initGame({ seed: 3 });
    s = withResearcher(s); // 予算0のまま
    for (let i = 0; i < 5; i++) s = advanceTurn(s).next;
    expect(s.company.RP_C).toBe(0);
  });
});

describe("unlockBlueprint → 新セクターの切符", () => {
  it("RP十分ならBP-101(tier1)を解放（RP消費120・S1市場に出せる）", () => {
    let s = initGame({ seed: 3 });
    s = { ...s, company: { ...s.company, RP_C: 200 } };
    const r = unlockBlueprint(s, "BP-101");
    expect(r.ok).toBe(true);
    expect(r.state.company.unlockedBlueprints).toContain("BP-101");
    expect(r.state.company.RP_C).toBe(200 - 120); // RP_TIER[1]=120
    expect(r.message).toContain("S1");
  });

  it("ミッション衝突（雇用創出）のBP-450(S4切符)は解放できない", () => {
    let s = initGame({ seed: 3 });
    s = { ...s, era: "ai", company: { ...s.company, RP_C: 9999 } };
    const r = unlockBlueprint(s, "BP-450");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("ミッション");
  });

  it("前提tier未達なら深掘りできない（S1-t2はBP-101が前提）", () => {
    let s = initGame({ seed: 3 });
    s = { ...s, company: { ...s.company, RP_C: 9999 } };
    expect(unlockBlueprint(s, "S1-t2").ok).toBe(false); // BP-101(tier1)未解放
  });
});

describe("創業製品の存在", () => {
  it("初期状態でBP-620(EC)を保有し、S5市場に創業製品がある", () => {
    const s = initGame({ seed: 3 });
    expect(s.company.unlockedBlueprints).toContain("BP-620");
    expect(s.products.some((p) => p.sector === "S5")).toBe(true);
  });
});
