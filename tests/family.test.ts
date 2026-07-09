/**
 * v0.13/v0.14 回帰テスト：個人キャリア＆家族。
 *  評判釣り合いゲート／妊娠→出産・PA継承／教育／子の姓継承／子作りトグル／PC給与／
 *  結婚市場（規模・動的・評判分布・fog+スカウト）／配偶者インカム／非回帰。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import {
  courtCandidate, proposeMarriage, educateChild, scoutMarriageCandidate, setTryForChild,
} from "../src/core/actions";
import {
  fertility, repMatchProbability, eligiblePartners, inheritPA, isBloodRelated, pcPerson, buildChild,
  currentLover, marriageView, surnameOf, spouseIncome, pcSalary, companyAffordability, lifestyleCost,
} from "../src/core/family";
import { baseSalary, effectiveSalary } from "../src/core/salary";
import { makePRNG } from "../src/core/prng";
import { GESTATION_TURNS, MARRIAGE_POOL_SIZE, SPOUSE_CONTRIB } from "../src/core/model/constants";
import type { ProtoGameState } from "../src/core/state";
import type { Person } from "../src/core/model/types";

const advanceN = (s: ProtoGameState, n: number) => { for (let i = 0; i < n; i++) s = advanceTurn(s).next; return s; };

/** PCを、若い異性の結婚市場候補と即結婚させ、子作りONにした状態を作る（birth検証用）。 */
function forceMarry(s: ProtoGameState, targetAge = 26): ProtoGameState {
  const cand = eligiblePartners(s).find((p) => p.age >= 20 && p.age <= 35) ?? eligiblePartners(s)[0];
  const partner: Person = { ...cand, age: targetAge, relationToPC: "spouse" };
  return {
    ...s,
    people: { ...s.people, [partner.id]: partner },
    marriagePool: s.marriagePool.filter((p) => p.id !== partner.id),
    pc: { ...s.pc, spouseId: partner.id },
    tryForChild: true, // v0.14：子作りON
  };
}

describe("v0.13：妊孕性 fertility(age, sex)（§9.3.1）", () => {
  it("ピーク25歳・女性40歳/男性60歳でゼロ・加齢で低下・男性の窓が広い", () => {
    expect(fertility(25, "female")).toBeCloseTo(1, 5);
    expect(fertility(15, "female")).toBe(0);
    expect(fertility(40, "female")).toBe(0);
    expect(fertility(60, "male")).toBe(0);
    expect(fertility(30, "female")).toBeGreaterThan(fertility(38, "female"));
    expect(fertility(30, "male")).toBeGreaterThan(fertility(55, "male"));
    expect(fertility(35, "male")).toBeGreaterThan(fertility(35, "female")); // 男性側の窓が広い
  });
});

describe("v0.13：★評判の釣り合いゲート（§C）", () => {
  it("評判差が小さいほど成立確率が高く、閾値超で不可(0)", () => {
    expect(repMatchProbability(50, 50)).toBeCloseTo(1, 5);
    expect(repMatchProbability(50, 30)).toBeGreaterThan(0);
    expect(repMatchProbability(50, 30)).toBeLessThan(1);
    expect(repMatchProbability(50, 10)).toBe(0);
    expect(repMatchProbability(90, 20)).toBe(0);
  });

  it("PC評判が上がると高評判の相手が“釣り合う”（進行報酬）", () => {
    expect(repMatchProbability(20, 60)).toBe(0);
    expect(repMatchProbability(45, 60)).toBeGreaterThan(0);
  });

  it("評判が離れすぎた相手には求愛が不可（ok:false・PA等は露出しない）", () => {
    let s = initGame({ seed: 7 });
    const far = eligiblePartners(s)[0];
    s = { ...s, marriagePool: s.marriagePool.map((p) => (p.id === far.id ? { ...p, reputation: 95, scoutLevel: 1 } : p)) };
    const r = courtCandidate(s, far.id);
    expect(r.ok).toBe(false);
    expect(/PA\d|PA \d|到達上限/.test(r.message)).toBe(false);
  });

  it("血族婚は不可（§9.3.3）：同一bloodlineの相手は対象外＆求愛不可", () => {
    let s = initGame({ seed: 7 });
    const cand = eligiblePartners(s)[0];
    const rel: Person = { ...cand, bloodlineId: s.pc.bloodlineId };
    s = { ...s, marriagePool: s.marriagePool.map((p) => (p.id === rel.id ? rel : p)) };
    expect(isBloodRelated(s.pc.bloodlineId, rel)).toBe(true);
    expect(eligiblePartners(s).some((p) => p.id === rel.id)).toBe(false);
    expect(courtCandidate(s, rel.id).ok).toBe(false);
  });

  it("求愛→交際→求婚→結婚（釣り合う相手なら成立する）", () => {
    let s = initGame({ seed: 7 });
    const pc = pcPerson(s);
    const cand = eligiblePartners(s).find((p) => repMatchProbability(pc.reputation, p.reputation) > 0.5)!;
    let becameLover = false;
    for (let i = 0; i < 60 && !becameLover; i++) {
      const r = courtCandidate(s, cand.id); s = r.state;
      becameLover = currentLover(s)?.id === cand.id;
      s = { ...s, ap: 10 };
    }
    expect(becameLover).toBe(true);
    let married = false;
    for (let i = 0; i < 60 && !married; i++) {
      const r = proposeMarriage(s, cand.id); if (r.ok) s = r.state;
      married = s.pc.spouseId === cand.id;
      s = { ...s, ap: 10, pc: { ...s.pc, wealth: 30000 } };
    }
    expect(married).toBe(true);
    expect(s.people[cand.id]?.relationToPC).toBe("spouse"); // 配偶者はpeople側へ移る
  });
});

