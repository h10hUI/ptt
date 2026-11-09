import { assertEquals } from "jsr:@std/assert@1";
import {
  ensureDataDirs,
  readConfig,
  readDeploymentId,
  writeConfig,
  writeDeploymentId,
  writeGasFiles,
} from "./storage.ts";
import { buildPaths } from "./paths.ts";
import { buildAppsscriptJson, CODE_JS } from "./gas_files.ts";

const mode = (p: string) => Deno.statSync(p).mode! & 0o777;
const newHome = () => Deno.makeTempDirSync({ prefix: "ptt-home-" });

Deno.test("ensureDataDirs: 親ディレクトリが無くても作成し、ルートと pending は 0700", () => {
  const paths = buildPaths(newHome());
  ensureDataDirs(paths);
  assertEquals(mode(paths.root), 0o700);
  assertEquals(mode(paths.pendingDir), 0o700);
  ensureDataDirs(paths);
  assertEquals(mode(paths.root), 0o700);
});

Deno.test("ensureDataDirs: 既存の緩い権限のディレクトリも 0700 にする", () => {
  const paths = buildPaths(newHome());
  Deno.mkdirSync(paths.pendingDir, { recursive: true, mode: 0o755 });
  Deno.chmodSync(paths.root, 0o755);
  ensureDataDirs(paths);
  assertEquals(mode(paths.root), 0o700);
  assertEquals(mode(paths.pendingDir), 0o700);
});

Deno.test("writeConfig / readConfig: gasUrl と spreadsheetUrl を 0600 で保存し往復できる", () => {
  const paths = buildPaths(newHome());
  ensureDataDirs(paths);
  const config = {
    gasUrl: "https://script.google.com/macros/s/AKfycbX/exec",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/yyyyy/edit",
  };
  writeConfig(paths, config);
  assertEquals(mode(paths.config), 0o600);
  assertEquals(JSON.parse(Deno.readTextFileSync(paths.config)), config);
  assertEquals(readConfig(paths), config);
});

Deno.test("writeConfig: 既存の緩い権限のファイルも 0600 にする", () => {
  const paths = buildPaths(newHome());
  ensureDataDirs(paths);
  Deno.writeTextFileSync(paths.config, "{}", { mode: 0o644 });
  Deno.chmodSync(paths.config, 0o644);
  writeConfig(paths, { gasUrl: "g", spreadsheetUrl: "s" });
  assertEquals(mode(paths.config), 0o600);
});

Deno.test("readConfig: config.json が無ければ null", () => {
  const paths = buildPaths(newHome());
  ensureDataDirs(paths);
  assertEquals(readConfig(paths), null);
});

Deno.test("writeDeploymentId / readDeploymentId: { deploymentId } として保存し往復できる。無ければ null", () => {
  const paths = buildPaths(newHome());
  ensureDataDirs(paths);
  assertEquals(readDeploymentId(paths), null);
  writeDeploymentId(paths, "AKfycbX");
  assertEquals(JSON.parse(Deno.readTextFileSync(paths.deploymentJson)), { deploymentId: "AKfycbX" });
  assertEquals(readDeploymentId(paths), "AKfycbX");
});

Deno.test("writeGasFiles: gas/ を作成し Code.js と appsscript.json を書き出す。毎回上書きする", () => {
  const paths = buildPaths(newHome());
  ensureDataDirs(paths);
  writeGasFiles(paths, "Asia/Tokyo");
  assertEquals(Deno.readTextFileSync(paths.codeJs), CODE_JS);
  assertEquals(Deno.readTextFileSync(paths.appsscriptJson), buildAppsscriptJson("Asia/Tokyo"));
  Deno.writeTextFileSync(paths.codeJs, "// edited by user");
  writeGasFiles(paths, "America/New_York");
  assertEquals(Deno.readTextFileSync(paths.codeJs), CODE_JS);
  assertEquals(
    JSON.parse(Deno.readTextFileSync(paths.appsscriptJson)).timeZone,
    "America/New_York",
  );
});
