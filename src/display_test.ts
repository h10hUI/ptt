import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createDisplay } from "./display.ts";

Deno.test("createDisplay: 端末でないときはライブ表示も停止表示も出力しない", () => {
  const out: string[] = [];
  const d = createDisplay({ isTerminal: false, write: (t: string) => out.push(t) });
  d.live(5);
  d.message("停止しました（0:05:00を記録）");
  assertEquals(out, []);
});

Deno.test("createDisplay: 端末ではライブ表示が H:mm:ss を含み、同じ行を書き換える制御を伴う", () => {
  const out: string[] = [];
  const d = createDisplay({ isTerminal: true, write: (t: string) => out.push(t) });
  d.live(4392);
  const joined = out.join("");
  assertEquals(joined.includes("1:13:12"), true);
  assertMatch(joined, /\r|\x1b\[/);
});

Deno.test("createDisplay: 端末では停止メッセージが出力される", () => {
  const out: string[] = [];
  const d = createDisplay({ isTerminal: true, write: (t: string) => out.push(t) });
  d.message("1分未満のため記録しませんでした");
  assertEquals(out.join("").includes("1分未満のため記録しませんでした"), true);
});