describe("v0.13/14：妊娠→出産・PA継承・姓継承（§9.3）", () => {
  it("子PA＝両親PAの平均±突然変異（1-200）", () => {
    const rng = makePRNG(1);
    for (let i = 0; i < 50; i++) {
      const pa = inheritPA(150, 90, rng);
      expect(pa).toBeGreaterThanOrEqual(120 - 12 - 1);
      expect(pa).toBeLessThanOrEqual(120 + 12 + 1);
    }
  });

  it("結婚後（子作りON）約12ターンで0歳児が誕生し bloodline継承・後継者候補・PC姓を継承", () => {
    let s = forceMarry(initGame({ seed: 7 }), 26);
    const pcSurname = surnameOf(pcPerson(s).name);
    let born = false;
    for (let t = 0; t < 40 && !born; t++) { s = advanceTurn(s).next; born = s.pc.childrenIds.length > 0; }
    expect(born).toBe(true);
    const child = s.people[s.pc.childrenIds[0]];
    expect(child.age).toBeLessThan(1);
    expect(child.bloodlineId).toBe(s.pc.bloodlineId);
    expect(child.isSuccessorCandidate).toBe(true);
    expect(child.relationToPC).toBe("child");
    expect(surnameOf(child.name)).toBe(pcSurname); // ★子の姓＝PCの姓
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
    expect(bornTurn! - conceivedTurn!).toBeGreaterThanOrEqual(GESTATION_TURNS - 1);
    expect(bornTurn! - conceivedTurn!).toBeLessThanOrEqual(GESTATION_TURNS + 1);
  });

  it("受胎は男女双方の妊孕性が必須（片方0＝高齢で妊娠しない）", () => {
    let s = forceMarry(initGame({ seed: 7 }), 45); // 配偶者45歳
    const pc = pcPerson(s);
    if (pc.sex === "female") s = { ...s, people: { ...s.people, [pc.id]: { ...pc, age: 42 } } }; // PC女性も40超に
    s = advanceN(s, 20);
    expect(s.pc.childrenIds.length).toBe(0); // 妊孕性0の側があると受胎しない
  });

  it("子作りOFF（既定）では妊娠しない", () => {
    let s = forceMarry(initGame({ seed: 7 }), 26);
    s = setTryForChild(s, false).state;
    s = advanceN(s, 20);
    expect(s.pregnancy).toBeNull();
    expect(s.pc.childrenIds.length).toBe(0);
  });
});

describe("v0.14：子の姓は多世代で一貫", () => {
  it("buildChild は常にPC姓を付与（世代をまたいでも一貫）", () => {
    const s = initGame({ seed: 5 });
    const child = buildChild(s, 150, 120, makePRNG(3));
    expect(surnameOf(child.name)).toBe(surnameOf(pcPerson(s).name));
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
    expect(s.people[c1.id].CA).toBeGreaterThan(s.people[c2.id].CA);
    expect(s.childEducation[c1.id]).toBe(3);
  });
});

