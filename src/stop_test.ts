import { assertEquals } from "jsr:@std/assert@1";
import { exitCodeFor, finalizeStop, isShortRecord, stopMessage } from "./stop.ts";
import type { StopDeps } from "./stop.ts";

const at = (h: number, m: number, s: number, ms = 0) => new Date(2026, 9, 30, h, m, s, ms);

const makeDeps = (
  calls: string[],
  opts: { sendOk?: boolean; showThrows?: boolean; pendingExists?: boolean } = {},
): StopDeps & { shown: string[]; written: Date[] } => {
  const shown: string[] = [];
  const written: Date[] = [];
  return {
    shown,
    written,
    pendingExists: () => opts.pendingExists ?? true,
    writePending: (end: Date) => {
      calls.push("write");
      written.push(end);
    },
    deletePending: () => {
      calls.push("delete");
    },
    send: () => {
      calls.push("send");
      return Promise.resolve(opts.sendOk ?? true);
    },
    show: (message: string) => {
      calls.push("show");
      shown.push(message);
      if (opts.showThrows) throw new Error("no tty");
    },
  };
};

Deno.test("isShortRecord: 秒未満切り捨て後の合計が60秒未満なら短時間", () => {
  assertEquals(isShortRecord(at(10, 0, 0), at(10, 0, 59)), true);
  assertEquals(isShortRecord(at(10, 0, 0), at(10, 1, 0)), false);
  assertEquals(isShortRecord(at(10, 0, 0, 900), at(10, 0, 59, 900)), true);
  assertEquals(isShortRecord(at(10, 0, 0, 999), at(10, 1, 0, 1)), false);
});

Deno.test("isShortRecord: 日付分割前の合計で判定する（分割後の区間が短くても合計が60秒以上なら短時間でない）", () => {
  const start = new Date(2026, 9, 30, 23, 59, 30);
  assertEquals(isShortRecord(start, new Date(2026, 9, 31, 0, 1, 0)), false);
  assertEquals(isShortRecord(new Date(2026, 9, 30, 23, 59, 45), new Date(2026, 9, 31, 0, 0, 15)), true);
});

Deno.test("exitCodeFor: 送信成功・1分未満破棄は0、送信失敗は1", () => {
  assertEquals(exitCodeFor("sent"), 0);
  assertEquals(exitCodeFor("discarded"), 0);
  assertEquals(exitCodeFor("failed"), 1);
});

Deno.test("stopMessage: 仕様 5.5 の表示文言", () => {
  assertEquals(stopMessage("idle", 4350), "30分操作がなかったため停止しました（1:12:30を記録）");
  assertEquals(stopMessage("sleep", 2710), "スリープを検知したため停止しました（0:45:10を記録）");
  assertEquals(stopMessage("signal", 7424), "停止しました（2:03:44を記録）");
});

Deno.test("finalizeStop: 通常停止は 書き込み → 送信 → 表示 の順で、終了コード0", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls);
  const end = at(11, 12, 30);
  const code = await finalizeStop({ reason: "idle", start: at(10, 0, 0), end, deps });
  assertEquals(calls, ["write", "send", "show"]);
  assertEquals(deps.written, [end]);
  assertEquals(deps.shown, ["30分操作がなかったため停止しました（1:12:30を記録）"]);
  assertEquals(code, 0);
});

Deno.test("finalizeStop: 1分未満は書き込み後に退避ファイルを削除し、送信せず終了コード0", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls);
  const code = await finalizeStop({ reason: "signal", start: at(10, 0, 0), end: at(10, 0, 59), deps });
  assertEquals(calls, ["write", "delete", "show"]);
  assertEquals(deps.shown, ["1分未満のため記録しませんでした"]);
  assertEquals(code, 0);
});

Deno.test("finalizeStop: ちょうど60秒は送信対象（削除しない）", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls);
  await finalizeStop({ reason: "signal", start: at(10, 0, 0), end: at(10, 1, 0), deps });
  assertEquals(calls, ["write", "send", "show"]);
});

Deno.test("finalizeStop: 送信失敗は退避を残して終了コード1、失敗メッセージを表示", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls, { sendOk: false });
  const code = await finalizeStop({ reason: "sleep", start: at(10, 0, 0), end: at(11, 0, 0), deps });
  assertEquals(calls, ["write", "send", "show"]);
  assertEquals(deps.shown, ["送信に失敗しました。次回起動時に再送します"]);
  assertEquals(code, 1);
});

Deno.test("finalizeStop: 表示のエラーは無視され、終了コードは送信結果で決まる", async () => {
  const okDeps = makeDeps([], { showThrows: true });
  assertEquals(
    await finalizeStop({ reason: "signal", start: at(10, 0, 0), end: at(10, 5, 0), deps: okDeps }),
    0,
  );
  const ngDeps = makeDeps([], { sendOk: false, showThrows: true });
  assertEquals(
    await finalizeStop({ reason: "signal", start: at(10, 0, 0), end: at(10, 5, 0), deps: ngDeps }),
    1,
  );
});

Deno.test("finalizeStop: 停止理由が違っても終了コードは同じ（理由ごとに区別しない）", async () => {
  for (const reason of ["idle", "sleep", "signal"] as const) {
    const deps = makeDeps([]);
    assertEquals(
      await finalizeStop({ reason, start: at(10, 0, 0), end: at(10, 5, 0), deps }),
      0,
    );
  }
});

Deno.test("finalizeStop: 退避ファイルが無い（別プロセスが引き取り済み）なら書き直さず送信もしない", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls, { pendingExists: false });
  const code = await finalizeStop({ reason: "sleep", start: at(10, 0, 0), end: at(10, 45, 10), deps });
  assertEquals(calls, ["show"]);
  assertEquals(deps.written, []);
  assertEquals(code, 0);
});
