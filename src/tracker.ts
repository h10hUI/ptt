import { evaluateIdle } from "./idle.ts";
import type { StopReason } from "./stop.ts";

const SLEEP_GAP_MS = 60_000;
const ALIVE_EVERY = 10;
const IDLE_EVERY = 30;

export type TickStep = "display" | "alive" | "idle";

export type TickPlan =
  | { kind: "sleep"; endMs: number }
  | { kind: "continue"; steps: TickStep[] };

export const planTick = (input: {
  nowMs: number;
  lastCheckMs: number;
  tickCount: number;
}): TickPlan => {
  if (input.nowMs - input.lastCheckMs >= SLEEP_GAP_MS) {
    return { kind: "sleep", endMs: input.lastCheckMs };
  }
  const steps: TickStep[] = ["display"];
  if (input.tickCount % ALIVE_EVERY === 0) steps.push("alive");
  if (input.tickCount % IDLE_EVERY === 0) steps.push("idle");
  return { kind: "continue", steps };
};

// 表示更新・生存時刻更新の失敗で計測を止めない。最後の保存は停止時にもう一度試みる
export const runBestEffort = (step: () => void): void => {
  try {
    step();
  } catch {
    // 無視する
  }
};

export type TrackerDeps = {
  now: () => number;
  showElapsed: (elapsedSec: number) => void;
  writeAlive: (now: Date) => void;
  readIdleMs: () => Promise<number | null>;
};

export type TrackerResult = { reason: StopReason; end: Date };

const SIGNALS: Deno.Signal[] = ["SIGHUP", "SIGINT", "SIGTERM"];

export const runTracker = (startMs: number, deps: TrackerDeps): Promise<TrackerResult> =>
  new Promise((resolve) => {
    let lastCheckMs = startMs;
    let tickCount = 0;
    let idleRunning = false;
    let finished = false;

    const handlers = SIGNALS.map((sig) => {
      const handler = () => finish({ reason: "signal", end: new Date(deps.now()) });
      Deno.addSignalListener(sig, handler);
      return { sig, handler };
    });
    const timer = setInterval(() => tick(), 1000);

    const finish = (result: TrackerResult): void => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      for (const { sig, handler } of handlers) Deno.removeSignalListener(sig, handler);
      resolve(result);
    };

    const checkIdle = async (nowMs: number): Promise<void> => {
      if (idleRunning) return;
      idleRunning = true;
      try {
        const decision = evaluateIdle(await deps.readIdleMs(), nowMs);
        if (decision.stop) finish({ reason: "idle", end: new Date(decision.endMs) });
      } finally {
        idleRunning = false;
      }
    };

    const tick = (): void => {
      if (finished) return;
      tickCount++;
      const nowMs = deps.now();
      const plan = planTick({ nowMs, lastCheckMs, tickCount });
      if (plan.kind === "sleep") {
        finish({ reason: "sleep", end: new Date(plan.endMs) });
        return;
      }
      lastCheckMs = nowMs;
      for (const step of plan.steps) {
        if (step === "display") {
          runBestEffort(() => deps.showElapsed(Math.floor((nowMs - startMs) / 1000)));
        } else if (step === "alive") {
          runBestEffort(() => deps.writeAlive(new Date(nowMs)));
        } else {
          checkIdle(nowMs).catch(() => {});
        }
      }
    };
  });
