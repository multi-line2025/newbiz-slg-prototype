/**
 * v0.20 PhaseA 回帰テスト：25セクター青写真データ整合・ゲーム内年・解禁ロジック・非回帰。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { gameYear } from "../src/core/state";
import {
  SECTORS25, FOUNDATIONS, TECHS, SERVICES, COST_SCALE, SECTOR_PROFILES,
  techById, techAvailable, serviceStatus, prereqTechsOf, servicesRequiringTech, costScaleForYear,
} from "../src/core/blueprints25";
import { DEFAULT_START_YEAR } from "../src/core/model/constants";
import type { ProtoGameState } from "../src/core/state";

const advanceN = (s: ProtoGameState, n: number) => { for (let i = 0; i < n; i++) s = advanceTurn(s).next; return s; };

describe("v0.20：データ整合（Excel v0.4準拠）", () => {
  it("件数：25セクター / 9基盤 / 87技術 / 124サービス / 9帯 / 25プロファイル", () => {
    expect(SECTORS25.length).toBe(25);
    expect(FOUNDATIONS.length).toBe(9);
    expect(TECHS.length).toBe(87);
    expect(SERVICES.length).toBe(124);
    expect(COST_SCALE.length).toBe(9);
    expect(SECTOR_PROFILES.length).toBe(25);
  });

  it("全サービスの prereqTechIds は実在する技術idを指す", () => {
    for (const s of SERVICES) {
      for (const id of s.prereqTechIds) {
        expect(techById(id), `${s.no}:${id}`).toBeDefined();
      }
    }
  });

  it("全サービスの cost.total ＝ eng+des+res+mgt", () => {
    for (const s of SERVICES) {
      expect(s.cost.eng + s.cost.des + s.cost.res + s.cost.mgt).toBe(s.cost.total);
    }
  });

  it("技術idは一意・年は1975〜2022の範囲", () => {
    const ids = new Set(TECHS.map((t) => t.id));
    expect(ids.size).toBe(TECHS.length);
    for (const t of TECHS) { expect(t.year).toBeGreaterThanOrEqual(1975); expect(t.year).toBeLessThanOrEqual(2022); }
  });
});

describe("v0.20：ゲーム内年（1980起点・12ターン/年）", () => {
  it("turn1=startYear、12ターンで+1年", () => {
    let s = initGame({ seed: 7 });
    expect(s.startYear).toBe(DEFAULT_START_YEAR);
    expect(gameYear(s)).toBe(1980);
    s = advanceN(s, 12); // turn 13
    expect(gameYear(s)).toBe(1981);
    s = advanceN(s, 12); // turn 25
    expect(gameYear(s)).toBe(1982);
  });

  it("startYear は指定可能", () => {
    expect(gameYear(initGame({ seed: 1, startYear: 2000 }))).toBe(2000);
  });
});

describe("v0.20：解禁ロジック（データ駆動・経済非干渉）", () => {
  it("技術は年到達で可用（gameYear ≥ tech.year）", () => {
    const arm = techById("ARM")!; // 2015
    expect(techAvailable(arm, 2010)).toBe(false);
    expect(techAvailable(arm, 2015)).toBe(true);
    expect(techAvailable(arm, 2022)).toBe(true);
  });

  it("サービスは 全前提技術可用 かつ 解禁年到達 で着手可能", () => {
    // 1981年のPCサービス(no1)は1980時点で前提(OS/MPU/DRAM)が揃い着手可能
    const pcSvc = SERVICES.find((s) => s.no === 1)!;
    expect(serviceStatus(pcSvc, 1980).unlockable).toBe(true);
    // 2015年以降の高年次サービスは1980では不可（前提技術未解禁 or 年未到達）
    const late = SERVICES.find((s) => s.gateYear >= 2015)!;
    const at1980 = serviceStatus(late, 1980);
    expect(at1980.unlockable).toBe(false);
    expect(at1980.missingTechs.length + (at1980.yearReached ? 0 : 1)).toBeGreaterThan(0);
    // 十分に年が進めば着手可能
    expect(serviceStatus(late, 2022).unlockable).toBe(true);
  });

  it("earliestYear ＝ max(gateYear, 前提技術の最遅解禁年)", () => {
    for (const s of SERVICES.slice(0, 30)) {
      const st = serviceStatus(s, s.gateYear);
      const latestTech = prereqTechsOf(s).reduce((m, t) => Math.max(m, t.year), 0);
      expect(st.earliestYear).toBe(Math.max(s.gateYear, latestTech));
    }
  });

  it("逆引き：技術を前提に含むサービスを取得できる", () => {
    const dramServices = servicesRequiringTech("DRAM");
    expect(dramServices.length).toBeGreaterThan(0);
    for (const s of dramServices) expect(s.prereqTechIds).toContain("DRAM");
  });

  it("年帯コストスケールを引ける", () => {
    expect(costScaleForYear(1982)?.scale).toBe(3000);
    expect(costScaleForYear(2020)?.scale).toBe(24000);
  });
});

describe("v0.20：非回帰（PhaseAは経済非干渉）", () => {
  it("両archetypeの20T finals が一致・決定論（年/技術ツリーは経済に影響しない）", () => {
    for (const archetype of ["labor", "knowledge"] as const) {
      const a = advanceN(initGame({ seed: 3, archetype }), 20);
      const b = advanceN(initGame({ seed: 3, archetype }), 20);
      expect(a.company.CASH).toBe(b.company.CASH);
      expect(a.gameOver).toBe(false);
    }
  });
});
