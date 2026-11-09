import { assertEquals } from "jsr:@std/assert@1";
import { planTick } from "./tracker.ts";

const T0 = 1_000_000;

Deno.test("planTick: 前回から59秒以内ならスリープとみなさない", () => {
  assertEquals(planTick({ nowMs: T0 + 1_000, lastCheckMs: T0, tickCount: 1 }).kind, "continue");
  assertEquals(planTick({ nowMs: T0 + 59_999, lastCheckMs: T0, tickCount: 1 }).kind, "continue");
});

Deno.test("planTick: 前回から60秒以上空いたらスリープ。終了時刻は前回確認時刻", () => {
  assertEquals(planTick({ nowMs: T0 + 60_000, lastCheckMs: T0, tickCount: 1 }), {
    kind: "sleep",
    endMs: T0,
  });
  assertEquals(planTick({ nowMs: T0 + 3_600_000, lastCheckMs: T0, tickCount: 5 }), {
    kind: "sleep",
    endMs: T0,
  });
});

Deno.test("planTick: 通常の回は表示更新のみ。10回に1回は生存時刻更新、30回に1回はアイドル判定を加える", () => {
  const steps = (tickCount: number) => {
    const plan = planTick({ nowMs: T0 + 1_000, lastCheckMs: T0, tickCount });
    if (plan.kind !== "continue") throw new Error("unexpected sleep");
    return plan.steps;
  };
  assertEquals(steps(1), ["display"]);
  assertEquals(steps(9), ["display"]);
  assertEquals(steps(10), ["display", "alive"]);
  assertEquals(steps(20), ["display", "alive"]);
  assertEquals(steps(29), ["display"]);
  assertEquals(steps(30), ["display", "alive", "idle"]);
  assertEquals(steps(60), ["display", "alive", "idle"]);
});

Deno.test("planTick: スリープ判定の回はアイドル判定・表示・生存更新をしない（スリープ判定が先）", () => {
  const plan = planTick({ nowMs: T0 + 120_000, lastCheckMs: T0, tickCount: 30 });
  assertEquals(plan, { kind: "sleep", endMs: T0 });
});
