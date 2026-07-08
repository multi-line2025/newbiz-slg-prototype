/**
 * 労働集約型業態（v0.8）の回帰テスト。
 *  ①労働産出モデル（頭数×基礎資質の線形和） ②computeQualP/productCompetitiveness の業態分岐
 *  ③開始業態選択（initGame archetype 分岐） ④評判ゲート改定（reachablePaMax）
 */
import { describe, it, expect } from "vitest";
import {
  baseAptitude, laborThroughput, mgmtMult, laborCapacity, computeQualPLabor, computeQualP,
} from "../src/core/product";
import { productCompetitiveness } from "../src/core/market";
import { reachablePaMax } from "../src/core/talentPool";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { productTeam } from "../src/core/state";
import { getBlueprint } from "../src/core/research";
import { buildPerson } from "../src/core/person";
import { makePRNG } from "../src/core/prng";
import { LABOR_QUAL_BASE, LABOR_TIER_CAP } from "../src/core/model/constants";
import type { Person } from "../src/core/model/types";
import type { ProtoCompany } from "../src/core/state";

/** 労働資質（stamina/health/teamwork/consistency）とmanagementを指定した“作業員”。 */
function worker(opts: { apt?: number; mgmt?: number; cons?: number } = {}): Person {
  const apt = opts.apt ?? 12;
  const p = buildPerson({ PA: 120, age: 30, nationality: "US", era: "internet", jobCategory: "manager" }, makePRNG(9));
  return {
    ...p,
    assignedRole: "manager",
    attributes: {
      ...p.attributes,
      occupational: { ...p.attributes.occupational, management: opts.mgmt ?? 4 },
      condition: { stamina: apt, stressResist: apt, health: apt },
      mental: { ...p.attributes.mental, teamwork: apt },
      hidden: { ...p.attributes.hidden, consistency: opts.cons ?? apt },
    },
  };
}

function makeCompany(rep = 20): ProtoCompany {
  return {
    name: "T", foundedCountry: "US", CASH: 100000, reputation: rep,
    monthlyBurn: 0, runwayTurns: 0, RP_C: 0, researchBudget: 0,
    unlockedBlueprints: [], missionTags: [], THxP_customer: 0,
  };
}

describe("労働産出モデル（§3・頭数×基礎資質）", () => {
  it("baseAptitude は (体力+健康+協調+一貫)/(4×20)。全20で1.0", () => {
    const p = worker({ apt: 20, cons: 20 });
    expect(baseAptitude(p)).toBeCloseTo(1.0, 6);
  });

  it("スループットは頭数に比例して線形に増える（＝頭数が戦力）", () => {
    const one = laborThroughput([worker()]);
    const three = laborThroughput([worker(), worker(), worker()]);
    expect(one).toBeGreaterThan(0);
    expect(three).toBeCloseTo(one * 3, 4); // 同質なら線形和
  });

  it("現場管理(management)が高いほど mgmtMult / laborCapacity が上がる", () => {
    const team = [worker(), worker(), worker()];
    const noMgr = laborCapacity(team);
    const withMgr = laborCapacity([...team, worker({ mgmt: 20 })]);
    expect(mgmtMult([worker({ mgmt: 20 })])).toBeGreaterThan(mgmtMult([worker({ mgmt: 0 })]));
    expect(withMgr).toBeGreaterThan(noMgr); // 頭数増＋まとめ役の乗数
  });

  it("労働QUALは低い床に固定（LABOR_QUAL_BASE〜LABOR_TIER_CAP の範囲）", () => {
    const low = computeQualPLabor([worker({ apt: 4, mgmt: 0, cons: 0 })]);
    const high = computeQualPLabor([worker({ apt: 20, mgmt: 20, cons: 20 })]);
    expect(low).toBeGreaterThanOrEqual(LABOR_QUAL_BASE);
    expect(high).toBeLessThanOrEqual(LABOR_TIER_CAP);
    expect(high).toBeGreaterThan(low);
  });
});

