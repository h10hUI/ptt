import { assertEquals } from "jsr:@std/assert@1";
import {
  API_ENABLE_POLL,
  APPROVAL_POLL,
  buildGasUrl,
  fetchApproval,
  isAppsScriptApiDisabled,
  planSetup,
  pollUntil,
  USER_SETTINGS_URL,
} from "./setup.ts";

const fakeClock = () => {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
};

Deno.test("待機設定: API 有効化待ちは5秒間隔・10分、承認待ちは3秒間隔・10分", () => {
  assertEquals(API_ENABLE_POLL, { intervalMs: 5_000, timeoutMs: 600_000 });
  assertEquals(APPROVAL_POLL, { intervalMs: 3_000, timeoutMs: 600_000 });
});

Deno.test("pollUntil: 初回で成功すれば待たない", async () => {
  const c = fakeClock();
  const ok = await pollUntil({
    attempt: () => Promise.resolve(true),
    intervalMs: 5000,
    timeoutMs: 600_000,
    sleep: c.sleep,
    now: c.now,
  });
  assertEquals(ok, true);
  assertEquals(c.sleeps, []);
});

Deno.test("pollUntil: 3回目に成功するまで指定間隔で待つ", async () => {
  const c = fakeClock();
  let n = 0;
  const ok = await pollUntil({
    attempt: () => Promise.resolve(++n === 3),
    intervalMs: 3000,
    timeoutMs: 600_000,
    sleep: c.sleep,
    now: c.now,
  });
  assertEquals(ok, true);
  assertEquals(c.sleeps, [3000, 3000]);
});

Deno.test("pollUntil: 成功しなければ10分でタイムアウトして false", async () => {
  const c = fakeClock();
  let n = 0;
  const ok = await pollUntil({
    attempt: () => {
      n++;
      return Promise.resolve(false);
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    sleep: c.sleep,
    now: c.now,
  });
  assertEquals(ok, false);
  assertEquals(c.sleeps.every((s) => s === 5000), true);
  const waited = c.sleeps.reduce((a, b) => a + b, 0);
  assertEquals(waited >= 600_000 && waited <= 605_000, true);
  assertEquals(n >= 120 && n <= 121, true);
});

Deno.test("pollUntil: タイムアウトはステップごとに計測する（前のステップの経過時間を持ち越さない）", async () => {
  const c = fakeClock();
  const first = await pollUntil({
    attempt: () => Promise.resolve(false),
    intervalMs: 5000,
    timeoutMs: 600_000,
    sleep: c.sleep,
    now: c.now,
  });
  assertEquals(first, false);
  let n = 0;
  const second = await pollUntil({
    attempt: () => {
      n++;
      return Promise.resolve(false);
    },
    intervalMs: 3000,
    timeoutMs: 600_000,
    sleep: c.sleep,
    now: c.now,
  });
  assertEquals(second, false);
  assertEquals(n >= 199, true);
});

const res = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));

Deno.test("fetchApproval: 本文が JSON で status が ptt ok なら承認済み（スプレッドシートURLを返す）", async () => {
  const r = await fetchApproval("https://x/exec", () =>
    res('{"status":"ptt ok","spreadsheetUrl":"https://docs.google.com/spreadsheets/d/yyyyy/edit"}'));
  assertEquals(r, { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/yyyyy/edit" });
});

Deno.test("fetchApproval: HTTPステータスでは判定しない（200 の HTML は未承認、500 でも本文が正しければ承認）", async () => {
  assertEquals(await fetchApproval("https://x/exec", () => res("<html>authorize</html>", 200)), null);
  assertEquals(
    await fetchApproval("https://x/exec", () =>
      res('{"status":"ptt ok","spreadsheetUrl":"u"}', 500)),
    { spreadsheetUrl: "u" },
  );
});

Deno.test("fetchApproval: JSON でも status が ptt ok でなければ未承認。通信エラーも未承認", async () => {
  assertEquals(await fetchApproval("https://x/exec", () => res('{"status":"other"}')), null);
  assertEquals(await fetchApproval("https://x/exec", () => res("null")), null);
  assertEquals(await fetchApproval("https://x/exec", () => res('{"ok":true}')), null);
  assertEquals(
    await fetchApproval("https://x/exec", () => Promise.reject(new TypeError("net"))),
    null,
  );
});

Deno.test("fetchApproval: 応答が止まっても指定時間で打ち切って未承認（null）を返す", async () => {
  const hanging = (_url: string, init: RequestInit): Promise<Response> =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
    });
  assertEquals(await fetchApproval("https://x/exec", hanging, 20), null);
});

Deno.test("planSetup: .clasp.json があれば手順2をスキップ、deployment.json の ID の有無で create / update を切り替える", () => {
  assertEquals(planSetup({ hasClaspJson: false, hasDeploymentId: false }), {
    createProject: true,
    deployMode: "create",
  });
  assertEquals(planSetup({ hasClaspJson: false, hasDeploymentId: true }), {
    createProject: true,
    deployMode: "create",
  });
  assertEquals(planSetup({ hasClaspJson: true, hasDeploymentId: false }), {
    createProject: false,
    deployMode: "create",
  });
  assertEquals(planSetup({ hasClaspJson: true, hasDeploymentId: true }), {
    createProject: false,
    deployMode: "update",
  });
});

Deno.test("buildGasUrl: https://script.google.com/macros/s/<ID>/exec", () => {
  assertEquals(buildGasUrl("AKfycbX-1_y"), "https://script.google.com/macros/s/AKfycbX-1_y/exec");
});

Deno.test("isAppsScriptApiDisabled: API 無効エラーを複数の文言で判定し、無関係なエラーは判定しない", () => {
  assertEquals(USER_SETTINGS_URL, "https://script.google.com/home/usersettings");
  assertEquals(
    isAppsScriptApiDisabled(
      "User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.",
    ),
    true,
  );
  assertEquals(
    isAppsScriptApiDisabled("Apps Script API has not been used in project 123 before or it is disabled."),
    true,
  );
  assertEquals(isAppsScriptApiDisabled("ECONNRESET: socket hang up"), false);
  assertEquals(isAppsScriptApiDisabled(""), false);
});
