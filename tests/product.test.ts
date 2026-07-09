/**
 * 製品QUAL_p（青写真ごとの製品品質）のテスト（§2）。
 */
import { describe, it, expect } from "vitest";
import { computeQualP, teamAbility, devMaturity, eraFit, tierCap } from "../src/core/product";
import { getBlueprint, sectorTier, breadthDepth, BLUEPRINTS } from "../src/core/research";
import { productCompetitiveness } from "../src/core/market";
import { buildPerson } from "../src/core/person";
import { makePRNG } from "../src/core/prng";
import { QUAL_TIER_CAP } from "../src/core/model/constants";
import type { Person } from "../src/core/model/types";
import type { ProtoCompany } from "../src/core/state";

/** 職種・配属・能力を指定した社員（稼働満点になるようcondition高め）。 */
function emp(job: Person["jobCategory"], role: Person["assignedRole"], occ: Partial<Record<string, number>>): Person {
  const p = buildPerson({ PA: 180, age: 30, nationality: "US", era: "internet", jobCategory: job }, makePRNG(5));
  return {
    ...p, assignedRole: role,
    attributes: {
      ...p.attributes,
      occupational: { ...p.attributes.occupational, ...occ },
      condition: { stamina: 20, stressResist: 20, health: 20 },
      mental: { ...p.attributes.mental, creativity: 15, vision: 15 },
    },
  };
}

describe("teamAbility（§2.3-1 チーム合成）", () => {
  it("配属者0人なら0（その製品は作れない）", () => {
    expect(teamAbility([], "engineer", "engineering")).toBe(0);
  });
  it("エース1人でも成立、頭数が増えると上がる", () => {
    const one = teamAbility([emp("engineer", "engineer", { engineering: 16 })], "engineer", "engineering");
    const two = teamAbility(
      [emp("engineer", "engineer", { engineering: 16 }), emp("engineer", "engineer", { engineering: 14 })],
      "engineer", "engineering"
    );
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one * 0.6); // 2番手が加算される
  });
});

describe("computeQualP（§2.3-5 製品QUAL）", () => {
  it("福祉(BP-510)はセールスのsalesで決まる（design/engは無関係）", () => {
    const salesTeam = [emp("sales", "sales", { sales: 18 })];
    const engTeam = [emp("engineer", "engineer", { engineering: 18 })];
    const qWithSales = computeQualP("BP-510", salesTeam, 6, "internet");
    const qWithEng = computeQualP("BP-510", engTeam, 6, "internet");
    expect(qWithSales).toBeGreaterThan(qWithEng); // 福祉はセールスが効く
    expect(qWithEng).toBe(0); // sales/management配属なし → QUAL_p 立たず
  });
  it("生成AI(BP-450)はリサーチのresearchが主", () => {
    const q = computeQualP("BP-450", [emp("researcher", "researcher", { research: 18, engineering: 12 })], 6, "ai");
    expect(q).toBeGreaterThan(0);
  });
  it("能力が高い担当ほど高QUAL_p", () => {
    const low = computeQualP("BP-510", [emp("sales", "sales", { sales: 6 })], 6, "internet");
    const high = computeQualP("BP-510", [emp("sales", "sales", { sales: 18 })], 6, "internet");
    expect(high).toBeGreaterThan(low);
  });
  it("担当0人なら QUAL_p = 0", () => {
    expect(computeQualP("BP-620", [], 6, "internet")).toBe(0);
  });
});

