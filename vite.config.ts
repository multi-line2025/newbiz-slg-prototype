import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// SINGLEFILE=1 のときだけ「全JS/CSSをインライン化した単一HTML」を出力する。
// 通常の `vite build`（dist/）は従来どおり分割ビルド（開発・検証用）。
const singleFile = process.env.SINGLEFILE === "1";

// Vite + Vitest 設定（プロトタイプ最小構成）
export default defineConfig({
  // 単一HTMLは file:// で直接開くため相対パス（base: "./"）にする
  base: singleFile ? "./" : "/",
  plugins: singleFile ? [viteSingleFile()] : [],
  build: singleFile
    ? {
        outDir: "dist-single", // 通常ビルドの dist/ と分離
        assetsInlineLimit: 100000000, // すべてのアセットをインライン化
        cssCodeSplit: false,
        modulePreload: false, // 未使用のpreloadポリフィル(fetch)を除去＝完全オフライン
      }
    : {},
  test: {
    globals: true,
    environment: "node", // core は純粋関数のみ＝ブラウザ不要
    include: ["tests/**/*.test.ts"],
  },
});
