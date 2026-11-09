import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  CLASP_ARGS,
  evaluateClaspVersion,
  extractDeploymentId,
  isLoggedIn,
  parseClaspMajor,
} from "./clasp.ts";

Deno.test("parseClaspMajor: 出力から最初の 数字.数字.数字 のメジャーを取る", () => {
  assertEquals(parseClaspMajor("3.0.6\n"), 3);
  assertEquals(parseClaspMajor("2.4.2"), 2);
  assertEquals(parseClaspMajor("v2.4.2"), 2);
  assertEquals(parseClaspMajor("10.1.0"), 10);
  assertEquals(parseClaspMajor("clasp version 3.1.2 (node 22.1.0)"), 3);
  assertEquals(parseClaspMajor("no version"), null);
});

Deno.test("evaluateClaspVersion: clasp が見つからない → npm install -g @google/clasp を表示", () => {
  const r = evaluateClaspVersion({ kind: "not-found" });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(r.message, "npm install -g @google/clasp");
    assertEquals(r.message.includes("@latest"), false);
  }
});

Deno.test("evaluateClaspVersion: 終了コード127 → Node.js 22以上が必要", () => {
  const r = evaluateClaspVersion({ kind: "exit", code: 127, stdout: "", stderr: "" });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(r.message, "Node.js");
    assertStringIncludes(r.message, "22");
  }
});

Deno.test("evaluateClaspVersion: 標準エラーに node を含む → Node.js 22以上が必要", () => {
  const r = evaluateClaspVersion({
    kind: "exit",
    code: 1,
    stdout: "",
    stderr: "env: node: No such file or directory",
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(r.message, "Node.js");
    assertStringIncludes(r.message, "22");
  }
});

Deno.test("evaluateClaspVersion: メジャーが3未満 → npm install -g @google/clasp@latest を表示", () => {
  const r = evaluateClaspVersion({ kind: "exit", code: 0, stdout: "2.4.2\n", stderr: "" });
  assertEquals(r.ok, false);
  if (!r.ok) assertStringIncludes(r.message, "npm install -g @google/clasp@latest");
});

Deno.test("evaluateClaspVersion: 3.x 以上は通過", () => {
  assertEquals(evaluateClaspVersion({ kind: "exit", code: 0, stdout: "3.0.6\n", stderr: "" }).ok, true);
  assertEquals(evaluateClaspVersion({ kind: "exit", code: 0, stdout: "4.0.0\n", stderr: "" }).ok, true);
});

Deno.test("evaluateClaspVersion: その他の失敗は標準エラーをそのまま表示する（Node.js 案内にしない）", () => {
  const stderr = "EACCES: permission denied, open '/x/clasp'";
  const r = evaluateClaspVersion({ kind: "exit", code: 1, stdout: "", stderr });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(r.message, stderr);
    assertEquals(r.message.includes("Node.js"), false);
  }
});

Deno.test("isLoggedIn: ログイン済みの JSON 出力は true", () => {
  assertEquals(isLoggedIn({ code: 0, stdout: '{"email":"a@example.com"}' }), true);
  assertEquals(isLoggedIn({ code: 0, stdout: '{"email":"a@example.com","id":"123"}\n' }), true);
});

Deno.test("isLoggedIn: 未ログインの複数の出力形式をすべて false にする", () => {
  assertEquals(isLoggedIn({ code: 1, stdout: "", stderr: "You are not logged in." }), false);
  assertEquals(isLoggedIn({ code: 1, stdout: '{"email":"a@example.com"}' }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: "" }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: "   \n" }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: "{}" }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: "null" }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: "[]" }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: "You are not logged in." }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: '"not logged in"' }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: '{"loggedIn":false}' }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: '{"email":null}' }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: '{"email":""}' }), false);
  assertEquals(isLoggedIn({ code: 0, stdout: '{"error":"not logged in"}' }), false);
});

Deno.test("extractDeploymentId: JSON 出力（トップレベル・入れ子・配列）から AKfyc 形式の ID を取り出す", () => {
  assertEquals(extractDeploymentId('{"deploymentId":"AKfycbxAAA-_1"}'), "AKfycbxAAA-_1");
  assertEquals(extractDeploymentId('{"deployment":{"id":"AKfycbyBB"}}'), "AKfycbyBB");
  assertEquals(
    extractDeploymentId('{"scriptId":"1abcDEF","deployments":[{"deploymentId":"AKfycbQ_9"}]}'),
    "AKfycbQ_9",
  );
});

Deno.test("extractDeploymentId: JSON でないテキストから正規表現 AKfyc[\\w-]+ で取り出す", () => {
  assertEquals(extractDeploymentId("Created version 1. - AKfycbzCC_dd-e @1"), "AKfycbzCC_dd-e");
  assertEquals(extractDeploymentId("Deployed AKfycbw12-3_x\n"), "AKfycbw12-3_x");
});

Deno.test("extractDeploymentId: JSON の文字列値に埋め込まれた ID も正規表現で取り出す", () => {
  assertEquals(extractDeploymentId('{"message":"Deployed AKfycbEmb @2"}'), "AKfycbEmb");
});

Deno.test("extractDeploymentId: ID が無ければ null", () => {
  assertEquals(extractDeploymentId('{"foo":"bar"}'), null);
  assertEquals(extractDeploymentId(""), null);
  assertEquals(extractDeploymentId("Error: something"), null);
});

Deno.test("CLASP_ARGS: clasp 3.x のコマンド名と引数（2.x の旧名は使わない）", () => {
  assertEquals(CLASP_ARGS.version, ["--version"]);
  assertEquals(CLASP_ARGS.showAuthorizedUser, ["show-authorized-user", "--json"]);
  assertEquals(CLASP_ARGS.login, ["login"]);
  assertEquals(CLASP_ARGS.createScript, ["create-script", "--type", "standalone", "--title", "ptt"]);
  assertEquals(CLASP_ARGS.push, ["push", "--force"]);
  assertEquals(CLASP_ARGS.createDeployment, ["create-deployment", "--json"]);
  assertEquals(CLASP_ARGS.updateDeployment("AKfycbX"), ["update-deployment", "AKfycbX"]);
});