describe("業態分岐（computeQualP / productCompetitiveness）", () => {
  it("computeQualP は労働青写真(BP-700)で労働式・tierに依らない", () => {
    const team = [worker({ apt: 16, cons: 16, mgmt: 8 })];
    const t1 = computeQualP("BP-700", team, 6, "internet", 1);
    const t4 = computeQualP("BP-700", team, 6, "internet", 4);
    expect(t1).toBe(t4); // 労働はtier天井の影響を受けない
    expect(t1).toBe(computeQualPLabor(team));
    expect(t1).toBeLessThanOrEqual(LABOR_TIER_CAP);
  });

  it("BP-700 の archetype は labor、既存青写真は knowledge", () => {
    expect(getBlueprint("BP-700")?.archetype).toBe("labor");
    expect(getBlueprint("BP-620")?.archetype).toBe("knowledge");
  });

  it("productCompetitiveness：労働はlaborCapが大きいほど競争力↑（QUAL/salesに非依存）", () => {
    const c = makeCompany();
    const lo = productCompetitiveness(50, [], c, 1, "labor", 0.5);
    const hi = productCompetitiveness(50, [], c, 1, "labor", 2.0);
    expect(hi).toBeGreaterThan(lo);
    // 同じQUALでも knowledge と labor で式が異なる（別経路）
    const k = productCompetitiveness(50, [], c, 1, "knowledge", 0);
    expect(k).not.toBe(lo);
  });
});

describe("開始業態選択（initGame archetype 分岐）", () => {
  it("labor：業態labor・創業青写真BP-700・6名（現場管理1名含む）", () => {
    const s = initGame({ seed: 7, archetype: "labor" });
    expect(s.archetype).toBe("labor");
    expect(s.products[0].blueprintId).toBe("BP-700");
    expect(s.company.unlockedBlueprints).toContain("BP-700");
    expect(s.employeeIds.length).toBe(6);
    const team = productTeam(s, s.products[0].id);
    expect(team.some((p) => p.jobCategory === "manager")).toBe(true); // 現場管理
  });

  it("knowledge（既定）：業態knowledge・創業青写真BP-620・2名（v0.7.2互換）", () => {
    const s = initGame({ seed: 7 });
    expect(s.archetype).toBe("knowledge");
    expect(s.products[0].blueprintId).toBe("BP-620");
    expect(s.employeeIds.length).toBe(2);
  });

  it("labor開始は序盤で黒字化し20ターン生存する（初心者向け）", () => {
    let s = initGame({ seed: 12345, archetype: "labor" });
    let sawProfit = false;
    for (let t = 1; t <= 20; t++) {
      const before = s.company.CASH;
      s = advanceTurn(s).next;
      if (t > 3 && s.company.CASH - before >= 0) sawProfit = true;
    }
    expect(s.gameOver).toBe(false); // 生存
    expect(sawProfit).toBe(true);   // 黒字ターンあり
    expect(s.company.CASH).toBeGreaterThan(0);
  });
});

describe("評判ゲート改定（§9・v0.8）", () => {
  it("reachablePaMax は改定後の6段ゲート（無名でも極端に低くない）", () => {
    expect(reachablePaMax(5)).toBe(105);   // 完全無名
    expect(reachablePaMax(10)).toBe(120);
    expect(reachablePaMax(35)).toBe(140);
    expect(reachablePaMax(65)).toBe(165);
    expect(reachablePaMax(80)).toBe(185);
    expect(reachablePaMax(95)).toBe(200);
  });

  it("ゲート改定後も knowledge 開始は数ターンで詰まない（生存）", () => {
    let s = initGame({ seed: 1 }); // knowledge
    for (let t = 1; t <= 12; t++) s = advanceTurn(s).next;
    expect(s.gameOver).toBe(false);
  });
});
