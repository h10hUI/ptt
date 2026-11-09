import { formatElapsed, truncateToSecond } from "./time.ts";

export type StopReason = "idle" | "sleep" | "signal";
export type StopOutcome = "sent" | "discarded" | "failed";

export type StopDeps = {
  writePending: (end: Date) => void;
  deletePending: () => void;
  send: () => Promise<boolean>;
  show: (message: string) => void;
};

const SHORT_LIMIT_SEC = 60;

const durationSecOf = (start: Date, end: Date): number =>
  (truncateToSecond(end).getTime() - truncateToSecond(start).getTime()) / 1000;

export const isShortRecord = (start: Date, end: Date): boolean =>
  durationSecOf(start, end) < SHORT_LIMIT_SEC;

export const exitCodeFor = (outcome: StopOutcome): 0 | 1 => (outcome === "failed" ? 1 : 0);

export const stopMessage = (reason: StopReason, durationSec: number): string => {
  const recorded = `${formatElapsed(durationSec)}を記録`;
  switch (reason) {
    case "idle":
      return `30分操作がなかったため停止しました（${recorded}）`;
    case "sleep":
      return `スリープを検知したため停止しました（${recorded}）`;
    case "signal":
      return `停止しました（${recorded}）`;
  }
};

const SHORT_MESSAGE = "1分未満のため記録しませんでした";
const SEND_FAILED_MESSAGE = "送信に失敗しました。次回起動時に再送します";

export const finalizeStop = async (input: {
  reason: StopReason;
  start: Date;
  end: Date;
  deps: StopDeps;
}): Promise<0 | 1> => {
  const { reason, start, end, deps } = input;
  const show = (message: string): void => {
    try {
      deps.show(message);
    } catch {
      // 表示先が無い場合のエラーは無視する
    }
  };
  deps.writePending(end);
  if (isShortRecord(start, end)) {
    deps.deletePending();
    show(SHORT_MESSAGE);
    return exitCodeFor("discarded");
  }
  const sent = await deps.send();
  if (sent) {
    show(stopMessage(reason, durationSecOf(start, end)));
    return exitCodeFor("sent");
  }
  show(SEND_FAILED_MESSAGE);
  return exitCodeFor("failed");
};
