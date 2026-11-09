import { assertEquals } from "jsr:@std/assert@1";
import { buildPaths } from "./paths.ts";

Deno.test("buildPaths: 保存先は $HOME/.local/share/ptt 配下", () => {
  const p = buildPaths("/Users/x");
  assertEquals(p.root, "/Users/x/.local/share/ptt");
  assertEquals(p.config, "/Users/x/.local/share/ptt/config.json");
  assertEquals(p.gasDir, "/Users/x/.local/share/ptt/gas");
  assertEquals(p.claspJson, "/Users/x/.local/share/ptt/gas/.clasp.json");
  assertEquals(p.deploymentJson, "/Users/x/.local/share/ptt/gas/deployment.json");
  assertEquals(p.codeJs, "/Users/x/.local/share/ptt/gas/Code.js");
  assertEquals(p.appsscriptJson, "/Users/x/.local/share/ptt/gas/appsscript.json");
  assertEquals(p.pendingDir, "/Users/x/.local/share/ptt/pending");
});

Deno.test("buildPaths: HOME の末尾スラッシュで区切りが重複しない", () => {
  assertEquals(buildPaths("/Users/x/").root, "/Users/x/.local/share/ptt");
});
