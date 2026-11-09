export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 表示更新・生存時刻更新などの失敗で本処理を止めない
export const runBestEffort = (step: () => void): void => {
  try {
    step();
  } catch {
    // 無視する
  }
};
