import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  postRecords,
  resendStale,
  SEND_ATTEMPTS,
  SEND_RETRY_INTERVAL_MS,
  SEND_TIMEOUT_MS,
  sendPendingFile,
} from "./sender.ts";
import type { Fetcher, SendDeps } from "./sender.ts";
import { writePendingAtomic } from "./pending.ts";
import { toOffsetIso } from "./time.ts";

const URL_ = "https://script.google.com/macros/s/AKfycbTEST/exec";
const tmp = () => Deno.makeTempDirSync({ prefix: "ptt-sender-" });
const names = (dir: string) => [...Deno.readDirSync(dir)].map((e) => e.name).sort();
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const text = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));

type Posted = { records: { project: string; start: string; end: string; durationSec: number }[] };

const makeDeps = (fetcher: Fetcher, sleeps: number[] = []): SendDeps => ({
  url: URL_,
  fetcher,
  sleep: (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  },
});

const writeRecord = (path: string, start: Date, lastAlive: Date) =>
  writePendingAtomic(path, {
    project: "ptt",
    start: toOffsetIso(start),
    lastAlive: toOffsetIso(lastAlive),
  });

Deno.test("送信定数: 3回試行・1回10秒・間隔2秒", () => {
  assertEquals(SEND_ATTEMPTS, 3);
  assertEquals(SEND_TIMEOUT_MS, 10_000);
  assertEquals(SEND_RETRY_INTERVAL_MS, 2_000);
});

Deno.test("postRecords: text/plain の POST で records を JSON 本文に入れ、リダイレクトは手動にしない", async () => {
  let seenUrl = "";
  let seenInit: RequestInit = {};
  const records = [{ project: "ptt", start: "2026-10-30 23:00:00", end: "2026-10-31 00:00:00", durationSec: 3600 }];
  const ok = await postRecords(
    URL_,
    records,
    {
      timeoutMs: 1000,
      fetcher: (u: string, init: RequestInit) => {
        seenUrl = u;
        seenInit = init;
        return json({ ok: true, count: 1 });
      },
    },
  );
  assertEquals(ok, true);
  assertEquals(seenUrl, URL_);
  assertEquals(seenInit.method, "POST");
  const headers = new Headers(seenInit.headers);
  assert((headers.get("content-type") ?? "").startsWith("text/plain"));
  assertEquals(JSON.parse(String(seenInit.body)), { records });
  assert(seenInit.redirect === undefined || seenInit.redirect === "follow");
});

Deno.test("postRecords: 本文の ok===true のみ成功。ステータスコードでは判定しない", async () => {
  const run = (res: () => Promise<Response>) =>
    postRecords(URL_, [], { timeoutMs: 1000, fetcher: res });
  assertEquals(await run(() => json({ ok: true, count: 1 }, 500)), true);
  assertEquals(await run(() => text("<html>Error</html>", 200)), false);
  assertEquals(await run(() => json({ ok: false, error: "x" }, 200)), false);
  assertEquals(await run(() => json({ ok: "true" }, 200)), false);
  assertEquals(await run(() => json({ count: 1 }, 200)), false);
  assertEquals(await run(() => text("null", 200)), false);
  assertEquals(await run(() => text("", 200)), false);
});

Deno.test("postRecords: 通信エラーは失敗（例外を投げない）", async () => {
  const ok = await postRecords(URL_, [], {
    timeoutMs: 1000,
    fetcher: () => Promise.reject(new TypeError("network")),
  });
  assertEquals(ok, false);
});

Deno.test("postRecords: タイムアウトで中断して失敗にする", async () => {
  const ok = await postRecords(URL_, [], {
    timeoutMs: 20,
    fetcher: (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      }),
  });
  assertEquals(ok, false);
});

Deno.test("sendPendingFile: 日付をまたぐ記録は送信時に2レコードへ分割し、1リクエストで送る", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writeRecord(path, new Date(2026, 9, 30, 23, 0, 0), new Date(2026, 9, 31, 1, 30, 0));
  const bodies: Posted[] = [];
  const result = await sendPendingFile(
    path,
    makeDeps((_u, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return json({ ok: true, count: 2 });
    }),
  );
  assertEquals(result, "sent");
  assertEquals(bodies.length, 1);
  assertEquals(bodies[0].records, [
    { project: "ptt", start: "2026-10-30 23:00:00", end: "2026-10-31 00:00:00", durationSec: 3600 },
    { project: "ptt", start: "2026-10-31 00:00:00", end: "2026-10-31 01:30:00", durationSec: 5400 },
  ]);
  assertEquals(bodies[0].records.reduce((a, r) => a + r.durationSec, 0), 9000);
  assertEquals(names(dir), []);
});

Deno.test("sendPendingFile: 日付をまたがない記録は1レコード。送信中の退避ファイルは未分割のまま .sending に退避されている", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writeRecord(path, new Date(2026, 9, 30, 9, 0, 0), new Date(2026, 9, 30, 10, 0, 0));
  const original = Deno.readTextFileSync(path);
  let duringNames: string[] = [];
  let duringContent = "";
  let count = 0;
  const result = await sendPendingFile(
    path,
    makeDeps((_u, init) => {
      duringNames = names(dir);
      duringContent = Deno.readTextFileSync(`${dir}/1-1.sending`);
      count = (JSON.parse(String(init.body)) as Posted).records.length;
      return json({ ok: true, count: 1 });
    }),
  );
  assertEquals(result, "sent");
  assertEquals(count, 1);
  assertEquals(duringNames, ["1-1.sending"]);
  assertEquals(duringContent, original);
});

