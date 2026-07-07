/**
 * セーブ/ロードのラウンドトリップ＆再現性テスト（v0.4）。
 * 乱数seedも直列化されるため、ロード後も同じ乱数列＝同じ結果になる。
 */
import { describe, it, expect } from "vitest";
import { initGame } from "../src/core/init";
import { advanceTurn } from "../src/core/turn";
import { serialize, deserialize, SAVE_VERSION } from "../src/core/save";
import type { ProtoGameState } from "../src/core/state";

/** N ターン進めた状態を返す。 */
function advanceN(s: ProtoGameState, n: number): ProtoGameState {
  for (let i = 0; i < n; i++) s = advanceTurn(s).next;
  return s;
}

describe("serialize / deserialize", () => {
  it("ラウンドトリップで内容が一致する", () => {
    const s = advanceN(initGame({ seed: 42 }), 5);
    const restored = deserialize(serialize(s));
    expect(restored).toEqual(s); // 深い等価
  });

  it("seedを含むため、ロード後に進めても元と同一結果（再現性）", () => {
    const base = advanceN(initGame({ seed: 42 }), 3);
    const restored = deserialize(serialize(base));

    const a = advanceN(base, 8);
    const b = advanceN(restored, 8);

    expect(b.turn).toBe(a.turn);
    expect(b.rngSeed).toBe(a.rngSeed); // 乱数列が一致
    expect(b.company.CASH).toBeCloseTo(a.company.CASH);
    expect(b.company.THxP_customer).toBeCloseTo(a.company.THxP_customer);
    expect(b.products.length).toBe(a.products.length);
    if (a.products[0]) expect(b.products[0].QUAL_p).toBeCloseTo(a.products[0].QUAL_p);
    expect(Object.keys(b.people).length).toBe(Object.keys(a.people).length);
  });

  it("バージョン不一致は例外を投げる", () => {
    const s = initGame({ seed: 1 });
    const tampered = JSON.stringify({ version: "9.9", savedAt: 0, state: s });
    expect(() => deserialize(tampered)).toThrow();
  });

  it("壊れたデータは例外を投げる", () => {
    expect(() => deserialize("{}")).toThrow();
  });

  it("SAVE_VERSIONが埋め込まれる", () => {
    const json = serialize(initGame({ seed: 1 }));
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
  });
});