describe("v0.14：結婚市場（規模・評判分布・動的・fog+スカウト）", () => {
  it("常時多数の候補（評判0-100分布）＝ゲーム後半でも釣り合う相手がいる", () => {
    let s = initGame({ seed: 7 });
    expect(s.marriagePool.length).toBe(MARRIAGE_POOL_SIZE);
    const reps = s.marriagePool.map((p) => p.reputation);
    expect(Math.min(...reps)).toBeLessThan(30);
    expect(Math.max(...reps)).toBeGreaterThan(70);
    const pc = pcPerson(s);
    s = { ...s, people: { ...s.people, [pc.id]: { ...pc, reputation: 50 } } };
    expect(eligiblePartners(s).some((p) => repMatchProbability(50, p.reputation) > 0)).toBe(true);
  });

  it("毎ターン動的に入れ替わる（非loverの一部が退出・新規登場）", () => {
    let s = initGame({ seed: 7 });
    const before = new Set(s.marriagePool.map((p) => p.id));
    s = advanceN(s, 3);
    const after = s.marriagePool.map((p) => p.id);
    expect(after.length).toBe(MARRIAGE_POOL_SIZE);
    expect(after.filter((id) => before.has(id)).length).toBeLessThan(MARRIAGE_POOL_SIZE);
  });

  it("fog：未スカウトは評判バンドのみ・能力非開示／スカウトで正確な評判＋CA/PA開示", () => {
    let s = initGame({ seed: 7 });
    const cand = eligiblePartners(s)[0];
    const before = marriageView(s.marriagePool.find((p) => p.id === cand.id)!);
    expect(before.scouted).toBe(false);
    expect(before.repExact).toBeNull();
    expect(before.ca).toBeNull();
    const r = scoutMarriageCandidate(s, cand.id); s = r.state;
    expect(r.ok).toBe(true);
    const after = marriageView(s.marriagePool.find((p) => p.id === cand.id)!);
    expect(after.scouted).toBe(true);
    expect(after.repExact).toBe(s.marriagePool.find((p) => p.id === cand.id)!.reputation);
    expect(after.ca).not.toBeNull();
    expect(after.pa).not.toBeNull();
  });
});

describe("v0.14：個人資産の収支（PC給与・配偶者インカム）", () => {
  it("PC役員報酬が会社CASHから個人資産wealthに移る（毎ターン）", () => {
    let s = initGame({ seed: 7 });
    const w0 = s.pc.wealth;
    const salary = pcSalary(s);
    s = advanceTurn(s).next;
    expect(s.pc.wealth).toBeGreaterThan(w0);
    expect(salary).toBeGreaterThan(0);
  });

  it("配偶者インカムは有能・高評判な伴侶ほど大きい", () => {
    const s = initGame({ seed: 7 });
    const cand = eligiblePartners(s)[0];
    const rich: Person = { ...cand, CA: 180, reputation: 90, relationToPC: "spouse" };
    const poor: Person = { ...cand, id: "sp-poor", CA: 40, reputation: 10, relationToPC: "spouse" };
    const sRich = { ...s, people: { ...s.people, [rich.id]: rich }, pc: { ...s.pc, spouseId: rich.id } };
    const sPoor = { ...s, people: { ...s.people, [poor.id]: poor }, pc: { ...s.pc, spouseId: poor.id } };
    expect(spouseIncome(sRich)).toBeGreaterThan(spouseIncome(sPoor));
    expect(spouseIncome(sPoor)).toBeGreaterThan(0);
  });
});

describe("v0.14：非回帰（家族は独立・PC給与は控えめ）", () => {
  it("パッシブ進行は決定論一致（CASHは同一）", () => {
    const a = advanceN(initGame({ seed: 5, archetype: "labor" }), 15);
    const b = advanceN(initGame({ seed: 5, archetype: "labor" }), 15);
    expect(a.company.CASH).toBe(b.company.CASH);
  });

  it("labor/knowledge とも20ターン生存（PC給与計上込み）", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const s = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(s.gameOver).toBe(false);
      expect(s.company.CASH).toBeGreaterThan(0);
    }
  });

  it("PCは people に居るが employeeIds/poolIds/marriagePool に含まれない", () => {
    const s = initGame({ seed: 7 });
    expect(s.people[s.pc.personId]).toBeTruthy();
    expect(s.employeeIds.includes(s.pc.personId)).toBe(false);
    expect(s.poolIds.includes(s.pc.personId)).toBe(false);
    expect(s.marriagePool.some((p) => p.id === s.pc.personId)).toBe(false);
  });
});

