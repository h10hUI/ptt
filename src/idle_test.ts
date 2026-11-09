import { assertEquals } from "jsr:@std/assert@1";
import { evaluateIdle, parseHidIdleMs } from "./idle.ts";

Deno.test("parseHidIdleMs: ナノ秒をミリ秒（÷1,000,000）に変換する", () => {
  assertEquals(parseHidIdleMs(`    | "HIDIdleTime" = 1800000000000`), 1_800_000);
  assertEquals(parseHidIdleMs(`"HIDIdleTime" = 5000000`), 5);
});

Deno.test("parseHidIdleMs: 複数ある場合は最初の値を使う", () => {
  const out = [
    `  +-o IOHIDSystem  <class IOHIDSystem>`,
    `    | "HIDIdleTime" = 3000000000`,
    `    | "HIDIdleTime" = 9000000000`,
  ].join("\n");
  assertEquals(parseHidIdleMs(out), 3000);
});

Deno.test("parseHidIdleMs: 解析できない出力は null", () => {
  assertEquals(parseHidIdleMs(""), null);
  assertEquals(parseHidIdleMs("no such key here"), null);
  assertEquals(parseHidIdleMs(`"HIDIdleTime" = abc`), null);
});

Deno.test("evaluateIdle: 解析失敗（null）の回は停止せずスキップする", () => {
  assertEquals(evaluateIdle(null, 1_000_000), { stop: false });
});

Deno.test("evaluateIdle: 30分未満は継続、30分ちょうどで停止", () => {
  assertEquals(evaluateIdle(1_799_999, 10_000_000), { stop: false });
  assertEquals(evaluateIdle(1_800_000, 10_000_000), { stop: true, endMs: 10_000_000 - 1_800_000 });
});

Deno.test("evaluateIdle: 終了時刻は 検知時刻 − 実際の無操作時間", () => {
  assertEquals(evaluateIdle(4_350_000, 20_000_000), { stop: true, endMs: 20_000_000 - 4_350_000 });
});
