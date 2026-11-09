import { assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";
import { buildAppsscriptJson, CODE_JS } from "./gas_files.ts";

Deno.test("buildAppsscriptJson: timeZone を埋め込み、V8 / ANYONE_ANONYMOUS / USER_DEPLOYING にする", () => {
  const parsed = JSON.parse(buildAppsscriptJson("Asia/Tokyo"));
  assertEquals(parsed, {
    timeZone: "Asia/Tokyo",
    runtimeVersion: "V8",
    webapp: { access: "ANYONE_ANONYMOUS", executeAs: "USER_DEPLOYING" },
  });
});

Deno.test("buildAppsscriptJson: access は ANYONE ではなく ANYONE_ANONYMOUS のみ", () => {
  const parsed = JSON.parse(buildAppsscriptJson("UTC"));
  assertEquals(parsed.webapp.access === "ANYONE", false);
  assertEquals(parsed.webapp.access, "ANYONE_ANONYMOUS");
});

Deno.test("CODE_JS: 構文として正しく、doGet / doPost を定義する", () => {
  const api = new Function(`${CODE_JS}\n;return { doGet, doPost };`)();
  assertEquals(typeof api.doGet, "function");
  assertEquals(typeof api.doPost, "function");
});

Deno.test("CODE_JS: doGet の応答（status ptt ok・spreadsheetUrl）と共通の取得・作成関数", () => {
  assertStringIncludes(CODE_JS, "ptt ok");
  assertStringIncludes(CODE_JS, "spreadsheetUrl");
  assertStringIncludes(CODE_JS, "ContentService");
  assertStringIncludes(CODE_JS, "SpreadsheetApp.create");
  assertStringIncludes(CODE_JS, "SpreadsheetApp.openById");
});

Deno.test("CODE_JS: ScriptLock で排他し、スプレッドシートIDをスクリプトプロパティに保存する", () => {
  assertStringIncludes(CODE_JS, "LockService.getScriptLock()");
  assertStringIncludes(CODE_JS, "PropertiesService.getScriptProperties()");
});

Deno.test("CODE_JS: 作成時のタイトル ptt・スクリプトのタイムゾーン・見出し行", () => {
  assertMatch(CODE_JS, /create\(\s*['"]ptt['"]/);
  assertStringIncludes(CODE_JS, "Session.getScriptTimeZone()");
  for (const h of ["プロジェクト名", "開始日時", "終了日時", "作業時間"]) {
    assertStringIncludes(CODE_JS, h);
  }
});

Deno.test("CODE_JS: A列は書式なしテキスト @、B・C列は yyyy-mm-dd hh:mm:ss、D列は [h]:mm:ss", () => {
  assertMatch(CODE_JS, /['"]@['"]/);
  assertStringIncludes(CODE_JS, "yyyy-mm-dd hh:mm:ss");
  assertStringIncludes(CODE_JS, "[h]:mm:ss");
});

Deno.test("CODE_JS: doPost は text/plain 本文を JSON.parse し、durationSec / 86400 を書き込む", () => {
  assertStringIncludes(CODE_JS, "e.postData.contents");
  assertStringIncludes(CODE_JS, "JSON.parse");
  assertMatch(CODE_JS, /durationSec\s*\/\s*86400/);
  assertStringIncludes(CODE_JS, "records");
});

Deno.test("CODE_JS: doPost の応答は成功 {ok:true,count}・失敗 {ok:false,error}", () => {
  assertMatch(CODE_JS, /ok:\s*true/);
  assertMatch(CODE_JS, /count/);
  assertMatch(CODE_JS, /ok:\s*false/);
  assertMatch(CODE_JS, /error/);
});