describe("v0.15：社員給与テーブルと一貫した個人経済", () => {
  it("PC報酬＝ manager給与(PC.CA) × 会社の支払い能力（社員給与と桁が揃う）", () => {
    const s = initGame({ seed: 3 });
    const pc = pcPerson(s);
    const managerBase = baseSalary("manager", pc.CA);
    const aff = companyAffordability(s);
    expect(aff).toBeGreaterThan(0);
    expect(aff).toBeLessThanOrEqual(1);
    expect(pcSalary(s)).toBe(Math.round(managerBase * aff));
    // 旧マジック値$400ではなく、社員manager給与スケール由来で桁が上がっている
    expect(pcSalary(s)).toBeGreaterThan(400);
  });

  it("支払い能力は会社の成長（CASH・評判・規模）で上がる", () => {
    const s = initGame({ seed: 3 });
    const small = companyAffordability(s);
    const grown = companyAffordability({
      ...s,
      company: { ...s.company, CASH: 400000, reputation: 70 },
      employeeIds: Array.from({ length: 15 }, (_, i) => `e${i}`),
    } as ProtoGameState);
    expect(grown).toBeGreaterThan(small);
    expect(grown).toBeCloseTo(1, 1); // 成長で満額に近づく
  });

  it("配偶者インカム＝ effectiveSalary(職種,CA,忠誠,国)×拠出率×評判プレミアム（実給与スケール）", () => {
    const s = initGame({ seed: 7 });
    const cand = eligiblePartners(s)[0];
    const sp: Person = { ...cand, CA: 130, reputation: 0, relationToPC: "spouse" };
    const st = { ...s, people: { ...s.people, [sp.id]: sp }, pc: { ...s.pc, spouseId: sp.id } };
    const wage = effectiveSalary(sp.jobCategory, sp.CA, sp.attributes.hidden.loyalty, "US");
    expect(spouseIncome(st)).toBe(Math.round(wage * SPOUSE_CONTRIB * 1)); // rep0→プレミアム0
    expect(spouseIncome(st)).toBeGreaterThan(1000); // 中堅配偶者で$1,000超＝実給与スケール
  });

  it("配偶者インカムは能力(CA)・評判に単調増加（高望みの見返り）", () => {
    const s = initGame({ seed: 7 });
    const cand = eligiblePartners(s)[0];
    const inc = (ca: number, rep: number) => {
      const sp: Person = { ...cand, id: `sp-${ca}-${rep}`, CA: ca, reputation: rep, relationToPC: "spouse" };
      return spouseIncome({ ...s, people: { ...s.people, [sp.id]: sp }, pc: { ...s.pc, spouseId: sp.id } });
    };
    expect(inc(150, 50)).toBeGreaterThan(inc(60, 50));  // CAで増加
    expect(inc(130, 90)).toBeGreaterThan(inc(130, 10)); // 評判で増加
  });

  it("既婚（中堅配偶者）は教育を毎ターン続けても個人資産が枯渇しない", () => {
    let s = initGame({ seed: 7, archetype: "labor" });
    const cand = eligiblePartners(s).find((p) => p.CA >= 100) ?? eligiblePartners(s)[0];
    const spouse: Person = { ...cand, age: 28, CA: 130, reputation: 55, relationToPC: "spouse" };
    const child = buildChild(s, 150, 130, makePRNG(5));
    s = {
      ...s,
      people: { ...s.people, [spouse.id]: spouse, [child.id]: child },
      pc: { ...s.pc, spouseId: spouse.id, childrenIds: [child.id] },
      marriagePool: s.marriagePool.filter((p) => p.id !== spouse.id),
    };
    const w0 = s.pc.wealth;
    for (let t = 0; t < 15; t++) { const r = educateChild(s, child.id); if (r.ok) s = r.state; s = advanceTurn(s).next; }
    expect(s.childEducation[child.id]).toBe(15); // 毎ターン教育できた
    expect(s.pc.wealth).toBeGreaterThan(w0);     // それでも資産は枯渇せず増える
  });

  it("独身でも役員報酬−生活費で個人資産が緩やかに増える", () => {
    let s = initGame({ seed: 7 });
    const w0 = s.pc.wealth;
    s = advanceN(s, 5);
    expect(s.pc.wealth).toBeGreaterThan(w0);
    expect(pcSalary(s)).toBeGreaterThan(lifestyleCost(s)); // 報酬 > 生活費
  });
});
