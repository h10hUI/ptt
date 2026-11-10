import process from "node:process";

// Deno 2.7.7 未満ではこの代入は無視され、例外も出ずにランタイム名のまま起動が継続する。
// 未対応版向けの代替手段・警告は要求されていないため、設定だけを行う
export const setProcessTitle = (): void => {
  process.title = "ptt";
};
