import { assertEquals } from "jsr:@std/assert@1";
import { isObject, runBestEffort, sleep } from "./util.ts";

Deno.test("isObject: オブジェクトのみ true（null と配列は false）", () => {
  assertEquals(isObject({}), true);
  assertEquals(isObject({ a: 1 }), true);
  assertEquals(isObject(null), false);
  assertEquals(isObject([]), false);
  assertEquals(isObject("x"), false);
});

Deno.test("runBestEffort: 例外を投げても呼び出し元に伝えない", () => {
  let called = false;
  runBestEffort(() => {
    called = true;
    throw new Error("ENOSPC");
  });
  assertEquals(called, true);
});

Deno.test("sleep: 指定時間後に解決する", async () => {
  const t = Date.now();
  await sleep(10);
  assertEquals(Date.now() - t >= 9, true);
});
