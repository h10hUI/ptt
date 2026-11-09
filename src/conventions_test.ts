import { assertEquals } from "jsr:@std/assert@1";

const ROOT = new URL("../", import.meta.url);

const productionSources = (): { path: string; text: string }[] => {
  const files: string[] = ["main.ts"];
  for (const e of Deno.readDirSync(new URL("src/", ROOT))) {
    if (e.isFile && e.name.endsWith(".ts") && !e.name.endsWith("_test.ts")) {
      files.push(`src/${e.name}`);
    }
  }
  return files.map((path) => ({
    path,
    text: Deno.readTextFileSync(new URL(path, ROOT)),
  }));
};

Deno.test("規約: main.ts と src の本番コードが存在する", () => {
  const paths = productionSources().map((s) => s.path);
  for (const p of ["main.ts", "src/gas_files.ts", "src/pending.ts", "src/sender.ts", "src/split.ts"]) {
    assertEquals(paths.includes(p), true, `${p} がありません`);
  }
});

Deno.test("規約: any を使わない", () => {
  const re = /:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Array<any>|Record<[^>]*,\s*any>/;
  const bad = productionSources().filter((s) => s.path !== "src/gas_files.ts" && re.test(s.text));
  assertEquals(bad.map((s) => s.path), []);
});

Deno.test("規約: function 宣言ではなく const アロー関数を使う（GAS 文字列を除く）", () => {
  const re = /^\s*(export\s+)?(async\s+)?function\b/m;
  const bad = productionSources().filter((s) => s.path !== "src/gas_files.ts" && re.test(s.text));
  assertEquals(bad.map((s) => s.path), []);
});

Deno.test("規約: interface ではなく type エイリアスを使う", () => {
  const re = /^\s*(export\s+)?interface\s+\w+/m;
  const bad = productionSources().filter((s) => s.path !== "src/gas_files.ts" && re.test(s.text));
  assertEquals(bad.map((s) => s.path), []);
});

Deno.test("パーミッション: 環境変数は HOME のみ参照し、XDG_DATA_HOME と FFI は使わない", () => {
  const sources = productionSources();
  const envCalls = sources.flatMap((s) =>
    [...s.text.matchAll(/Deno\.env\.\w+\([^)]*\)/g)].map((m) => m[0])
  );
  for (const call of envCalls) {
    assertEquals(/^Deno\.env\.get\(\s*["']HOME["']\s*\)$/.test(call), true, `許可外の環境変数参照: ${call}`);
  }
  for (const s of sources) {
    assertEquals(s.text.includes("XDG_DATA_HOME"), false, `${s.path} が XDG_DATA_HOME を参照`);
    assertEquals(/Deno\.dlopen|UnsafeCallback/.test(s.text), false, `${s.path} が FFI を使用`);
    assertEquals(/Deno\.env\.(toObject|has|set|delete)\b/.test(s.text), false, `${s.path} が env 全体を参照`);
  }
});

Deno.test("パーミッション: 実行する外部コマンドは ioreg と clasp のみ", () => {
  const cmds = productionSources().flatMap((s) =>
    [...s.text.matchAll(/new\s+Deno\.Command\(\s*([^,)]+)/g)].map((m) => m[1].trim())
  );
  for (const c of cmds) {
    assertEquals(/^["'](ioreg|clasp)["']$|^\w+$/.test(c), true, `許可外のコマンド: ${c}`);
  }
  for (const s of productionSources()) {
    assertEquals(/Deno\.Command\(\s*["'](?!ioreg|clasp)/.test(s.text), false, `${s.path} が許可外コマンドを直指定`);
  }
});
