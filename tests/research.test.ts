/**
 * 研究・青写真・Era・QUAL反映のテスト（§12.3 / §5.3 / §7.1）。
 */
import { describe, it, expect } from "vitest";
import {
  researchCoeff, rpPerTurn, eraForTurn, obsolescenceFactor, effectiveQualBonus,
  qualCeiling, missionAllows, blueprintStatus, getBlueprint,
} from "../src/core/research";
import { buildPerson } from "../src/core/person";
import { makePRNG } from "../src/core/prng";
import type { Person } from "../src/core/model/types";

/** リサーチ役の社員を作る（research値指定）。 */
function researcher(research: number): Person {
  const p = buildPerson({ PA: 150, age: 30, nationality: "US", era: "internet", jobCategory: "researcher" }, makePRNG(9));
  const attrs = { ...p.attributes, occupational: { ...p.attributes.occupational, research } };
  return { ...p, attributes: attrs, assignedRole: "researcher" };
}

describe("researchCoeff（§12.3 $1,000ごとに+0.1・上限2.0）", () => {
  it("投資0で0、$10,000で1.0、上限2.0", () => {
    expect(researchCoeff(0)).toBe(0);
    expect(researchCoeff(10000)).toBeCloseTo(1.0);
    expect(researchCoeff(30000)).toBe(2.0); // 上限
  });
});

describe("rpPerTurn（§12.3）", () => {
  it("Σ(リサーチ役 research)×0.3×係数。非リサーチ役は寄与しない", () => {
    const emps = [researcher(10), researcher(20)];
    // (10+20)×0.3×researchCoeff(10000=1.0) = 9.0
    expect(rpPerTurn(emps, 10000)).toBeCloseTo(9.0);
    // 投資0なら産出0
    expect(rpPerTurn(emps, 0)).toBe(0);
  });
  it("配属がresearcherでない社員はRPを産まない", () => {
    const eng = buildPerson({ PA: 150, age: 30, nationality: "US", era: "internet", jobCategory: "engineer" }, makePRNG(1));
    expect(rpPerTurn([{ ...eng, assignedRole: "engineer" }], 10000)).toBe(0);
  });
});

describe("eraForTurn（§7.1 ステップ遷移）", () => {
  it("internet開始：ERA_INTERVAL(18)ターンごとに次Eraへ", () => {
    expect(eraForTurn("internet", 1)).toBe("internet");
    expect(eraForTurn("internet", 18)).toBe("internet");
    expect(eraForTurn("internet", 19)).toBe("smartphone");
    expect(eraForTurn("internet", 37)).toBe("ai");
    expect(eraForTurn("internet", 100)).toBe("ai"); // 最終Eraで頭打ち
  });
});

describe("陳腐化・QUAL反映（§7.1）", () => {
  it("obsolescenceFactor：世代差0=1.0 / 1=0.6 / 2以上=0.3", () => {
    const bp101 = getBlueprint("BP-101")!; // internet世代
    expect(obsolescenceFactor(bp101, "internet")).toBe(1.0);
    expect(obsolescenceFactor(bp101, "smartphone")).toBe(0.6);
    expect(obsolescenceFactor(bp101, "ai")).toBe(0.3);
  });
  it("effectiveQualBonus は陳腐化で下がる", () => {
    const bp101 = getBlueprint("BP-101")!; // qualBonus 8
    expect(effectiveQualBonus(bp101, "internet")).toBeCloseTo(8);
    expect(effectiveQualBonus(bp101, "ai")).toBeCloseTo(8 * 0.3);
  });
  it("qualCeiling：解放済み青写真がQUAL上限を押し上げ、Era進行で下がる", () => {
    const now = qualCeiling(["BP-101"], "internet"); // 60+8
    const later = qualCeiling(["BP-101"], "ai"); // 60+8*0.3
    expect(now).toBeCloseTo(68);
    expect(later).toBeLessThan(now);
    expect(qualCeiling([], "internet")).toBe(60); // 青写真なしは基準60
  });
});

describe("ミッション整合（§5.3）", () => {
  it("生成AI(高自動化) は 雇用創出ミッションと衝突しグレーアウト", () => {
    const bp450 = getBlueprint("BP-450")!;
    expect(missionAllows(bp450, ["雇用創出"])).toBe(false);
    expect(missionAllows(bp450, ["成長重視"])).toBe(true); // 衝突なしなら可
  });
  it("タグなし青写真はどのミッションでも整合", () => {
    expect(missionAllows(getBlueprint("BP-101")!, ["雇用創出"])).toBe(true);
  });
});

describe("blueprintStatus（解放判定：前提tier・Era・RP・ミッション）", () => {
  const bp101 = getBlueprint("BP-101")!; // S1 tier1（切符・rpCost=RP_TIER[1]=120）
  const s1t2 = getBlueprint("S1-t2")!; // S1 tier2（前提=BP-101）
  const bp450 = getBlueprint("BP-450")!; // S4 tier1（高自動化）

  it("BP-101(tier1切符)：internetでRP十分（≥120）なら解放可能", () => {
    expect(blueprintStatus(bp101, [], "internet", 120, ["雇用創出"])).toBe("ok");
  });
  it("RP不足なら rp", () => {
    expect(blueprintStatus(bp101, [], "internet", 50, ["雇用創出"])).toBe("rp");
  });
  it("S1-t2：前提tier1(BP-101)未解放なら prereq", () => {
    expect(blueprintStatus(s1t2, [], "internet", 9999, [])).toBe("prereq");
  });
  it("S1-t2：前提tier1済・RP十分で ok（同ブランチ深掘り）", () => {
    expect(blueprintStatus(s1t2, ["BP-101"], "internet", 9999, [])).toBe("ok");
  });
  it("BP-450：雇用創出ミッション下では mission（グレーアウト）", () => {
    expect(blueprintStatus(bp450, [], "ai", 9999, ["雇用創出"])).toBe("mission");
  });
  it("解放済みは unlocked", () => {
    expect(blueprintStatus(bp101, ["BP-101"], "internet", 0, [])).toBe("unlocked");
  });
});