describe("devMaturity / eraFit（§2.3-4）", () => {
  it("devMaturity は devTurns 蓄積で 0.5→1.0", () => {
    expect(devMaturity(0)).toBeCloseTo(0.5);
    expect(devMaturity(6)).toBeCloseTo(1.0);
    expect(devMaturity(3)).toBeGreaterThan(0.5);
  });
  it("eraFit：古い青写真ほどEra差で頭打ち（陳腐化）", () => {
    const bp = getBlueprint("BP-101")!; // internet世代
    expect(eraFit(bp, "internet")).toBeCloseTo(1.0);
    expect(eraFit(bp, "smartphone")).toBeCloseTo(0.85);
    expect(eraFit(bp, "ai")).toBeCloseTo(0.85 * 0.85);
  });
  it("同じチームでも開発ターンが浅いとQUAL_pは低い", () => {
    const team = [emp("sales", "sales", { sales: 18 })];
    expect(computeQualP("BP-510", team, 0, "internet")).toBeLessThan(computeQualP("BP-510", team, 6, "internet"));
  });
});

describe("青写真tier：特化 vs 汎用（§5）", () => {
  function makeCompany(over: Partial<ProtoCompany> = {}): ProtoCompany {
    return {
      name: "T", foundedCountry: "US", CASH: 100000, reputation: 20,
      monthlyBurn: 0, runwayTurns: 0, RP_C: 0, researchBudget: 0,
      unlockedBlueprints: [], missionTags: [], THxP_customer: 0, capTable: { totalShares: 1000000, pcShares: 1000000, holders: [] }, ...over,
    };
  }

  it("tierCap：tier1=55（汎用は中品質止まり）…tier4=100（特化で無双）", () => {
    expect(tierCap(1)).toBe(QUAL_TIER_CAP[0]);
    expect(tierCap(4)).toBe(100);
    expect(tierCap(1)).toBeLessThan(tierCap(4));
  });

  it("★QUAL_pはtier天井で頭打ち：エース集めてもtier1はQUAL_TIER_CAP[0]止まり、tier4なら超えられる", () => {
    // 高能力チーム（福祉＝sales）でtier1とtier4を比較
    const team = [emp("sales", "sales", { sales: 20 }), emp("sales", "sales", { sales: 19 }), emp("manager", "manager", { management: 20 })];
    const t1 = computeQualP("BP-510", team, 6, "internet", 1);
    const t4 = computeQualP("BP-510", team, 6, "internet", 4);
    expect(t1).toBeLessThanOrEqual(QUAL_TIER_CAP[0] + 1e-6); // tier1天井(62)
    expect(t4).toBeGreaterThan(t1); // 特化で天井が上がる
  });

  it("特化ボーナス：tierが深いほど C_p が上がる（§5.2）", () => {
    const c = makeCompany();
    const t1 = productCompetitiveness(70, [], c, 1);
    const t4 = productCompetitiveness(70, [], c, 4);
    expect(t4).toBeGreaterThan(t1); // +SPEC_CP_K×3
  });

  it("展開ラグ：tierが深いほど devMaturity の立ち上げが速い（§5.2）", () => {
    expect(devMaturity(3, 4)).toBeGreaterThan(devMaturity(3, 1));
  });

  it("sectorTier / breadthDepth：保有ノードの最深tier・切符セクター数", () => {
    expect(sectorTier("S1", ["BP-101", "S1-t2"])).toBe(2);
    expect(sectorTier("S1", [])).toBe(0);
    const bd = breadthDepth(["BP-101", "BP-620", "S1-t2", "S1-t3"]);
    expect(bd.breadth).toBe(2); // S1・S5の切符
    expect(bd.depth).toBe(3); // S1の最深tier3
  });

  it("全ブランチが tier1〜4 の連鎖を持つ（知識6セクター×4＝24ノード＋労働1＝計25）", () => {
    expect(BLUEPRINTS.length).toBe(25); // v0.8：労働集約BP-700を追加
    const knowledge = BLUEPRINTS.filter((b) => b.archetype === "knowledge");
    expect(knowledge.length).toBe(24);
    for (const sec of ["S1", "S2", "S3", "S4", "S5", "S6"] as const) {
      const tiers = knowledge.filter((b) => b.targetSector === sec).map((b) => b.tier).sort();
      expect(tiers).toEqual([1, 2, 3, 4]);
    }
  });
});