Deno.test("sendPendingFile: 3回失敗で .json に戻し（内容不変）、試行間隔2秒で2回待つ", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writeRecord(path, new Date(2026, 9, 30, 9, 0, 0), new Date(2026, 9, 30, 10, 0, 0));
  const original = Deno.readTextFileSync(path);
  const sleeps: number[] = [];
  let calls = 0;
  const result = await sendPendingFile(
    path,
    makeDeps(() => {
      calls++;
      return text("<html>error</html>", 200);
    }, sleeps),
  );
  assertEquals(result, "failed");
  assertEquals(calls, 3);
  assertEquals(sleeps, [2000, 2000]);
  assertEquals(names(dir), ["1-1.json"]);
  assertEquals(Deno.readTextFileSync(path), original);
});

Deno.test("sendPendingFile: 2回目で成功すれば再試行を止め、退避ファイルを削除する", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writeRecord(path, new Date(2026, 9, 30, 9, 0, 0), new Date(2026, 9, 30, 10, 0, 0));
  const sleeps: number[] = [];
  let calls = 0;
  const result = await sendPendingFile(
    path,
    makeDeps(() => {
      calls++;
      return calls === 1 ? Promise.reject(new TypeError("net")) : json({ ok: true, count: 1 });
    }, sleeps),
  );
  assertEquals(result, "sent");
  assertEquals(calls, 2);
  assertEquals(sleeps, [2000]);
  assertEquals(names(dir), []);
});

Deno.test("sendPendingFile: 送信中は .json が存在せず（処理権を確保済み）、claim 済みなら送信しない", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  const result = await sendPendingFile(
    path,
    makeDeps(() => {
      throw new Error("must not fetch");
    }),
  );
  assertEquals(result, "skipped");
});

Deno.test("sendPendingFile: 同じファイルを同時に送ろうとしても、送信するのは1プロセスだけ", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writeRecord(path, new Date(2026, 9, 30, 9, 0, 0), new Date(2026, 9, 30, 10, 0, 0));
  let calls = 0;
  const deps = makeDeps(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(JSON.stringify({ ok: true, count: 1 }));
  });
  const results = await Promise.all([sendPendingFile(path, deps), sendPendingFile(path, deps)]);
  assertEquals(results.slice().sort(), ["sent", "skipped"]);
  assertEquals(calls, 1);
});

Deno.test("resendStale: 古い .json と2分以上前の .sending だけを送り、更新中のファイルは触らない", async () => {
  const dir = tmp();
  const now = new Date(2026, 9, 30, 12, 0, 0);
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  writeRecord(`${dir}/1-1.json`, ago(3600), ago(600));
  writeRecord(`${dir}/2-2.json`, ago(3600), ago(10));
  writeRecord(`${dir}/3-3.json`, ago(3600), ago(900));
  Deno.renameSync(`${dir}/3-3.json`, `${dir}/3-3.sending`);
  Deno.utimeSync(`${dir}/3-3.sending`, ago(300), ago(300));
  const sentStarts: string[] = [];
  const results = await resendStale(
    dir,
    now,
    makeDeps((_u, init) => {
      for (const r of (JSON.parse(String(init.body)) as Posted).records) sentStarts.push(r.start);
      return json({ ok: true, count: 1 });
    }),
  );
  assertEquals(results.length, 2);
  assertEquals(results.every((r) => r === "sent"), true);
  assertEquals(sentStarts.length, 2);
  assertEquals(names(dir), ["2-2.json"]);
});

Deno.test("resendStale: 送信失敗した記録は .json に戻って残る", async () => {
  const dir = tmp();
  const now = new Date(2026, 9, 30, 12, 0, 0);
  writeRecord(`${dir}/1-1.json`, new Date(2026, 9, 30, 9, 0, 0), new Date(2026, 9, 30, 10, 0, 0));
  const results = await resendStale(dir, now, makeDeps(() => text("<html/>")));
  assertEquals(results, ["failed"]);
  assertEquals(names(dir), ["1-1.json"]);
});

Deno.test("sendPendingFile: 送信成功後に .sending を消せなくても sent を返し、復旧対象外の名前に退避する", async () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writeRecord(path, new Date(2026, 0, 1, 10, 0, 0), new Date(2026, 0, 1, 11, 0, 0));
  const fetcher: Fetcher = () => {
    // 送信中に .sending を中身のあるディレクトリに差し替え、removeSync を失敗させる
    const sending = `${dir}/1-1.sending`;
    Deno.removeSync(sending);
    Deno.mkdirSync(sending);
    Deno.writeTextFileSync(`${sending}/x`, "x");
    return json({ ok: true });
  };
  assertEquals(await sendPendingFile(path, makeDeps(fetcher)), "sent");
  assertEquals(names(dir), ["1-1.sending.sent"]);
});
