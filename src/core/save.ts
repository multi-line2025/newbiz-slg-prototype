/**
 * ======================================================================
 *  save.ts  セーブ/ロード（直列化・再現性）
 * ----------------------------------------------------------------------
 *  ProtoGameState は数値・文字列・配列・辞書のみで構成された
 *  「プレーンなJSON」なので、JSON.stringify/parse で丸ごと保存できる。
 *  乱数は state.rngSeed に集約されており（advanceTurn以外はrng不使用）、
 *  seed も直列化されるためロード後も同一の乱数列＝再現性が保たれる。
 *
 *  技術設計 §3 は大規模時 IndexedDB＋差分を想定するが、
 *  プロトタイプの状態は小さいため localStorage の単一JSONで足りる（§3.4 export相当）。
 * ======================================================================
 */

import type { ProtoGameState } from "./state";

/** セーブファイルのスキーマバージョン（将来のマイグレーション用）。 */
export const SAVE_VERSION = "0.4";

/** セーブファイルの包み。 */
export interface SaveFile {
  version: string;
  savedAt: number; // 保存時刻（epoch ms）
  state: ProtoGameState;
}

/** 状態をJSON文字列へ直列化する（seed含む）。 */
export function serialize(state: ProtoGameState): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt: Date.now(), state };
  return JSON.stringify(file);
}

/** JSON文字列から状態へ復元する。バージョン不一致・破損時は例外。 */
export function deserialize(json: string): ProtoGameState {
  const file = JSON.parse(json) as SaveFile;
  if (!file || typeof file !== "object" || !file.state) {
    throw new Error("セーブデータが不正です。");
  }
  if (file.version !== SAVE_VERSION) {
    throw new Error(`セーブのバージョンが一致しません（${file.version} ≠ ${SAVE_VERSION}）。`);
  }
  return file.state;
}

const STORAGE_KEY = "slg-proto-save";

/** ブラウザ用: localStorage への保存/読込。core外で使うが依存が薄いためここに置く。 */
export const storage = {
  /** localStorage へ保存。成功で true。 */
  save(state: ProtoGameState): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(state));
      return true;
    } catch {
      return false;
    }
  },
  /** localStorage から読込。無ければ null。 */
  load(): ProtoGameState | null {
    try {
      const json = localStorage.getItem(STORAGE_KEY);
      return json ? deserialize(json) : null;
    } catch {
      return null;
    }
  },
  /** セーブが存在するか。 */
  has(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) != null;
    } catch {
      return false;
    }
  },
};
